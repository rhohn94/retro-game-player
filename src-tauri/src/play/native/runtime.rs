//! Orchestrates a native core session across two dedicated threads: the
//! **core thread** loads a [`LibretroCore`], wires up [`callbacks`], and
//! calls `retro_run` on an absolute-deadline [`FrameClock`], draining video
//! into a latest-frame-wins slot and audio through the resampler + rate
//! control chain into a lock-free ring; the **audio thread** owns the
//! `cpal::Stream` (which is not `Send`/`Sync`) and drains that ring in its
//! realtime callback. The pacing/resampling/ring mechanics live in
//! [`super::clock`] and [`super::audio`]; this module only wires them to the
//! core lifecycle. W212 + W270 — see
//! docs/design/native-emulation-design.md §2.

use super::audio::{
    run_audio_thread, AudioBringUp, AudioProducer, PerfCounters, SharedGain, StereoResampler,
};
use super::callbacks::{self, AudioBatch, EnvironmentEvent, PixelFormat};
use super::clock::FrameClock;
use super::frame::{to_rgba8_into, Rgba8Frame};
use super::host::LibretroCore;
use super::hw_render::{HwRenderContext, HwRenderRequest};
use super::perf_file::PerfLogFile;
use super::perf_stats::FrameTimeWindow;
use crate::error::{AppError, AppResult};
use crate::play::saves::{GameSaves, PlayPath, AUTO_SLOT};
use std::path::{Path, PathBuf};
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

/// How long `start` waits for the audio thread to open the device and hand
/// back the ring producer. Device bring-up is tens of milliseconds; hitting
/// this means audio is wedged, and the session proceeds video-only.
const AUDIO_BRING_UP_TIMEOUT: Duration = Duration::from_secs(2);

/// How often the core loop emits the `[rgp-native]` perf line (effective
/// fps, ring fill, underrun/overrun deltas) — frequent enough to correlate
/// with what the ear hears, rare enough to never matter.
const PERF_LOG_INTERVAL: Duration = Duration::from_secs(10);

/// Fallback frame rate when a core reports `fps <= 0` (shouldn't happen for
/// any real core, but `retro_get_system_av_info` is core-controlled input).
const FALLBACK_FPS: f64 = 60.0;

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

/// The shared latest-frame slot. Each stored frame is stamped with a
/// monotonically increasing sequence number so pollers can tell "new frame"
/// from "the frame I already painted" without comparing pixel data — the IPC
/// layer returns an empty body for an unchanged sequence (W239).
#[derive(Default)]
struct FrameSlot {
    seq: u64,
    frame: Option<Rgba8Frame>,
}

/// A live, running native core session. `Drop` signals both threads to stop
/// and joins them, so a session never outlives the struct that owns it.
pub struct NativeRuntime {
    latest_frame: Arc<Mutex<FrameSlot>>,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    gain: Arc<SharedGain>,
    commands: Sender<CoreCommand>,
    core_thread: Option<JoinHandle<()>>,
    audio_thread: Option<JoinHandle<()>>,
}

impl NativeRuntime {
    /// Loads `core_path`, loads `rom_path` into it, and starts both threads.
    /// Returns once the core has loaded the game and announced its AV info —
    /// callers can read [`Self::latest_frame`] as soon as the core produces
    /// its first frame. When `saves` is present, existing battery SRAM is
    /// loaded before the first frame, SRAM changes flush periodically and on
    /// stop, and an auto save-state is written on stop (W230). If no usable
    /// audio output exists the session still runs, video-only, with the
    /// core's audio discarded. When `perf_log_path` is present, the periodic
    /// perf line is also appended to that file (fresh per session, W274);
    /// `None` or any file failure means stderr-only, never a session error.
    pub fn start(
        core_path: &Path,
        rom_path: &Path,
        saves: Option<GameSaves>,
        perf_log_path: Option<PathBuf>,
    ) -> AppResult<Self> {
        // Channels first: cores negotiate (e.g. SET_PIXEL_FORMAT) during
        // retro_init/retro_load_game, and events sent before install() would
        // be silently dropped.
        let channels = callbacks::install();
        let bring_up = match bring_up_core(core_path, rom_path, &saves) {
            Ok(v) => v,
            Err(e) => {
                callbacks::uninstall(); // don't leave dead sinks installed
                return Err(e);
            }
        };
        let CoreBringUp {
            core,
            fps,
            audio_sample_rate: core_sample_rate,
            aspect_ratio,
            max_width,
            max_height,
        } = bring_up;

        let latest_frame = Arc::new(Mutex::new(FrameSlot::default()));
        // Libretro's implicit default before a core negotiates otherwise.
        let pixel_format = Arc::new(Mutex::new(PixelFormat::Rgb1555));
        let aspect_ratio = Arc::new(Mutex::new(aspect_ratio));
        let stop = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let gain = Arc::new(SharedGain::new());
        let counters = Arc::new(PerfCounters::default());
        let (commands, command_rx) = mpsc::channel();

        let (audio_thread, audio) =
            bring_up_audio(core_sample_rate, &stop, &paused, &gain, &counters);

        let core_thread = {
            let latest_frame = Arc::clone(&latest_frame);
            let pixel_format = Arc::clone(&pixel_format);
            let aspect_ratio = Arc::clone(&aspect_ratio);
            let stop = Arc::clone(&stop);
            let paused = Arc::clone(&paused);
            let counters = Arc::clone(&counters);
            std::thread::spawn(move || {
                elevate_core_thread_qos();
                run_core_loop(CoreLoop {
                    core,
                    channels,
                    fps,
                    saves,
                    audio,
                    counters,
                    perf_file: PerfLogFile::create(perf_log_path.as_deref()),
                    commands: command_rx,
                    latest_frame: &latest_frame,
                    pixel_format: &pixel_format,
                    aspect_ratio: &aspect_ratio,
                    hw_render: None,
                    max_width,
                    max_height,
                    stop: &stop,
                    paused: &paused,
                });
                callbacks::uninstall();
            })
        };

        Ok(NativeRuntime {
            latest_frame,
            stop,
            paused,
            gain,
            commands,
            core_thread: Some(core_thread),
            audio_thread: Some(audio_thread),
        })
    }

    /// Sets the audio output gain, clamped to [0, 1] — the attract-mode duck
    /// (W235) and the seam #22's volume control builds on. Applied atomically
    /// in the realtime output callback; no locking, no click.
    pub fn set_volume(&self, gain: f32) {
        self.gain.set(gain);
    }

