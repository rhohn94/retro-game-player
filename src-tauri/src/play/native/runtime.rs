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
use super::perf_file::PerfLogFile;
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
        let (core, fps, core_sample_rate) = match bring_up_core(core_path, rom_path, &saves) {
            Ok(v) => v,
            Err(e) => {
                callbacks::uninstall(); // don't leave dead sinks installed
                return Err(e);
            }
        };

        let latest_frame = Arc::new(Mutex::new(FrameSlot::default()));
        // Libretro's implicit default before a core negotiates otherwise.
        let pixel_format = Arc::new(Mutex::new(PixelFormat::Rgb1555));
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

/// Loads and initializes the core + ROM (+ saved SRAM), returning it with
/// the fps and audio sample rate it reports.
fn bring_up_core(
    core_path: &Path,
    rom_path: &Path,
    saves: &Option<GameSaves>,
) -> AppResult<(LibretroCore, f64, f64)> {
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
    Ok((core, fps, av.timing.sample_rate))
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
    while !ctx.stop.load(Ordering::Relaxed) {
        if ctx.paused.load(Ordering::Relaxed) {
            // Frozen behind the overlay: no frames tick, but save/load
            // commands still answer so the slot picker works while paused.
            handle_commands(&mut ctx);
            std::thread::sleep(frame_duration);
            was_paused = true;
            continue;
        }
        if was_paused {
            // Resume from "now" — replaying the deadlines missed while
            // paused would burst the core to catch up.
            clock.resync();
            was_paused = false;
        }
        if ctx.core.run_frame().is_err() {
            // A bug (run before load_game), not a runtime fault a retry can
            // fix — stop rather than spin.
            break;
        }
        ctx.counters.frames_run.fetch_add(1, Ordering::Relaxed);
        // Before video: a core typically negotiates its pixel format once
        // near startup, before its first real video_refresh call.
        drain_environment(&ctx.channels, ctx.pixel_format, ctx.stop);
        drain_video(
            &ctx.channels,
            ctx.latest_frame,
            ctx.pixel_format,
            &mut rgba_scratch,
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
struct PerfLog {
    window_start: Instant,
    frames: u64,
    underruns: u64,
    overruns: u64,
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
            file,
        }
    }

    fn log_if_due(&mut self, counters: &PerfCounters, audio: Option<&CoreAudio>) {
        let elapsed = self.window_start.elapsed();
        if elapsed < PERF_LOG_INTERVAL {
            return;
        }
        let frames = counters.frames_run.load(Ordering::Relaxed);
        let underruns = counters.underrun_samples.load(Ordering::Relaxed);
        let overruns = counters.overrun_samples.load(Ordering::Relaxed);
        let fps = (frames - self.frames) as f64 / elapsed.as_secs_f64();
        // Formatted once so the stderr and file copies are always identical.
        let line = match audio {
            Some(audio) => format!(
                "[rgp-native] perf: {fps:.2} fps effective, ring {:.0} ms, underrun +{}, overrun +{}",
                audio.producer.fill_ms(audio.device_rate),
                underruns - self.underruns,
                overruns - self.overruns,
            ),
            None => format!("[rgp-native] perf: {fps:.2} fps effective, audio off"),
        };
        eprintln!("{line}");
        self.file.append_line(&line);
        self.window_start = Instant::now();
        self.frames = frames;
        self.underruns = underruns;
        self.overruns = overruns;
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
/// Conversion goes through `scratch`, which ping-pongs with the slot's
/// previous buffer — zero allocation in steady state.
fn drain_video(
    channels: &callbacks::CallbackChannels,
    latest_frame: &Mutex<FrameSlot>,
    pixel_format: &Mutex<PixelFormat>,
    scratch: &mut Vec<u8>,
) {
    let mut newest = None;
    while let Ok(frame) = channels.video.try_recv() {
        newest = Some(frame);
    }
    let Some(frame) = newest else { return };
    let format = *pixel_format.lock().unwrap_or_else(|p| p.into_inner());
    to_rgba8_into(&frame, format, scratch);
    let mut slot = latest_frame.lock().unwrap_or_else(|p| p.into_inner());
    // Recycle the displaced frame's allocation as the next scratch buffer.
    let recycled = slot.frame.take().map(|f| f.data).unwrap_or_default();
    slot.frame = Some(Rgba8Frame {
        data: std::mem::replace(scratch, recycled),
        width: frame.width,
        height: frame.height,
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
}
