//! Owns the per-frame core tick and the audio output path. Two dedicated
//! threads: the **core thread** loads a [`LibretroCore`], wires up
//! [`callbacks`], and calls `retro_run` at a fixed rate, draining the video
//! callback into a latest-frame-wins buffer and the audio callback into a
//! ring buffer; the **audio thread** owns a `cpal` output stream that drains
//! the ring buffer in its real-time audio callback. The two are split
//! because `cpal::Stream` is not `Send`/`Sync` — it cannot live on the same
//! struct as the rest of the runtime state, only be reached through the ring
//! buffer's channel-like handoff. W212 — see
//! docs/design/native-emulation-design.md §2.
//!
//! First cut is a fixed-rate feed (no dynamic rate control yet — see the
//! design doc's "Follow-ups"); the ring buffer simply drops the oldest
//! samples on overflow rather than nudging playback rate against fill level.

use super::callbacks::{self, AudioBatch, EnvironmentEvent, PixelFormat};
use super::frame::{to_rgba8, Rgba8Frame};
use super::host::LibretroCore;
use crate::error::{AppError, AppResult};
use crate::play::saves::{GameSaves, PlayPath, AUTO_SLOT};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// How often the core loop checks battery SRAM for changes and flushes it to
/// disk. Losing at most this much battery progress on a crash is the
/// trade-off against hashing 8 KiB every frame.
const SRAM_FLUSH_INTERVAL: Duration = Duration::from_secs(30);

/// How long IPC-side save/load calls wait for the core thread to answer.
/// Serialize on an 8-bit core is microseconds; a full second of headroom
/// means a timeout signals a wedged core loop, not a slow save.
const COMMAND_REPLY_TIMEOUT: Duration = Duration::from_secs(2);

/// Requests executed **on the core thread** between frames — libretro calls
/// are not thread-safe off the run loop, so the runtime never touches the
/// core from IPC threads directly.
enum CoreCommand {
    SaveState {
        slot: String,
        reply: Sender<AppResult<()>>,
    },
    LoadState {
        slot: String,
        reply: Sender<AppResult<()>>,
    },
}

/// Caps how much audio the ring buffer holds before it starts dropping the
/// oldest samples — about 0.3s at a typical 48kHz stereo rate. Large enough
/// to absorb normal core/device cadence jitter, small enough that a stall
/// doesn't turn into a multi-second audio delay once it recovers.
const RING_CAPACITY_SAMPLES: usize = 48_000 / 1000 * 300 * 2;

/// Fallback frame rate when a core reports `fps <= 0` (shouldn't happen for
/// any real core, but `retro_get_system_av_info` is core-controlled input).
const FALLBACK_FPS: f64 = 60.0;

/// A bounded, thread-shared queue of interleaved stereo `i16` samples.
/// Producer (core thread) pushes whole [`AudioBatch`]es; consumer (cpal's
/// realtime callback) pops individual samples. Backed by a `Mutex` rather
/// than a lock-free structure — simple and correct for v1; revisit only if
/// profiling shows contention.
struct AudioRing {
    samples: Mutex<VecDeque<i16>>,
}

