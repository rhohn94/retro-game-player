//! Draining queued video frames (or an HW-render FBO readback) into the
//! shared latest-frame slot, and the environment-event drain (pixel format /
//! mid-game geometry / HW-render bring-up) that feeds it. W212 + W345 — see
//! docs/design/native-emulation-design.md §2, §HW-render subsystem.

use super::core_loop::CoreLoop;
use super::session::positive_aspect_ratio;
use crate::play::native::audio::PerfCounters;
use crate::play::native::callbacks::{self, EnvironmentEvent, PixelFormat};
use crate::play::native::frame::{to_rgba8_into, Rgba8Frame};
use crate::play::native::hw_render::{HwRenderContext, HwRenderRequest};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

/// The shared latest-frame slot. Each stored frame is stamped with a
/// monotonically increasing sequence number so pollers can tell "new frame"
/// from "the frame I already painted" without comparing pixel data — the IPC
/// layer returns an empty body for an unchanged sequence (W239).
#[derive(Default)]
pub(super) struct FrameSlot {
    pub(super) seq: u64,
    pub(super) frame: Option<Rgba8Frame>,
}

/// Drains queued environment events into `ctx`'s state: pixel format, the
/// shared aspect ratio (W345, propagating the W340 reviewer note), HW-render
/// bring-up (W345, lazy — created the first and only time
/// `HwRenderRequested` arrives), and mid-game geometry (which also resizes
/// the HW-render FBO in place, when one exists).
pub(super) fn drain_environment(ctx: &mut CoreLoop<'_>) {
    while let Ok(event) = ctx.channels.environment.try_recv() {
        match event {
            EnvironmentEvent::PixelFormat(format) => {
                *ctx.pixel_format.lock().unwrap_or_else(|p| p.into_inner()) = format;
            }
            // The declared option list only matters to the core-options IPC
            // surface (W282), which reads it via a dedicated headless probe
            // (`core::core_options::list_declared_options`) — not the live
            // play session, whose values were already seeded into
            // `callbacks::set_core_variables` before this core booted.
            EnvironmentEvent::VariablesDeclared(_) => {}
            // A mid-game geometry renegotiation (W340) needs no explicit
            // pixel-buffer resize for the software path: every `VideoFrame`
            // carries its own width/height, and `drain_video`'s
            // `to_rgba8_into` resizes its output buffer to match each frame
            // it converts. The HW-render FBO (W345) is NOT self-resizing the
            // same way (its storage is GPU-allocated up front), so it is
            // explicitly resized here when a context exists. The shared
            // aspect ratio (both paths) is updated either way — this is the
            // W340 reviewer note's fix: aspect used to only be logged.
            EnvironmentEvent::GeometryChanged(geometry) => {
                eprintln!(
                    "[rgp-native] geometry changed: {}x{} (aspect {:.3})",
                    geometry.width, geometry.height, geometry.aspect_ratio
                );
                *ctx.aspect_ratio.lock().unwrap_or_else(|p| p.into_inner()) =
                    positive_aspect_ratio(geometry.aspect_ratio);
                if let Some(hw) = ctx.hw_render.as_ref() {
                    if let Err(e) = hw.resize(geometry.width, geometry.height) {
                        eprintln!("[rgp-native] HW-render FBO resize failed: {e}");
                    }
                }
            }
            EnvironmentEvent::HwRenderRequested(request) => bring_up_hw_render(ctx, request),
            EnvironmentEvent::Shutdown => ctx.stop.store(true, Ordering::Relaxed),
        }
    }
}

/// Creates the session's [`HwRenderContext`] the first time a core
/// negotiates `RETRO_ENVIRONMENT_SET_HW_RENDER` (W345) — never eagerly, and
/// never more than once per session (a second request while one is already
/// active is a core bug, logged and ignored rather than leaking the first
/// context). Installs it into the process-global FFI slot
/// ([`callbacks::install_hw_render_context`]) so
/// `get_current_framebuffer`/`get_proc_address` can answer the core's calls,
/// then signals `context_reset` per the libretro contract (after
/// `retro_load_game`, once the context + FBO are actually ready).
fn bring_up_hw_render(ctx: &mut CoreLoop<'_>, request: HwRenderRequest) {
    if ctx.hw_render.is_some() {
        eprintln!("[rgp-native] core requested HW-render a second time; ignoring");
        return;
    }
    match HwRenderContext::create(ctx.max_width, ctx.max_height, request) {
        Ok(hw) => {
            let hw = Arc::new(hw);
            callbacks::install_hw_render_context(Arc::clone(&hw));
            hw.signal_context_reset();
            ctx.hw_render = Some(hw);
        }
        Err(e) => {
            eprintln!(
                "[rgp-native] HW-render context creation failed, core init will likely fail \
                 cleanly (EJS fallback applies): {e}"
            );
        }
    }
}