    /// Pauses/resumes the core tick (the overlay opens → the game freezes
    /// behind it, exactly like the EmulatorJS path's pause). Save/load
    /// commands still execute while paused; the frame clock resyncs on
    /// resume rather than replaying the deadlines missed while frozen.
    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
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
    /// RGBA8888, paired with its sequence number. Backs a Tauri command
    /// (W214/W239) that pulls frames on a UI-driven cadence rather than being
    /// pushed one for one with the core; the sequence number lets that poller
    /// skip frames it has already painted.
    pub fn latest_frame(&self) -> Option<(u64, Rgba8Frame)> {
        let slot = self.latest_frame.lock().unwrap_or_else(|p| p.into_inner());
        slot.frame.clone().map(|frame| (slot.seq, frame))
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

/// Elevates the calling thread (the core thread) to the user-interactive
/// QoS class on macOS, reducing scheduler-induced tick jitter under load —
/// the thread paces `retro_run` against real-time deadlines and feeds the
/// realtime audio ring (W274 stretch). Best-effort: a non-zero return leaves
/// the thread at default priority, which is exactly the pre-W274 behavior.
#[cfg(target_os = "macos")]
fn elevate_core_thread_qos() {
    // SAFETY: pthread_set_qos_class_self_np takes two scalar arguments by
    // value, touches no caller memory, and only adjusts the calling thread's
    // scheduling class — there are no pointer/lifetime preconditions to
    // uphold. Failure is reported via the return code, handled below.
    let rc = unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE, 0)
    };
    if rc != 0 {
        eprintln!("[rgp-native] core-thread QoS elevation failed (rc {rc}); running at default priority");
    }
}

/// No-op off macOS (QoS classes are a Darwin scheduler concept).
#[cfg(not(target_os = "macos"))]
fn elevate_core_thread_qos() {}

/// Everything [`bring_up_core`] hands back to [`NativeRuntime::start`]: the
/// loaded core plus the facts it reported that the rest of bring-up needs
/// (pacing, initial display aspect, and — for a core that will go on to
/// negotiate HW-render — the max geometry the FBO should be sized from).
struct CoreBringUp {
    core: LibretroCore,
    fps: f64,
    audio_sample_rate: f64,
    /// The core's declared display aspect ratio at boot
    /// (`retro_get_system_av_info`'s `geometry.aspect_ratio`) — `None` for a
    /// non-positive value, matching libretro's "derive it from width/height"
    /// convention. Superseded at runtime by any
    /// `RETRO_ENVIRONMENT_SET_GEOMETRY` renegotiation (W340).
    aspect_ratio: Option<f32>,
    /// The core's declared max frame dimensions — the size an HW-render FBO
    /// is allocated at (never renegotiated except by `SET_GEOMETRY`, which
    /// resizes the FBO in place). Meaningless for a software-rendered core
    /// (nothing reads it).
    max_width: u32,
    max_height: u32,
}

/// Loads and initializes the core + ROM (+ saved SRAM), returning it with
/// the facts the rest of bring-up needs ([`CoreBringUp`]).
fn bring_up_core(core_path: &Path, rom_path: &Path, saves: &Option<GameSaves>) -> AppResult<CoreBringUp> {
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
    // corrupt/mismatched .srm degrades to a fresh session, never a failed
    // boot.
    if let Some(saves) = saves {
        if let Some(sram) = saves.read_sram() {
            if let Err(e) = core.load_sram(&sram) {
                eprintln!("[rgp-native] ignoring saved SRAM: {e}");
            }
        }
    }
    let av = core.av_info();
    let fps = if av.timing.fps > 0.0 {
        av.timing.fps
    } else {
        FALLBACK_FPS
    };
    Ok(CoreBringUp {
        core,
        fps,
        audio_sample_rate: av.timing.sample_rate,
        aspect_ratio: positive_aspect_ratio(av.geometry.aspect_ratio),
        max_width: av.geometry.max_width,
        max_height: av.geometry.max_height,
    })
}

/// Libretro's convention for `retro_game_geometry.aspect_ratio`: a
/// non-positive value means "not set — derive it from width/height", never a
/// literal ratio to render at. Shared by boot-time (`bring_up_core`) and
/// mid-game (`SET_GEOMETRY`, in [`drain_environment`]) geometry reads so the
/// two call sites can't drift on what "unset" means.
fn positive_aspect_ratio(raw: f32) -> Option<f32> {
    (raw > 0.0).then_some(raw)
}

/// Spawns the audio thread and waits for its bring-up handoff: the device's
/// actual rate plus the ring producer, wrapped with a resampler configured
/// core-rate → device-rate. Any failure (no device, no config, timeout)
/// degrades to a video-only session — `None` — with the reason logged.
fn bring_up_audio(
    core_sample_rate: f64,
    stop: &Arc<AtomicBool>,
    paused: &Arc<AtomicBool>,
    gain: &Arc<SharedGain>,
    counters: &Arc<PerfCounters>,
) -> (JoinHandle<()>, Option<CoreAudio>) {
    let (ready_tx, ready_rx) = mpsc::channel();
    let audio_thread = {
        let stop = Arc::clone(stop);
        let paused = Arc::clone(paused);
        let gain = Arc::clone(gain);
        let counters = Arc::clone(counters);
        std::thread::spawn(move || run_audio_thread(&ready_tx, &stop, &paused, &gain, &counters))
    };
    let audio = match ready_rx.recv_timeout(AUDIO_BRING_UP_TIMEOUT) {
        Ok(Ok(AudioBringUp {
            device_rate,
            producer,
        })) => Some(CoreAudio {
            resampler: StereoResampler::new(core_sample_rate, device_rate),
            producer,
            device_rate,
        }),
        Ok(Err(e)) => {
            eprintln!("[rgp-native] audio unavailable, continuing video-only: {e}");
            None
        }
        // Timeout or a dead audio thread — either way audio never came up.
        Err(_) => {
            eprintln!("[rgp-native] audio bring-up did not answer, continuing video-only");
            None
        }
    };
    (audio_thread, audio)
}

/// The core thread's half of the audio chain: resamples each core batch to
/// the device rate (with the DRC skew for the current ring fill) and pushes
/// it into the ring.
struct CoreAudio {
    resampler: StereoResampler,
    producer: AudioProducer,
    device_rate: f64,
}