impl AudioRing {
    fn new() -> Self {
        AudioRing {
            samples: Mutex::new(VecDeque::with_capacity(RING_CAPACITY_SAMPLES)),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, VecDeque<i16>> {
        self.samples.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Pushes `samples`, dropping the oldest entries first if the ring is at
    /// capacity. Audible as a small skip under sustained overload rather
    /// than unbounded memory growth or an ever-increasing latency.
    fn push(&self, samples: &[i16]) {
        let mut buf = self.lock();
        for &s in samples {
            if buf.len() >= RING_CAPACITY_SAMPLES {
                buf.pop_front();
            }
            buf.push_back(s);
        }
    }

    /// Fills `out` from the ring, oldest samples first; pads any shortfall
    /// with silence (`0`) rather than repeating samples, matching the
    /// standard libretro/RetroArch underrun behavior (a brief gap, not a
    /// glitch-loop). Returns how many real samples were copied.
    fn pop_into(&self, out: &mut [i16]) -> usize {
        let mut buf = self.lock();
        let mut copied = 0;
        for slot in out.iter_mut() {
            match buf.pop_front() {
                Some(sample) => {
                    *slot = sample;
                    copied += 1;
                }
                None => *slot = 0,
            }
        }
        copied
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().len()
    }
}

/// A live, running native core session. `Drop` signals both threads to stop
/// and joins them, so a session never outlives the struct that owns it.
pub struct NativeRuntime {
    latest_frame: Arc<Mutex<Option<Rgba8Frame>>>,
    stop: Arc<AtomicBool>,
    commands: Sender<CoreCommand>,
    core_thread: Option<JoinHandle<()>>,
    audio_thread: Option<JoinHandle<AppResult<()>>>,
}

impl NativeRuntime {
    /// Loads `core_path`, loads `rom_path` into it, and starts both threads.
    /// Returns once the core has loaded the game and announced its AV info —
    /// callers can read [`Self::latest_frame`] as soon as the core produces
    /// its first frame. When `saves` is present, existing battery SRAM is
    /// loaded before the first frame, SRAM changes flush periodically and on
    /// stop, and an auto save-state is written on stop (W230).
    pub fn start(core_path: &Path, rom_path: &Path, saves: Option<GameSaves>) -> AppResult<Self> {
        // Channels first: cores negotiate (e.g. SET_PIXEL_FORMAT) during
        // retro_init/retro_load_game, and events sent before install() would
        // be silently dropped.
        let channels = callbacks::install();
        let bring_up = || -> AppResult<(LibretroCore, f64)> {
            let mut core = LibretroCore::load(core_path)?;
            // Contract order (see LibretroCore's doc): environment MUST be
            // registered before retro_init — real cores query it during init.
            core.set_environment(callbacks::environment);
            core.init()?;
            core.set_video_refresh(callbacks::video_refresh);
            core.set_audio_sample_batch(callbacks::audio_sample_batch);
            core.set_input_poll(callbacks::input_poll);
            core.set_input_state(callbacks::input_state);
            core.load_game(rom_path)?;
            // Restore battery progress before the first frame runs. A
            // corrupt/mismatched .srm degrades to a fresh session, never a
            // failed boot.
            if let Some(saves) = &saves {
                if let Some(sram) = saves.read_sram() {
                    if let Err(e) = core.load_sram(&sram) {
                        eprintln!("[harmony-native] ignoring saved SRAM: {e}");
                    }
                }
            }
            let av = core.av_info();
            let fps = if av.timing.fps > 0.0 {
                av.timing.fps
            } else {
                FALLBACK_FPS
            };
            Ok((core, fps))
        };
        let (core, fps) = match bring_up() {
            Ok(v) => v,
            Err(e) => {
                callbacks::uninstall(); // don't leave dead sinks installed
                return Err(e);
            }
        };

        let latest_frame = Arc::new(Mutex::new(None));
        // Libretro's implicit default before a core negotiates otherwise.
        let pixel_format = Arc::new(Mutex::new(PixelFormat::Rgb1555));
        let ring = Arc::new(AudioRing::new());
        let stop = Arc::new(AtomicBool::new(false));
        let (commands, command_rx) = mpsc::channel();

        let core_thread = {
            let latest_frame = Arc::clone(&latest_frame);
            let pixel_format = Arc::clone(&pixel_format);
            let ring = Arc::clone(&ring);
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || {
                run_core_loop(CoreLoop {
                    core,
                    channels,
                    fps,
                    saves,
                    commands: command_rx,
                    latest_frame: &latest_frame,
                    pixel_format: &pixel_format,
                    ring: &ring,
                    stop: &stop,
                });
                callbacks::uninstall();
            })
        };

        let audio_thread = {
            let ring = Arc::clone(&ring);
            let stop = Arc::clone(&stop);
            std::thread::spawn(move || run_audio_output(&ring, &stop))
        };

        Ok(NativeRuntime {
            latest_frame,
            stop,
            commands,
            core_thread: Some(core_thread),
            audio_thread: Some(audio_thread),
        })
    }

    fn round_trip(&self, make: impl FnOnce(Sender<AppResult<()>>) -> CoreCommand) -> AppResult<()> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.commands
            .send(make(reply_tx))
            .map_err(|_| AppError::Internal("native core loop has stopped".into()))?;
        reply_rx
            .recv_timeout(COMMAND_REPLY_TIMEOUT)
            .map_err(|_| AppError::Internal("native core loop did not answer".into()))?
    }

    /// Saves the current core state into `slot` (on the core thread).
    pub fn save_state(&self, slot: &str) -> AppResult<()> {
        let slot = slot.to_string();
        self.round_trip(|reply| CoreCommand::SaveState { slot, reply })
    }

    /// Restores `slot` into the running core (on the core thread).
    pub fn load_state(&self, slot: &str) -> AppResult<()> {
        let slot = slot.to_string();
        self.round_trip(|reply| CoreCommand::LoadState { slot, reply })
    }

    /// A clone of the most recently produced video frame, already decoded to
    /// RGBA8888. Cheap to poll — backs a Tauri command (W214) that pulls
    /// frames on a UI-driven cadence rather than being pushed one for one
    /// with the core.
    pub fn latest_frame(&self) -> Option<Rgba8Frame> {
        self.latest_frame
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
}

impl Drop for NativeRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.core_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.audio_thread.take() {
            let _ = handle.join();
        }
    }
}