/// Latest-frame-wins: drains every queued frame but only converts and keeps
/// the last one, so a momentarily slow consumer never builds up a backlog of
/// stale frames (or pays the conversion cost for frames nobody will see).
/// Conversion goes through `scratch`, which ping-pongs with the slot's
/// previous buffer — zero allocation in steady state. Every frame drained but
/// NOT kept (a newer one replaced it before anyone painted it) bumps
/// `counters.dropped_video_frames` (v0.29 W281) — this is the core outpacing
/// the frontend's poll cadence, not a decode/paint failure.
#[allow(clippy::too_many_arguments)]
pub(super) fn drain_video(
    channels: &callbacks::CallbackChannels,
    latest_frame: &Mutex<FrameSlot>,
    pixel_format: &Mutex<PixelFormat>,
    aspect_ratio: &Mutex<Option<f32>>,
    hw_render: Option<&HwRenderContext>,
    scratch: &mut Vec<u8>,
    counters: &PerfCounters,
) {
    let mut newest = None;
    let mut discarded = 0u64;
    while let Ok(frame) = channels.video.try_recv() {
        if newest.is_some() {
            discarded += 1;
        }
        newest = Some(frame);
    }
    if discarded > 0 {
        counters
            .dropped_video_frames
            .fetch_add(discarded, Ordering::Relaxed);
    }
    let Some(frame) = newest else { return };
    // Hardware-rendered frame (W345): the core already drew into the FBO
    // `hw_get_current_framebuffer` handed it — read the real pixels back
    // instead of decoding `frame.data` (which is empty for this case; see
    // `VideoFrame::is_hw_frame`'s doc). A frame claiming to be a HW frame
    // with no active context (shouldn't happen — the core can only get the
    // sentinel value from a context Harmony itself handed out) is dropped
    // rather than risking a stale/garbage readback.
    if frame.is_hw_frame {
        let Some(hw) = hw_render else { return };
        hw.read_frame_into(scratch);
        publish_frame(latest_frame, scratch, frame.width, frame.height, aspect_ratio);
        return;
    }
    let format = *pixel_format.lock().unwrap_or_else(|p| p.into_inner());
    to_rgba8_into(&frame, format, scratch);
    publish_frame(latest_frame, scratch, frame.width, frame.height, aspect_ratio);
}