/// Everything the core thread owns for one session.
struct CoreLoop<'a> {
    core: LibretroCore,
    channels: callbacks::CallbackChannels,
    fps: f64,
    saves: Option<GameSaves>,
    /// `None` = no usable audio output; batches are drained and discarded.
    audio: Option<CoreAudio>,
    counters: Arc<PerfCounters>,
    /// Per-session file sink for the perf line (W274); disabled = stderr-only.
    perf_file: PerfLogFile,
    commands: Receiver<CoreCommand>,
    latest_frame: &'a Mutex<FrameSlot>,
    pixel_format: &'a Mutex<PixelFormat>,
    /// The frame pipe's current display aspect ratio (W340's reviewer note,
    /// W345): seeded from the core's boot-time `av_info` and updated on
    /// `RETRO_ENVIRONMENT_SET_GEOMETRY`; read into every delivered
    /// [`Rgba8Frame`] so the frontend can render at the correct aspect
    /// instead of assuming a fixed box.
    aspect_ratio: &'a Mutex<Option<f32>>,
    /// `None` until a core negotiates `RETRO_ENVIRONMENT_SET_HW_RENDER`
    /// (W345) — created lazily by [`bring_up_hw_render`] the first time
    /// [`EnvironmentEvent::HwRenderRequested`] is drained, never eagerly.
    /// `Arc` (not `Box`) because [`callbacks::install_hw_render_context`]
    /// needs its own handle for the process-global FFI callbacks
    /// ([`callbacks::hw_get_current_framebuffer`]/
    /// [`callbacks::hw_get_proc_address`]) to read from a different call
    /// stack (the core's own `retro_run`, re-entering through the C ABI)
    /// than the one that owns it here.
    hw_render: Option<Arc<HwRenderContext>>,
    /// The core's declared max frame dimensions — sizes the HW-render FBO
    /// the first time it is created. Meaningless (and unread) for a
    /// software-rendered session.
    max_width: u32,
    max_height: u32,
    stop: &'a AtomicBool,
    paused: &'a AtomicBool,
}

/// Drives `retro_run` on an absolute-deadline [`FrameClock`] (`1/fps`
/// period) until `stop` is set, draining each frame's environment/video/
/// audio callback output into the shared buffers, executing save/load
/// commands between frames, flushing dirty battery SRAM periodically,
/// logging perf counters, and writing the final SRAM + auto save-state on
/// exit.
fn run_core_loop(mut ctx: CoreLoop<'_>) {
    // Drain once before the loop starts: a core negotiates HW-render (and
    // pixel format, and its option list) during `retro_init`/`retro_load_game`
    // — both of which already happened inside `bring_up_core`, before this
    // function was ever called — so those events are sitting in the channel
    // right now. Draining them here (not waiting for the post-`run_frame`
    // drain inside the loop below) matters specifically for HW-render
    // (W345): the libretro contract calls for `context_reset` to fire once
    // the context + FBO are ready but BEFORE the core's first `retro_run`,
    // and the core's own copy of `get_current_framebuffer`/`get_proc_address`
    // (captured at negotiation time) is only valid once `bring_up_hw_render`
    // has filled them in — a first `retro_run` before this drain would call
    // through function pointers the core hasn't resolved via
    // `get_proc_address` yet, producing a blank first frame at best.
    drain_environment(&mut ctx);
    let frame_duration = Duration::from_secs_f64(1.0 / ctx.fps);
    let mut clock = FrameClock::new(frame_duration);
    let mut last_flushed_sram: Option<Vec<u8>> = None;
    let mut last_flush_check = Instant::now();
    // The perf logger takes the session's file sink; the placeholder left in
    // ctx is disabled (CoreLoop is used whole by the helpers below, so the
    // field cannot be partially moved out).
    let perf_file = std::mem::replace(&mut ctx.perf_file, PerfLogFile::disabled());
    let mut perf = PerfLog::new(&ctx.counters, perf_file);
    // Reused across frames so steady-state conversion allocates nothing.
    let mut rgba_scratch: Vec<u8> = Vec::new();
    let mut resample_scratch: Vec<f32> = Vec::new();
    let mut was_paused = false;
    // v0.29 W281 (performance-tooling-design.md): wall-clock timestamp of the
    // previous iteration's start, so each new iteration's tick-to-tick delta
    // can be recorded as one frame-time sample. `None` for the very first
    // tick (no prior iteration to measure from) and reset across a
    // pause/resume (a resumed session's first tick spans the pause, which is
    // not a real frame-time regression).
    let mut last_tick_start: Option<Instant> = None;
    while !ctx.stop.load(Ordering::Relaxed) {
        if ctx.paused.load(Ordering::Relaxed) {
            // Frozen behind the overlay: no frames tick, but save/load
            // commands still answer so the slot picker works while paused.
            handle_commands(&mut ctx);
            std::thread::sleep(frame_duration);
            was_paused = true;
            continue;
        }
        let tick_start = Instant::now();
        if was_paused {
            // Resume from "now" — replaying the deadlines missed while
            // paused would burst the core to catch up.
            clock.resync();
            was_paused = false;
            last_tick_start = None; // the pause gap itself is not a frame-time sample
        }
        if let Some(previous) = last_tick_start {
            perf.record_frame_time(tick_start.duration_since(previous));
        }
        last_tick_start = Some(tick_start);
        if ctx.core.run_frame().is_err() {
            // A bug (run before load_game), not a runtime fault a retry can
            // fix — stop rather than spin.
            break;
        }
        ctx.counters.frames_run.fetch_add(1, Ordering::Relaxed);
        // Before video: a core typically negotiates its pixel format (or,
        // for N64/W345, its HW-render context) once near startup, before its
        // first real video_refresh call.
        drain_environment(&mut ctx);
        drain_video(
            &ctx.channels,
            ctx.latest_frame,
            ctx.pixel_format,
            ctx.aspect_ratio,
            ctx.hw_render.as_deref(),
            &mut rgba_scratch,
            &ctx.counters,
        );
        drain_audio(&ctx.channels, &mut ctx.audio, &mut resample_scratch);
        handle_commands(&mut ctx);
        if last_flush_check.elapsed() >= SRAM_FLUSH_INTERVAL {
            last_flush_check = Instant::now();
            flush_sram_if_dirty(&ctx, &mut last_flushed_sram);
        }
        perf.log_if_due(&ctx.counters, ctx.audio.as_ref());
        clock.tick();
    }
    // Session end: persist battery progress and a Continue point.
    // Best-effort — a failed write logs rather than blocking teardown.
    flush_sram_if_dirty(&ctx, &mut last_flushed_sram);
    if let Some(saves) = &ctx.saves {
        match ctx.core.serialize() {
            Ok(Some(state)) => {
                if let Err(e) = saves.write_state(AUTO_SLOT, &state, PlayPath::Native) {
                    eprintln!("[rgp-native] auto save-state write failed: {e}");
                }
            }
            Ok(None) => {} // core has no serialize support — SRAM-only
            Err(e) => eprintln!("[rgp-native] auto save-state failed: {e}"),
        }
    }
}