/// Everything the core thread owns for one session.
struct CoreLoop<'a> {
    core: LibretroCore,
    channels: callbacks::CallbackChannels,
    fps: f64,
    saves: Option<GameSaves>,
    commands: Receiver<CoreCommand>,
    latest_frame: &'a Mutex<Option<Rgba8Frame>>,
    pixel_format: &'a Mutex<PixelFormat>,
    ring: &'a AudioRing,
    stop: &'a AtomicBool,
}

/// Drives `retro_run` at a fixed cadence (`1/fps` per frame, no
/// dynamic-rate-control yet) until `stop` is set, draining each frame's
/// environment/video/audio callback output into the shared buffers,
/// executing save/load commands between frames, flushing dirty battery SRAM
/// periodically, and writing the final SRAM + auto save-state on exit.
fn run_core_loop(mut ctx: CoreLoop<'_>) {
    let frame_duration = Duration::from_secs_f64(1.0 / ctx.fps);
    let mut last_flushed_sram: Option<Vec<u8>> = None;
    let mut last_flush_check = Instant::now();
    while !ctx.stop.load(Ordering::Relaxed) {
        let tick_start = Instant::now();
        if ctx.core.run_frame().is_err() {
            // A bug (run before load_game), not a runtime fault a retry can
            // fix — stop rather than spin.
            break;
        }
        // Before video: a core typically negotiates its pixel format once
        // near startup, before its first real video_refresh call.
        drain_environment(&ctx.channels, ctx.pixel_format, ctx.stop);
        drain_video(&ctx.channels, ctx.latest_frame, ctx.pixel_format);
        drain_audio(&ctx.channels, ctx.ring);
        handle_commands(&mut ctx);
        if last_flush_check.elapsed() >= SRAM_FLUSH_INTERVAL {
            last_flush_check = Instant::now();
            flush_sram_if_dirty(&ctx, &mut last_flushed_sram);
        }
        let elapsed = tick_start.elapsed();
        if elapsed < frame_duration {
            std::thread::sleep(frame_duration - elapsed);
        }
    }
    // Session end: persist battery progress and a Continue point.
    // Best-effort — a failed write logs rather than blocking teardown.
    flush_sram_if_dirty(&ctx, &mut last_flushed_sram);
    if let Some(saves) = &ctx.saves {
        match ctx.core.serialize() {
            Ok(Some(state)) => {
                if let Err(e) = saves.write_state(AUTO_SLOT, &state, PlayPath::Native) {
                    eprintln!("[harmony-native] auto save-state write failed: {e}");
                }
            }
            Ok(None) => {} // core has no serialize support — SRAM-only
            Err(e) => eprintln!("[harmony-native] auto save-state failed: {e}"),
        }
    }
}

/// Executes queued save/load commands between frames.
fn handle_commands(ctx: &mut CoreLoop<'_>) {
    while let Ok(command) = ctx.commands.try_recv() {
        match command {
            CoreCommand::SaveState { slot, reply } => {
                let result = save_state_now(ctx, &slot);
                let _ = reply.send(result);
            }
            CoreCommand::LoadState { slot, reply } => {
                let result = load_state_now(ctx, &slot);
                let _ = reply.send(result);
            }
        }
    }
}

