//! The public [`NativeRuntime`] handle: spawns the core + audio threads,
//! brings the core and (best-effort) audio device up, and exposes the
//! save/load/pause/volume/latest-frame surface `commands::native_play` calls
//! into. The per-tick drive loop itself lives in [`super::core_loop`].

use super::core_loop::{run_core_loop, CoreLoop};
use super::video::FrameSlot;
use crate::play::achievements::{AchievementRuntime, AchievementSet, UnlockEvent};
use crate::play::native::audio::{
    run_audio_thread, AudioBringUp, AudioProducer, PerfCounters, SharedGain, StereoResampler,
};
use crate::play::native::callbacks::{self};
use crate::play::native::ffi::RETRO_DEVICE_JOYPAD;
use crate::play::native::frame::Rgba8Frame;
use crate::play::native::host::LibretroCore;
use crate::play::native::perf_file::PerfLogFile;
use crate::error::{AppError, AppResult};
use crate::play::saves::GameSaves;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// How often the core loop checks battery SRAM for changes and flushes it to
/// disk. Losing at most this much battery progress on a crash is the
/// trade-off against hashing 8 KiB every frame.
pub(super) const SRAM_FLUSH_INTERVAL: Duration = Duration::from_secs(30);

/// How long IPC-side save/load calls wait for the core thread to answer.
/// Serialize on an 8-bit core is microseconds; a full second of headroom
/// means a timeout signals a wedged core loop, not a slow save.
const COMMAND_REPLY_TIMEOUT: Duration = Duration::from_secs(2);

/// How long `start` waits for the audio thread to open the device and hand
/// back the ring producer. Device bring-up is tens of milliseconds; hitting
/// this means audio is wedged, and the session proceeds video-only.
const AUDIO_BRING_UP_TIMEOUT: Duration = Duration::from_secs(2);

/// Fallback frame rate when a core reports `fps <= 0` (shouldn't happen for
/// any real core, but `retro_get_system_av_info` is core-controlled input).
const FALLBACK_FPS: f64 = 60.0;

/// Requests executed **on the core thread** between frames — libretro calls
/// are not thread-safe off the run loop, so the runtime never touches the
/// core from IPC threads directly.
pub(super) enum CoreCommand {
    SaveState {
        slot: String,
        reply: Sender<AppResult<()>>,
    },
    LoadState {
        slot: String,
        reply: Sender<AppResult<()>>,
    },
    /// W370: loads (or replaces) the active achievement set. A `reply` round
    /// trip (rather than fire-and-forget) so `NativeRuntime::load_achievement_set`
    /// can surface a malformed-trigger-string error to its caller, matching
    /// the save/load commands' same convention.
    LoadAchievementSet {
        set: AchievementSet,
        reply: Sender<AppResult<()>>,
    },
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
    /// W370: the unlock stream a future command surface (W371/W372) drains.
    /// `Mutex`-wrapped because draining happens from whatever IPC thread
    /// calls it, not the core thread that produces unlocks.
    unlocks: Mutex<Receiver<UnlockEvent>>,
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
        let pixel_format = Arc::new(Mutex::new(callbacks::PixelFormat::Rgb1555));
        let aspect_ratio = Arc::new(Mutex::new(aspect_ratio));
        let stop = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let gain = Arc::new(SharedGain::new());
        let counters = Arc::new(PerfCounters::default());
        let (commands, command_rx) = mpsc::channel();
        // W370: always constructed (empty — no achievement set loaded until
        // `load_achievement_set` is called), so `do_frame`'s no-set fast
        // path is exercised by every session, not just ones that opt in.
        let (achievements, unlocks) = AchievementRuntime::new();

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
                    achievements,
                    frame_counter: 0,
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
            unlocks: Mutex::new(unlocks),
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

    /// Activates `set`'s achievements for the remainder of this session
    /// (W370; a future command surface owned by W371 calls this once it has
    /// fetched a set for the running game's hash). Executed on the core
    /// thread, like save/load, since the achievement runtime is only ever
    /// touched from there.
    pub fn load_achievement_set(&self, set: AchievementSet) -> AppResult<()> {
        self.round_trip(|reply| CoreCommand::LoadAchievementSet { set, reply })
    }

    /// Drains every unlock event produced since the last drain (W370). A
    /// future command surface (W371/W372) polls this the same way
    /// [`Self::latest_frame`] is polled for video.
    pub fn drain_unlocks(&self) -> Vec<UnlockEvent> {
        let rx = self.unlocks.lock().unwrap_or_else(|p| p.into_inner());
        rx.try_iter().collect()
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
pub(super) struct CoreBringUp {
    pub(super) core: LibretroCore,
    pub(super) fps: f64,
    pub(super) audio_sample_rate: f64,
    /// The core's declared display aspect ratio at boot
    /// (`retro_get_system_av_info`'s `geometry.aspect_ratio`) — `None` for a
    /// non-positive value, matching libretro's "derive it from width/height"
    /// convention. Superseded at runtime by any
    /// `RETRO_ENVIRONMENT_SET_GEOMETRY` renegotiation (W340).
    pub(super) aspect_ratio: Option<f32>,
    /// The core's declared max frame dimensions — the size an HW-render FBO
    /// is allocated at (never renegotiated except by `SET_GEOMETRY`, which
    /// resizes the FBO in place). Meaningless for a software-rendered core
    /// (nothing reads it).
    pub(super) max_width: u32,
    pub(super) max_height: u32,
}

/// Loads and initializes the core + ROM (+ saved SRAM), returning it with
/// the facts the rest of bring-up needs ([`CoreBringUp`]).
pub(super) fn bring_up_core(
    core_path: &Path,
    rom_path: &Path,
    saves: &Option<GameSaves>,
) -> AppResult<CoreBringUp> {
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
    // Explicitly announce a joypad on every hosted port (W350, multiplayer
    // input) — after load_game, matching RetroArch's own ordering
    // convention: a core may only finalize its per-port controller state
    // once a game (and therefore its controller requirements) is known.
    // libretro already defaults every port to joypad, so this is
    // contract-polite rather than strictly required, but matters for cores
    // that lazily allocate per-port state on this call.
    for port in 0..callbacks::NUM_NATIVE_INPUT_PORTS as u32 {
        core.set_controller_port_device(port, RETRO_DEVICE_JOYPAD);
    }
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
/// mid-game (`SET_GEOMETRY`, in [`super::video::drain_environment`]) geometry
/// reads so the two call sites can't drift on what "unset" means.
pub(super) fn positive_aspect_ratio(raw: f32) -> Option<f32> {
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
pub(super) struct CoreAudio {
    pub(super) resampler: StereoResampler,
    pub(super) producer: AudioProducer,
    pub(super) device_rate: f64,
}