/// Rolling window state for the periodic perf line: effective fps over the
/// window plus ring fill and underrun/overrun deltas, so on-device timing
/// verification is objective (W270 acceptance). Each line goes to stderr
/// *and*, when configured, to the per-session log file — macOS discards
/// stderr for Finder-launched apps, so the file is what makes a real
/// playtest reviewable after the fact (W274).
///
/// v0.29 W281 (performance-tooling-design.md) adds frame-time percentiles
/// (p50/p95/p99) and a dropped-video-frame delta as fields APPENDED to the
/// end of the existing line — the pre-existing prefix
/// (`[rgp-native] perf: {fps} fps effective, ...`) is byte-for-byte unchanged,
/// so any existing consumer/test that only reads that prefix keeps working.
struct PerfLog {
    window_start: Instant,
    frames: u64,
    underruns: u64,
    overruns: u64,
    dropped_video_frames: u64,
    /// Per-frame tick durations recorded since the last emitted line —
    /// reduced to p50/p95/p99 and cleared each time the line fires.
    frame_times: FrameTimeWindow,
    /// Best-effort file sink; disabled means stderr-only, never an error.
    file: PerfLogFile,
}

impl PerfLog {
    fn new(counters: &PerfCounters, file: PerfLogFile) -> Self {
        PerfLog {
            window_start: Instant::now(),
            frames: counters.frames_run.load(Ordering::Relaxed),
            underruns: counters.underrun_samples.load(Ordering::Relaxed),
            overruns: counters.overrun_samples.load(Ordering::Relaxed),
            dropped_video_frames: counters.dropped_video_frames.load(Ordering::Relaxed),
            frame_times: FrameTimeWindow::default(),
            file,
        }
    }

    /// Records one core-tick's wall-clock duration toward this window's
    /// frame-time percentiles. Called once per tick from `run_core_loop`
    /// (never on the realtime audio path).
    fn record_frame_time(&mut self, sample: Duration) {
        self.frame_times.push(sample);
    }

    fn log_if_due(&mut self, counters: &PerfCounters, audio: Option<&CoreAudio>) {
        let elapsed = self.window_start.elapsed();
        if elapsed < PERF_LOG_INTERVAL {
            return;
        }
        let frames = counters.frames_run.load(Ordering::Relaxed);
        let underruns = counters.underrun_samples.load(Ordering::Relaxed);
        let overruns = counters.overrun_samples.load(Ordering::Relaxed);
        let dropped_video_frames = counters.dropped_video_frames.load(Ordering::Relaxed);
        let fps = (frames - self.frames) as f64 / elapsed.as_secs_f64();
        // Formatted once so the stderr and file copies are always identical.
        // The pre-existing prefix is untouched; percentiles + dropped-frame
        // count are appended after it (additive-only format, W281).
        let mut line = match audio {
            Some(audio) => format!(
                "[rgp-native] perf: {fps:.2} fps effective, ring {:.0} ms, underrun +{}, overrun +{}",
                audio.producer.fill_ms(audio.device_rate),
                underruns - self.underruns,
                overruns - self.overruns,
            ),
            None => format!("[rgp-native] perf: {fps:.2} fps effective, audio off"),
        };
        match self.frame_times.percentiles_ms() {
            Some(p) => {
                line.push_str(&format!(
                    ", frame-time p50/p95/p99 {:.1}/{:.1}/{:.1} ms",
                    p.p50, p.p95, p.p99
                ));
            }
            None => line.push_str(", frame-time n/a"),
        }
        line.push_str(&format!(
            ", dropped-video +{}",
            dropped_video_frames - self.dropped_video_frames
        ));
        eprintln!("{line}");
        self.file.append_line(&line);
        self.window_start = Instant::now();
        self.frames = frames;
        self.underruns = underruns;
        self.overruns = overruns;
        self.dropped_video_frames = dropped_video_frames;
        self.frame_times.reset();
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
    let state = ctx
        .core
        .serialize()?
        .ok_or_else(|| AppError::Unsupported("this core does not support save states".into()))?;
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
    let Some(current) = ctx.core.sram() else {
        return;
    };
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
        Err(e) => eprintln!("[rgp-native] SRAM flush failed: {e}"),
    }
}