fn save_state_now(ctx: &mut CoreLoop<'_>, slot: &str) -> AppResult<()> {
    let saves = ctx.saves.as_ref().ok_or_else(|| {
        AppError::Unsupported("save persistence is not configured for this session".into())
    })?;
    let state = ctx.core.serialize()?.ok_or_else(|| {
        AppError::Unsupported("this core does not support save states".into())
    })?;
    saves.write_state(slot, &state, PlayPath::Native)
}

fn load_state_now(ctx: &mut CoreLoop<'_>, slot: &str) -> AppResult<()> {
    let saves = ctx.saves.as_ref().ok_or_else(|| {
        AppError::Unsupported("save persistence is not configured for this session".into())
    })?;
    let state = saves.read_state(slot)?;
    ctx.core.unserialize(&state)
}

/// Writes battery SRAM iff it changed since the last flush — comparing the
/// bytes (NES SRAM is ≤ 8 KiB) is cheaper than any wrong answer here.
fn flush_sram_if_dirty(ctx: &CoreLoop<'_>, last_flushed: &mut Option<Vec<u8>>) {
    let Some(saves) = &ctx.saves else { return };
    let Some(current) = ctx.core.sram() else { return };
    if last_flushed.as_ref() == Some(&current) {
        return;
    }
    // An all-zero region that has never been flushed is a game without
    // battery use yet — writing it would create meaningless .srm files.
    if last_flushed.is_none() && current.iter().all(|&b| b == 0) {
        return;
    }
    match saves.write_sram(&current) {
        Ok(()) => *last_flushed = Some(current),
        Err(e) => eprintln!("[harmony-native] SRAM flush failed: {e}"),
    }
}

fn drain_environment(
    channels: &callbacks::CallbackChannels,
    pixel_format: &Mutex<PixelFormat>,
    stop: &AtomicBool,
) {
    while let Ok(event) = channels.environment.try_recv() {
        match event {
            EnvironmentEvent::PixelFormat(format) => {
                *pixel_format.lock().unwrap_or_else(|p| p.into_inner()) = format;
            }
            EnvironmentEvent::Shutdown => stop.store(true, Ordering::Relaxed),
        }
    }
}

/// Latest-frame-wins: drains every queued frame but only converts and keeps
/// the last one, so a momentarily slow consumer never builds up a backlog of
/// stale frames (or pays the conversion cost for frames nobody will see).
fn drain_video(
    channels: &callbacks::CallbackChannels,
    latest_frame: &Mutex<Option<Rgba8Frame>>,
    pixel_format: &Mutex<PixelFormat>,
) {
    let mut newest = None;
    while let Ok(frame) = channels.video.try_recv() {
        newest = Some(frame);
    }
    if let Some(frame) = newest {
        let format = *pixel_format.lock().unwrap_or_else(|p| p.into_inner());
        let rgba = to_rgba8(&frame, format);
        *latest_frame.lock().unwrap_or_else(|p| p.into_inner()) = Some(rgba);
    }
}

fn drain_audio(channels: &callbacks::CallbackChannels, ring: &AudioRing) {
    while let Ok(AudioBatch { samples }) = channels.audio.try_recv() {
        ring.push(&samples);
    }
}

/// Opens the default output device and feeds it from `ring` until `stop` is
/// set. Lives entirely on this thread because `cpal::Stream` is neither
/// `Send` nor `Sync` — it cannot be handed back to the caller.
fn run_audio_output(ring: &Arc<AudioRing>, stop: &AtomicBool) -> AppResult<()> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| AppError::Dependency("no default audio output device".into()))?;
    let config = device
        .default_output_config()
        .map_err(|e| AppError::Dependency(format!("no usable output config: {e}")))?;

    let stream = build_output_stream(&device, &config, ring)?;
    stream
        .play()
        .map_err(|e| AppError::Dependency(format!("failed to start audio stream: {e}")))?;

    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(50));
    }
    // `stream` drops here, stopping playback before the thread exits.
    Ok(())
}