/// Shared tail of both the software and HW-render video-drain paths: hands
/// `scratch`'s converted/read-back RGBA bytes to the shared frame slot,
/// recycling the displaced frame's allocation as the next scratch buffer
/// (steady-state zero allocation either way), stamped with the current
/// aspect ratio (W340 reviewer note / W345) and a fresh sequence number.
fn publish_frame(
    latest_frame: &Mutex<FrameSlot>,
    scratch: &mut Vec<u8>,
    width: u32,
    height: u32,
    aspect_ratio: &Mutex<Option<f32>>,
) {
    let aspect_ratio = *aspect_ratio.lock().unwrap_or_else(|p| p.into_inner());
    let mut slot = latest_frame.lock().unwrap_or_else(|p| p.into_inner());
    let recycled = slot.frame.take().map(|f| f.data).unwrap_or_default();
    slot.frame = Some(Rgba8Frame {
        data: std::mem::replace(scratch, recycled),
        width,
        height,
        aspect_ratio,
    });
    slot.seq = slot.seq.wrapping_add(1);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::play::native::callbacks::{AudioBatch, CallbackChannels, EnvironmentEvent, VideoFrame};
    use std::sync::mpsc;

    /// Builds a standalone `CallbackChannels` (plain mpsc, no process-global
    /// singleton) so `drain_video`/`drain_audio` are testable in isolation —
    /// `callbacks::install()` is a process-wide singleton other tests in this
    /// crate also touch, so tests here construct the struct directly instead.
    fn test_channels() -> (
        std::sync::mpsc::Sender<VideoFrame>,
        std::sync::mpsc::Sender<AudioBatch>,
        CallbackChannels,
    ) {
        let (video_tx, video_rx) = mpsc::channel();
        let (audio_tx, audio_rx) = mpsc::channel();
        let (_env_tx, env_rx) = mpsc::channel::<EnvironmentEvent>();
        (
            video_tx,
            audio_tx,
            CallbackChannels {
                video: video_rx,
                audio: audio_rx,
                environment: env_rx,
            },
        )
    }

    fn one_pixel_frame() -> VideoFrame {
        // RGB565 (2 bytes/pixel) is the smallest well-formed payload
        // `to_rgba8_into` accepts alongside `PixelFormat::Rgb565`.
        VideoFrame {
            data: vec![0xFF, 0xFF],
            width: 1,
            height: 1,
            pitch: 2,
            is_hw_frame: false,
        }
    }

    #[test]
    fn drain_video_keeps_only_the_newest_queued_frame() {
        let (video_tx, _audio_tx, channels) = test_channels();
        let latest_frame = Mutex::new(FrameSlot::default());
        let pixel_format = Mutex::new(PixelFormat::Rgb565);
        let aspect_ratio = Mutex::new(None);
        let counters = PerfCounters::default();
        let mut scratch = Vec::new();

        video_tx.send(one_pixel_frame()).expect("send 1");
        video_tx.send(one_pixel_frame()).expect("send 2");
        video_tx.send(one_pixel_frame()).expect("send 3");

        drain_video(
            &channels,
            &latest_frame,
            &pixel_format,
            &aspect_ratio,
            None,
            &mut scratch,
            &counters,
        );

        // 3 queued, 1 kept — the other 2 counted as dropped.
        assert_eq!(counters.dropped_video_frames.load(Ordering::Relaxed), 2);
        let slot = latest_frame.lock().unwrap();
        assert_eq!(slot.seq, 1);
        assert!(slot.frame.is_some());
    }

    #[test]
    fn drain_video_with_a_single_queued_frame_drops_nothing() {
        let (video_tx, _audio_tx, channels) = test_channels();
        let latest_frame = Mutex::new(FrameSlot::default());
        let pixel_format = Mutex::new(PixelFormat::Rgb565);
        let aspect_ratio = Mutex::new(None);
        let counters = PerfCounters::default();
        let mut scratch = Vec::new();

        video_tx.send(one_pixel_frame()).expect("send");
        drain_video(
            &channels,
            &latest_frame,
            &pixel_format,
            &aspect_ratio,
            None,
            &mut scratch,
            &counters,
        );

        assert_eq!(counters.dropped_video_frames.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn drain_video_with_no_queued_frame_is_a_no_op() {
        let (_video_tx, _audio_tx, channels) = test_channels();
        let latest_frame = Mutex::new(FrameSlot::default());
        let pixel_format = Mutex::new(PixelFormat::Rgb565);
        let aspect_ratio = Mutex::new(None);
        let counters = PerfCounters::default();
        let mut scratch = Vec::new();

        drain_video(
            &channels,
            &latest_frame,
            &pixel_format,
            &aspect_ratio,
            None,
            &mut scratch,
            &counters,
        );

        assert_eq!(counters.dropped_video_frames.load(Ordering::Relaxed), 0);
        assert!(latest_frame.lock().unwrap().frame.is_none());
    }

    #[test]
    fn drain_video_publishes_the_current_aspect_ratio_onto_the_frame() {
        let (video_tx, _audio_tx, channels) = test_channels();
        let latest_frame = Mutex::new(FrameSlot::default());
        let pixel_format = Mutex::new(PixelFormat::Rgb565);
        let aspect_ratio = Mutex::new(Some(16.0 / 9.0));
        let counters = PerfCounters::default();
        let mut scratch = Vec::new();

        video_tx.send(one_pixel_frame()).expect("send");
        drain_video(
            &channels,
            &latest_frame,
            &pixel_format,
            &aspect_ratio,
            None,
            &mut scratch,
            &counters,
        );

        let slot = latest_frame.lock().unwrap();
        let frame = slot.frame.as_ref().expect("frame published");
        assert_eq!(frame.aspect_ratio, Some(16.0 / 9.0));
    }
}