/// Drains queued environment events into `ctx`'s state: pixel format, the
/// shared aspect ratio (W345, propagating the W340 reviewer note), HW-render
/// bring-up (W345, lazy — created the first and only time
/// `HwRenderRequested` arrives), and mid-game geometry (which also resizes
/// the HW-render FBO in place, when one exists).
fn drain_environment(ctx: &mut CoreLoop<'_>) {
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
fn drain_video(
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

/// Resamples each queued core batch to the device rate — with the DRC skew
/// for the ring's current fill — and pushes it into the ring. Without an
/// audio output, batches are drained and discarded (video-only session).
fn drain_audio(
    channels: &callbacks::CallbackChannels,
    audio: &mut Option<CoreAudio>,
    scratch: &mut Vec<f32>,
) {
    while let Ok(AudioBatch { samples }) = channels.audio.try_recv() {
        let Some(audio) = audio.as_mut() else {
            continue;
        };
        let skew = audio.producer.skew();
        audio.resampler.resample_into(&samples, skew, scratch);
        audio.producer.push(scratch);
    }
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

    /// The additive-format contract (W281 acceptance): the pre-existing
    /// prefix a hypothetical existing consumer might match on
    /// (`[rgp-native] perf: {fps} fps effective, ...`) must still appear
    /// verbatim, with the new percentile/dropped-frame fields appended after
    /// it — never replacing or reordering the original fields.
    #[test]
    fn perf_log_line_is_additive_over_the_pre_w281_format() {
        let counters = PerfCounters::default();
        let mut perf = PerfLog::new(&counters, PerfLogFile::disabled());
        perf.record_frame_time(Duration::from_millis(16));
        perf.record_frame_time(Duration::from_millis(17));
        counters.frames_run.fetch_add(120, Ordering::Relaxed);
        counters.dropped_video_frames.fetch_add(3, Ordering::Relaxed);
        perf.window_start = Instant::now() - PERF_LOG_INTERVAL;

        // audio == None exercises the pre-W281 "audio off" branch verbatim.
        perf.log_if_due(&counters, None);

        // log_if_due doesn't return the line, so re-derive deterministically
        // via the file sink to assert on its exact text.
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("native-perf.log");
        let mut perf = PerfLog::new(&counters, PerfLogFile::create(Some(&path)));
        perf.record_frame_time(Duration::from_millis(16));
        perf.window_start = Instant::now() - PERF_LOG_INTERVAL;
        perf.log_if_due(&counters, None);

        let content = std::fs::read_to_string(&path).expect("read");
        assert!(
            content.starts_with("[rgp-native] perf: "),
            "prefix changed: {content}"
        );
        assert!(content.contains("fps effective, audio off"));
        assert!(content.contains("frame-time p50/p95/p99"));
        assert!(content.contains("dropped-video +"));
    }

    #[test]
    fn perf_log_reports_frame_time_na_when_no_samples_recorded() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("native-perf.log");
        let counters = PerfCounters::default();
        let mut perf = PerfLog::new(&counters, PerfLogFile::create(Some(&path)));
        perf.window_start = Instant::now() - PERF_LOG_INTERVAL;

        perf.log_if_due(&counters, None);

        let content = std::fs::read_to_string(&path).expect("read");
        assert!(content.contains("frame-time n/a"));
    }
}

/// Headless native-path integration test (W284, issue #28 — "Native-path
/// smoke: load a real (stub) test ROM through the actual NativeRuntime/FFI
/// host headlessly, and assert frames + audio samples are genuinely
/// produced"). CI-safe, automated counterpart to [`manual`] below: instead of
/// an installed real `fceumm_libretro.dylib` + a real ROM (both
/// environment-dependent and gated behind `--ignored`), this builds a
/// synthetic stub core at test time via `cc` — the exact same convention
/// `host.rs`'s `build_stub_core` and `commands::native_play`'s own
/// `build_stub_core` already use — that deterministically emits a
/// non-trivial video frame and a non-silent audio batch on every
/// `retro_run`, so the assertions below can check *real produced content*
/// (not just "no error") without depending on any bundled/copyrighted ROM or
/// real audio hardware.
#[cfg(test)]
mod headless_integration {
    use super::*;
    use std::process::Command;

    /// A minimal libretro core that — unlike `host.rs`'s lifecycle-only stub —
    /// actually drives real video + audio output on every `retro_run`, so a
    /// full [`NativeRuntime`] session run against it produces genuine,
    /// checkable frames and samples:
    ///   * `retro_video_refresh` is called with a real 4x4 RGB565 buffer whose
    ///     bytes are NOT all zero/uniform (a blank/all-black frame would pass
    ///     an `is_some()` check but not prove real content made it through).
    ///   * `retro_audio_sample_batch` is called with a real, non-silent
    ///     interleaved-stereo `i16` batch (a 440 Hz-ish deterministic pattern),
    ///     so "audio samples are genuinely produced" is checkable, not assumed.
    const STUB_AV_CORE_C: &str = r#"
#include <stddef.h>
#include <stdbool.h>

struct retro_system_info {
    const char *library_name;
    const char *library_version;
    const char *valid_extensions;
    bool need_fullpath;
    bool block_extract;
};
struct retro_game_geometry { unsigned base_width, base_height, max_width, max_height; float aspect_ratio; };
struct retro_system_timing { double fps, sample_rate; };
struct retro_system_av_info { struct retro_game_geometry geometry; struct retro_system_timing timing; };
struct retro_game_info { const char *path; const void *data; size_t size; const char *meta; };

typedef bool (*retro_environment_t)(unsigned cmd, void *data);
typedef void (*retro_video_refresh_t)(const void *data, unsigned width, unsigned height, size_t pitch);
typedef size_t (*retro_audio_sample_batch_t)(const short *data, size_t frames);
typedef void (*retro_input_poll_t)(void);
typedef short (*retro_input_state_t)(unsigned port, unsigned device, unsigned index, unsigned id);

static retro_environment_t env_cb = 0;
static retro_video_refresh_t video_cb = 0;
static retro_audio_sample_batch_t audio_cb = 0;
static int tick = 0;

void retro_init(void) {
    bool can_dupe = false;
    env_cb(3 /* RETRO_ENVIRONMENT_GET_CAN_DUPE */, &can_dupe);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub AV Core";
    info->library_version = "1.0";
    info->valid_extensions = "nes";
    info->need_fullpath = false;
    info->block_extract = false;
}

void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 4;
    info->geometry.base_height = 4;
    info->geometry.max_width = 4;
    info->geometry.max_height = 4;
    info->geometry.aspect_ratio = 0.0f;
    info->timing.fps = 60.0;
    info->timing.sample_rate = 44100.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) { audio_cb = cb; }
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) {
    return true;
}

void retro_unload_game(void) {}

/* RGB565: 4x4 pixels, 2 bytes each. Non-uniform + non-zero so a test can
 * prove real varying pixel content arrived, not a blank/zeroed buffer. Audio:
 * 64 interleaved stereo i16 frames of a simple non-silent deterministic
 * pattern (never all-zero), so a test can prove real sample content arrived. */