fn build_output_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    ring: &Arc<AudioRing>,
) -> AppResult<cpal::Stream> {
    let err_fn = |e| eprintln!("native audio output stream error: {e}");
    let stream_config = config.config();

    // Owned clone so the realtime callback (which must be `'static`) holds
    // its own reference independent of this function's borrow.
    let ring = Arc::clone(ring);

    let stream = match config.sample_format() {
        cpal::SampleFormat::I16 => device.build_output_stream(
            &stream_config,
            move |data: &mut [i16], _| {
                ring.pop_into(data);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::F32 => device.build_output_stream(
            &stream_config,
            move |data: &mut [f32], _| {
                let mut scratch = vec![0i16; data.len()];
                ring.pop_into(&mut scratch);
                for (out, sample) in data.iter_mut().zip(scratch.iter()) {
                    *out = f32::from(*sample) / f32::from(i16::MAX);
                }
            },
            err_fn,
            None,
        ),
        other => {
            return Err(AppError::Unsupported(format!(
                "unsupported audio output sample format: {other:?}"
            )))
        }
    };

    stream.map_err(|e| AppError::Dependency(format!("failed to build audio stream: {e}")))
}

/// Manual, real-device verification harness for the v0.21 "Bedrock"
/// stop-and-reassess point ("is native audio actually clean?" —
/// release-planning-v0.21.md §3). Not run by `cargo test` (`#[ignore]`); run
/// it explicitly once a core + ROM are available:
///
/// ```text
/// HARMONY_MANUAL_AUDIO_CORE=/path/to/fceumm_libretro.dylib \
/// HARMONY_MANUAL_AUDIO_ROM=/path/to/game.nes \
/// cargo test --release -p harmony manual_play_produces_audible_output -- --ignored --nocapture
/// ```
#[cfg(test)]
mod manual {
    use super::*;
    use std::path::PathBuf;

    #[test]
    #[ignore]
    fn manual_play_produces_audible_output() {
        let core_path = std::env::var("HARMONY_MANUAL_AUDIO_CORE")
            .expect("set HARMONY_MANUAL_AUDIO_CORE to an installed fceumm_libretro.dylib path");
        let rom_path = std::env::var("HARMONY_MANUAL_AUDIO_ROM")
            .expect("set HARMONY_MANUAL_AUDIO_ROM to a real .nes ROM path");

        let runtime =
            NativeRuntime::start(&PathBuf::from(core_path), &PathBuf::from(rom_path), None)
                .expect("native runtime failed to start");

        println!("playing for 5s — listen for cold-start garble (#15)...");
        std::thread::sleep(Duration::from_secs(5));
        let frame = runtime.latest_frame();
        println!(
            "latest frame present: {}",
            frame.map(|f| format!("{}x{}", f.width, f.height)).unwrap_or_else(|| "none".into())
        );
        drop(runtime);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_pops_in_fifo_order_oldest_first() {
        let ring = AudioRing::new();
        ring.push(&[1, 2, 3, 4]);
        let mut out = [0i16; 4];
        let copied = ring.pop_into(&mut out);
        assert_eq!(copied, 4);
        assert_eq!(out, [1, 2, 3, 4]);
        assert_eq!(ring.len(), 0);
    }

    #[test]
    fn ring_pads_shortfall_with_silence_on_underrun() {
        let ring = AudioRing::new();
        ring.push(&[7, 8]);
        let mut out = [0i16; 4];
        let copied = ring.pop_into(&mut out);
        assert_eq!(copied, 2);
        assert_eq!(out, [7, 8, 0, 0]);
    }

    #[test]
    fn ring_drops_oldest_samples_when_pushed_past_capacity() {
        let ring = AudioRing::new();
        // Fill to capacity with a sentinel, then push one more sample — the
        // very first sentinel value must be the one that got dropped.
        let filler = vec![9i16; RING_CAPACITY_SAMPLES];
        ring.push(&filler);
        assert_eq!(ring.len(), RING_CAPACITY_SAMPLES);
        ring.push(&[42]);
        assert_eq!(ring.len(), RING_CAPACITY_SAMPLES);
        let mut out = [0i16; 1];
        ring.pop_into(&mut out);
        assert_eq!(out, [9]); // the oldest sentinel, not 42 — front wasn't dropped twice
    }

    #[test]
    fn pop_into_an_empty_ring_returns_all_silence() {
        let ring = AudioRing::new();
        let mut out = [5i16; 3]; // pre-filled with a non-zero sentinel
        let copied = ring.pop_into(&mut out);
        assert_eq!(copied, 0);
        assert_eq!(out, [0, 0, 0]);
    }
}