void retro_run(void) {
    unsigned short frame_buf[16];
    for (int i = 0; i < 16; i++) {
        frame_buf[i] = (unsigned short)((i * 37 + tick * 11 + 1) & 0xFFFF);
    }
    if (video_cb) video_cb(frame_buf, 4, 4, 8);

    short audio_buf[128]; /* 64 frames * 2 channels */
    for (int i = 0; i < 64; i++) {
        short sample = (short)(((i * 257) % 2000) - 1000 + tick);
        audio_buf[i * 2] = sample;
        audio_buf[i * 2 + 1] = (short)(-sample);
    }
    if (audio_cb) audio_cb(audio_buf, 64);

    tick++;
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

    /// Minimal environment callback for lifecycle bring-up — mirrors
    /// `host.rs`'s own `test_environment`.
    unsafe extern "C" fn test_environment(_cmd: u32, _data: *mut std::os::raw::c_void) -> bool {
        false
    }

    /// Compiles [`STUB_AV_CORE_C`] to a `.dylib` in `dir`. `None` (skip, not
    /// fail) with no C toolchain on `PATH` — same environment-independence
    /// posture as every other stub-core test in this crate.
    fn build_stub_av_core(dir: &Path) -> Option<PathBuf> {
        let c_path = dir.join("stub_av_core.c");
        std::fs::write(&c_path, STUB_AV_CORE_C).ok()?;
        let dylib_path = dir.join("stub_av_core.dylib");
        let status = Command::new("cc")
            .arg("-dynamiclib")
            .arg("-o")
            .arg(&dylib_path)
            .arg(&c_path)
            .status()
            .ok()?;
        status.success().then_some(dylib_path)
    }

    /// Drives the raw FFI lifecycle directly (load → set_environment → init →
    /// wire callbacks → load_game → run_frame), reading the real
    /// [`callbacks::CallbackChannels`] the runtime itself drains from. This is
    /// the lowest-level, hardware-independent proof that the native hosting
    /// layer genuinely produces both frame and audio content on a real
    /// `retro_run` tick — no `cpal`/audio-device dependency, so it is fully
    /// deterministic in a headless CI runner.
    #[test]
    fn a_real_run_frame_tick_produces_genuine_video_and_audio_content() {
        // Shares the crate-wide lock other tests that drive
        // `callbacks::install`/`uninstall` directly already use (host.rs,
        // core_options::probe, commands::native_play) — never race them.
        let _guard = crate::play::native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_av_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };

        let channels = callbacks::install();
        let mut core = LibretroCore::load(&dylib).expect("load stub AV core");
        core.set_environment(test_environment);
        core.init().expect("init after set_environment");
        core.set_video_refresh(callbacks::video_refresh);
        core.set_audio_sample_batch(callbacks::audio_sample_batch);

        let rom = dir.path().join("game.nes");
        std::fs::write(&rom, b"fake rom bytes").expect("write rom");
        core.load_game(&rom).expect("load_game");

        core.run_frame().expect("run frame");

        // Genuine video content: real dimensions, real non-zero, non-uniform
        // bytes — proves the frame is actually produced, not a blank/zeroed
        // placeholder that would also satisfy a weaker "is_some()" check.
        let video = channels
            .video
            .recv_timeout(Duration::from_secs(2))
            .expect("a video frame must have been produced");
        assert_eq!((video.width, video.height, video.pitch), (4, 4, 8));
        assert_eq!(video.data.len(), 32); // 4x4 @ 2 bytes/pixel (RGB565)
        assert!(video.data.iter().any(|&b| b != 0), "frame must not be blank");
        let all_same = video.data.windows(2).all(|w| w[0] == w[1]);
        assert!(!all_same, "frame must carry varying pixel content");

        // Genuine audio content: real sample count, real non-silent values —
        // proves audio samples are actually produced, not an empty/silent
        // batch that would also satisfy a weaker "no error" check.
        let audio = channels
            .audio
            .recv_timeout(Duration::from_secs(2))
            .expect("an audio batch must have been produced");
        assert_eq!(audio.samples.len(), 128); // 64 frames * 2 channels
        assert!(
            audio.samples.iter().any(|&s| s != 0),
            "audio batch must not be silent"
        );

        core.unload_game();
        drop(core);
        callbacks::uninstall();
    }

    /// End-to-end proof through the real public [`NativeRuntime::start`]
    /// entrypoint (not the raw FFI lifecycle above) — the same constructor
    /// `commands::native_play::start_native_play` calls in production,
    /// spawning the real core thread (and, best-effort, the real audio
    /// thread) and letting the run loop tick on its own `FrameClock`. Asserts
    /// [`NativeRuntime::latest_frame`] genuinely returns fresh, real pixel
    /// data across multiple polls — the actual IPC-facing observable the
    /// frontend's frame poller depends on — proving the full stack (FFI core
    /// → callbacks → runtime frame conversion → the shared frame slot) works
    /// headlessly end-to-end, not just that `start()` returns `Ok`.
    #[test]
    fn native_runtime_start_produces_polling_real_frames() {
        let _guard = crate::play::native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_av_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let rom_path = dir.path().join("game.nes");
        std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

        let runtime =
            NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");

        // Poll until a real frame lands (the core thread runs asynchronously
        // on its own FrameClock) — generous relative to a 60 fps core tick,
        // tight enough that a genuinely broken pipeline still fails fast.
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut first_frame = None;
        while Instant::now() < deadline {
            if let Some((seq, frame)) = runtime.latest_frame() {
                first_frame = Some((seq, frame));
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let (first_seq, first_frame) =
            first_frame.expect("a real frame must be produced within the deadline");
        assert_eq!((first_frame.width, first_frame.height), (4, 4));
        // RGBA8888: 4 bytes/pixel, 4x4 = 64 bytes.
        assert_eq!(first_frame.data.len(), 64);
        assert!(
            first_frame.data.iter().any(|&b| b != 0),
            "converted RGBA frame must not be blank"
        );

        // The sequence number must keep advancing — proves the runtime is
        // continuously producing NEW frames, not replaying one static buffer.
        std::thread::sleep(Duration::from_millis(200));
        let (later_seq, _) = runtime
            .latest_frame()
            .expect("a frame must still be available");
        assert!(
            later_seq > first_seq,
            "sequence number must advance as new frames are produced (first={first_seq}, later={later_seq})"
        );

        drop(runtime); // stops + joins both threads
    }

    /// W340 acceptance: "a second software-rendered system boots through the
    /// same host in a test with a stub core reporting non-NES
    /// geometry/timing." A stub core deliberately shaped nothing like NES
    /// (8x6 pixels vs. 256x240, 50 fps vs. ~60.0988, 22050 Hz vs. 48000+) —
    /// if `NativeRuntime`/`run_core_loop` had any hard-coded NES assumption
    /// left over (a fixed frame size, a fixed pacing period, a fixed sample
    /// rate), this stub's frames/pacing would be wrong. Everything here comes
    /// from the same `NativeRuntime::start` entrypoint and the same
    /// `retro_get_system_av_info` read path real cores use — no
    /// system-specific branch anywhere in the host.
    const STUB_ALT_GEOMETRY_CORE_C: &str = r#"
#include <stddef.h>
#include <stdbool.h>

struct retro_system_info {
    const char *library_name;
    const char *library_version;
    const char *valid_extensions;
    bool need_fullpath;
    bool block_extract;
};
struct retro_game_geometry { unsigned base_width, base_height, max_width, max_height; float aspect_ratio; };
struct retro_system_timing { double fps, sample_rate; };
struct retro_system_av_info { struct retro_game_geometry geometry; struct retro_system_timing timing; };
struct retro_game_info { const char *path; const void *data; size_t size; const char *meta; };

typedef bool (*retro_environment_t)(unsigned cmd, void *data);
typedef void (*retro_video_refresh_t)(const void *data, unsigned width, unsigned height, size_t pitch);
typedef size_t (*retro_audio_sample_batch_t)(const short *data, size_t frames);
typedef void (*retro_input_poll_t)(void);
typedef short (*retro_input_state_t)(unsigned port, unsigned device, unsigned index, unsigned id);

static retro_environment_t env_cb = 0;
static retro_video_refresh_t video_cb = 0;
static int tick = 0;

void retro_init(void) {
    bool can_dupe = false;
    env_cb(3 /* RETRO_ENVIRONMENT_GET_CAN_DUPE */, &can_dupe);
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub Alt-Geometry Core";
    info->library_version = "1.0";
    info->valid_extensions = "alt";
    info->need_fullpath = false;
    info->block_extract = false;
}

/* Deliberately unlike NES's 256x240 @ ~60.0988 fps / 48000+ Hz: an 8x6
 * frame at 50 fps and 22050 Hz — a second, differently-shaped
 * software-rendered "system" hosted through the exact same pipeline. */
void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 8;
    info->geometry.base_height = 6;
    info->geometry.max_width = 8;
    info->geometry.max_height = 6;
    info->geometry.aspect_ratio = 4.0f / 3.0f;
    info->timing.fps = 50.0;
    info->timing.sample_rate = 22050.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) { return true; }
void retro_unload_game(void) {}

void retro_run(void) {
    unsigned short buf[48]; /* 8x6 */
    for (int i = 0; i < 48; i++) buf[i] = (unsigned short)((i * 29 + tick * 7 + 1) & 0xFFFF);
    if (video_cb) video_cb(buf, 8, 6, 16);
    tick++;
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

    fn build_stub_alt_geometry_core(dir: &Path) -> Option<PathBuf> {
        let c_path = dir.join("stub_alt_geometry_core.c");
        std::fs::write(&c_path, STUB_ALT_GEOMETRY_CORE_C).ok()?;
        let dylib_path = dir.join("stub_alt_geometry_core.dylib");
        let status = Command::new("cc")
            .arg("-dynamiclib")
            .arg("-o")
            .arg(&dylib_path)
            .arg(&c_path)
            .status()
            .ok()?;
        status.success().then_some(dylib_path)
    }

    #[test]
    fn native_runtime_hosts_a_non_nes_geometry_and_timing_stub() {
        let _guard = crate::play::native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_alt_geometry_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let rom_path = dir.path().join("game.alt");
        std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

        let runtime = NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut first_frame = None;
        while Instant::now() < deadline {
            if let Some((seq, frame)) = runtime.latest_frame() {
                first_frame = Some((seq, frame));
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let (_seq, frame) = first_frame.expect("a real frame must be produced within the deadline");

        // The frame pipe carries the core's own geometry end to end, not a
        // fixed NES-shaped buffer — 8x6 RGBA8888 (4 bytes/pixel).
        assert_eq!((frame.width, frame.height), (8, 6));
        assert_eq!(frame.data.len(), 8 * 6 * 4);
        assert!(frame.data.iter().any(|&b| b != 0), "frame must not be blank");

        // Timing: at 50 fps (vs. NES's ~60.0988), the number of run-loop
        // ticks inside a fixed window discriminates which rate the loop paces
        // at. The stub emits exactly one video frame per `retro_run` and the
        // loop drains once per tick, so the frame sequence number is a tick
        // counter. The window is anchored on our own two `latest_frame`
        // reads (startup/setup time never leaks into it), and both bounds
        // scale with the *measured* window so scheduler jitter in the sleep
        // itself cannot skew the expectation.
        let (seq_before, _) = runtime.latest_frame().expect("first frame already observed");
        let window_start = Instant::now();
        std::thread::sleep(Duration::from_secs(1)); // ~50 ticks at 50 fps, ~60 at NES rate
        let (seq_after, _) = runtime.latest_frame().expect("frames must still be flowing");
        let elapsed = window_start.elapsed().as_secs_f64();
        let ticks = seq_after.wrapping_sub(seq_before);
        let expected_at_50 = elapsed * 50.0;
        let expected_at_nes = elapsed * 60.0988;
        // Generous lower bound (CI scheduler stalls, ±1-tick read
        // quantization at each end) that still requires ~50 Hz progress...
        assert!(
            ticks as f64 >= expected_at_50 * 0.7,
            "expected ~{expected_at_50:.1} ticks at 50 fps over {elapsed:.3}s, got {ticks}"
        );
        // ...and an upper bound at the midpoint between the two candidate
        // rates: a loop wrongly hard-coded to NES's ~60.0988 fps would
        // produce ~{expected_at_nes:.1} ticks and overshoot it.
        assert!(
            (ticks as f64) < (expected_at_50 + expected_at_nes) / 2.0,
            "tick rate looks like NES ~60.0988 fps, not the stub's declared 50 fps: \
             {ticks} ticks in {elapsed:.3}s (50 fps ≈ {expected_at_50:.1}, \
             60.0988 fps ≈ {expected_at_nes:.1})"
        );

        drop(runtime); // stops + joins both threads
    }

    /// W345 acceptance ("readback throughput ... does not regress the frame
    /// pipe" / "software-render systems are untouched"): an end-to-end proof
    /// that a core negotiating `RETRO_ENVIRONMENT_SET_HW_RENDER` boots
    /// through the exact same [`NativeRuntime::start`] entrypoint as every
    /// software-rendered stub above, and that its FBO-rendered frames arrive
    /// at [`NativeRuntime::latest_frame`] as real, non-blank RGBA pixels —
    /// proving the whole chain (environment negotiation → CGL/FBO bring-up →
    /// `context_reset` → the core drawing via real `glClearColor`/`glClear`
    /// resolved through `get_proc_address` → the `RETRO_HW_FRAME_BUFFER_VALID`
    /// sentinel → `glReadPixels` readback → the same frame slot every
    /// software core uses) headlessly, with no bundled/copyrighted ROM or
    /// real N64 core. macOS-only (HW-render negotiation is refused
    /// elsewhere), matching this module's other `cfg(target_os = "macos")`
    /// gates.
    #[cfg(target_os = "macos")]
    const STUB_HW_RENDER_CORE_C: &str = r#"
#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

struct retro_system_info {
    const char *library_name;
    const char *library_version;
    const char *valid_extensions;
    bool need_fullpath;
    bool block_extract;
};
struct retro_game_geometry { unsigned base_width, base_height, max_width, max_height; float aspect_ratio; };
struct retro_system_timing { double fps, sample_rate; };
struct retro_system_av_info { struct retro_game_geometry geometry; struct retro_system_timing timing; };
struct retro_game_info { const char *path; const void *data; size_t size; const char *meta; };

typedef bool (*retro_environment_t)(unsigned cmd, void *data);
typedef void (*retro_video_refresh_t)(const void *data, unsigned width, unsigned height, size_t pitch);
typedef size_t (*retro_audio_sample_batch_t)(const short *data, size_t frames);
typedef void (*retro_input_poll_t)(void);
typedef short (*retro_input_state_t)(unsigned port, unsigned device, unsigned index, unsigned id);

typedef void (*retro_hw_context_reset_t)(void);
typedef uintptr_t (*retro_hw_get_current_framebuffer_t)(void);
typedef void (*retro_proc_address_t)(void);
typedef retro_proc_address_t (*retro_hw_get_proc_address_t)(const char *sym);
struct retro_hw_render_callback {
    int context_type;
    retro_hw_context_reset_t context_reset;
    retro_hw_get_current_framebuffer_t get_current_framebuffer;
    retro_hw_get_proc_address_t get_proc_address;
    bool depth;
    bool stencil;
    bool bottom_left_origin;
    unsigned version_major;
    unsigned version_minor;
    bool cache_context;
    retro_hw_context_reset_t context_destroy;
    bool debug_context;
};

static retro_environment_t env_cb = 0;
static retro_video_refresh_t video_cb = 0;
static struct retro_hw_render_callback hw = {0};
static int context_reset_calls = 0;
static void (*glBindFramebuffer_p)(unsigned, unsigned) = 0;
static void (*glClearColor_p)(float, float, float, float) = 0;
static void (*glClear_p)(unsigned) = 0;

static void on_context_reset(void) {
    context_reset_calls++;
    glBindFramebuffer_p = (void (*)(unsigned, unsigned)) hw.get_proc_address("glBindFramebuffer");
    glClearColor_p = (void (*)(float, float, float, float)) hw.get_proc_address("glClearColor");
    glClear_p = (void (*)(unsigned)) hw.get_proc_address("glClear");
}

void retro_init(void) {
    hw.context_type = 3; /* RETRO_HW_CONTEXT_OPENGL_CORE */
    hw.context_reset = on_context_reset;
    hw.depth = false;
    hw.stencil = false;
    hw.bottom_left_origin = false;
    bool accepted = env_cb(14 /* RETRO_ENVIRONMENT_SET_HW_RENDER */, &hw);
    (void)accepted; /* the test asserts on real frame content, not this flag */
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub HW-Render Core";
    info->library_version = "1.0";
    info->valid_extensions = "z64";
    info->need_fullpath = false;
    info->block_extract = false;
}

void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 4;
    info->geometry.base_height = 4;
    info->geometry.max_width = 4;
    info->geometry.max_height = 4;
    info->geometry.aspect_ratio = 4.0f / 3.0f;
    info->timing.fps = 60.0;
    info->timing.sample_rate = 44100.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) { return true; }
void retro_unload_game(void) {}

/* Draws a known, non-black color into the FBO Harmony handed out via
 * get_current_framebuffer, then reports the frame via the
 * RETRO_HW_FRAME_BUFFER_VALID sentinel rather than a real pointer — exactly
 * the libretro HW-render contract. */
void retro_run(void) {
    if (glBindFramebuffer_p && hw.get_current_framebuffer) {
        glBindFramebuffer_p(0x8D40 /* GL_FRAMEBUFFER */, (unsigned)hw.get_current_framebuffer());
    }
    if (glClearColor_p) glClearColor_p(0.2f, 0.6f, 1.0f, 1.0f);
    if (glClear_p) glClear_p(0x00004000 /* GL_COLOR_BUFFER_BIT */);
    if (video_cb) video_cb((const void *)(uintptr_t)(intptr_t)-1, 4, 4, 0);
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

    #[cfg(target_os = "macos")]
    fn build_stub_hw_render_core(dir: &Path) -> Option<PathBuf> {
        let c_path = dir.join("stub_hw_render_core.c");
        std::fs::write(&c_path, STUB_HW_RENDER_CORE_C).ok()?;
        let dylib_path = dir.join("stub_hw_render_core.dylib");
        let status = Command::new("cc")
            .arg("-dynamiclib")
            .arg("-o")
            .arg(&dylib_path)
            .arg(&c_path)
            .status()
            .ok()?;
        status.success().then_some(dylib_path)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels() {
        let _guard = crate::play::native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_hw_render_core(dir.path()) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let rom_path = dir.path().join("game.z64");
        std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

        let runtime = NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut first_frame = None;
        while Instant::now() < deadline {
            if let Some((seq, frame)) = runtime.latest_frame() {
                first_frame = Some((seq, frame));
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let (_seq, frame) =
            first_frame.expect("a real HW-rendered frame must be produced within the deadline");

        assert_eq!((frame.width, frame.height), (4, 4));
        assert_eq!(frame.data.len(), 4 * 4 * 4);
        // The stub cleared to (0.2, 0.6, 1.0, 1.0) — approximately
        // (51, 153, 255, 255) in RGBA8888. Every pixel must carry that real,
        // non-blank GPU-rendered color, proving the FBO readback (not a
        // stale/zeroed buffer) reached the frame pipe.
        for px in frame.data.chunks_exact(4) {
            assert!(
                (45..=57).contains(&px[0]) && (147..=159).contains(&px[1]) && px[2] >= 250 && px[3] == 255,
                "unexpected pixel {px:?}, expected ~[51, 153, 255, 255]"
            );
        }

        drop(runtime); // stops + joins both threads; context_destroy fires
    }
}

/// Manual, real-device verification harness for the v0.21 "Bedrock"
/// stop-and-reassess point ("is native audio actually clean?" —
/// release-planning-v0.21.md §3), kept meaningful for W270 (pacing/resampler
/// rework) by-ear checks. Not run by `cargo test` (`#[ignore]`); run it
/// explicitly once a core + ROM are available:
///
/// ```text
/// HARMONY_MANUAL_AUDIO_CORE=/path/to/fceumm_libretro.dylib \
/// HARMONY_MANUAL_AUDIO_ROM=/path/to/game.nes \
/// cargo test --release manual_play_produces_audible_output -- --ignored --nocapture
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

        let runtime = NativeRuntime::start(
            &PathBuf::from(core_path),
            &PathBuf::from(rom_path),
            None,
            None,
        )
        .expect("native runtime failed to start");

        println!("playing for 5s — listen for cold-start garble (#15) and speed/pitch (W270)...");
        std::thread::sleep(Duration::from_secs(5));
        let frame = runtime.latest_frame();
        println!(
            "latest frame present: {}",
            frame
                .map(|(seq, f)| format!("{}x{} (seq {seq})", f.width, f.height))
                .unwrap_or_else(|| "none".into())
        );
        drop(runtime);
    }

    /// W345's on-device acceptance criterion ("an N64 ROM boots and renders
    /// through the native host on device") — the real-hardware counterpart
    /// to the headless HW-render stub-core proof
    /// (`headless_integration::native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels`),
    /// which proves the FBO/readback plumbing but necessarily uses a fake
    /// core, not real N64 emulation. Not run by `cargo test` (`#[ignore]`);
    /// run it explicitly once mupen64plus_next is installed and a ROM is
    /// available:
    ///
    /// ```text
    /// RGP_N64_CORE=/path/to/mupen64plus_next_libretro.dylib \
    /// RGP_N64_ROM=/path/to/game.z64 \
    /// cargo test --release manual_n64_boots_and_renders_via_hw_render -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore]
    fn manual_n64_boots_and_renders_via_hw_render() {
        let core_path = std::env::var("RGP_N64_CORE")
            .expect("set RGP_N64_CORE to an installed mupen64plus_next_libretro.dylib path");
        let rom_path =
            std::env::var("RGP_N64_ROM").expect("set RGP_N64_ROM to a real .z64/.n64 ROM path");

        let runtime = NativeRuntime::start(
            &PathBuf::from(core_path),
            &PathBuf::from(rom_path),
            None,
            None,
        )
        .expect("native runtime failed to start");

        println!("playing for 5s — confirm a real N64 frame renders (HW-render, W345)...");
        std::thread::sleep(Duration::from_secs(5));
        let frame = runtime.latest_frame();
        println!(
            "latest frame present: {}",
            frame
                .as_ref()
                .map(|(seq, f)| format!(
                    "{}x{} aspect={:?} (seq {seq})",
                    f.width, f.height, f.aspect_ratio
                ))
                .unwrap_or_else(|| "none".into())
        );
        assert!(frame.is_some(), "an N64 session must produce at least one frame");
        drop(runtime);
    }
}
