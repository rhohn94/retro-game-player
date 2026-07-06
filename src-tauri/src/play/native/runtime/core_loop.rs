//! `CoreLoop`'s per-tick state and [`run_core_loop`]'s drive loop: paces
//! `retro_run` on an absolute-deadline [`FrameClock`], drains each frame's
//! environment/video/audio callback output into the shared buffers
//! ([`super::video`], [`super::audio`]), executes save/load commands between
//! frames, flushes dirty battery SRAM periodically, logs perf counters
//! ([`super::perf`]), and writes the final SRAM + auto save-state on exit.
//! W212 — see docs/design/native-emulation-design.md §2.

use super::perf::PerfLog;
use super::session::{CoreAudio, CoreCommand, SRAM_FLUSH_INTERVAL};
use super::video::{drain_environment, drain_video, FrameSlot};
use crate::error::{AppError, AppResult};
use crate::play::achievements::AchievementRuntime;
use crate::play::native::callbacks::{self, PixelFormat};
use crate::play::native::clock::FrameClock;
use crate::play::native::host::LibretroCore;
use crate::play::native::hw_render::HwRenderContext;
use crate::play::native::perf_file::PerfLogFile;
use crate::play::saves::{GameSaves, PlayPath, AUTO_SLOT};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::play::native::audio::PerfCounters;

/// Everything the core thread owns for one session.
pub(super) struct CoreLoop<'a> {
    pub(super) core: LibretroCore,
    pub(super) channels: callbacks::CallbackChannels,
    pub(super) fps: f64,
    pub(super) saves: Option<GameSaves>,
    /// `None` = no usable audio output; batches are drained and discarded.
    pub(super) audio: Option<CoreAudio>,
    pub(super) counters: Arc<PerfCounters>,
    /// Per-session file sink for the perf line (W274); disabled = stderr-only.
    pub(super) perf_file: PerfLogFile,
    pub(super) commands: Receiver<CoreCommand>,
    /// The shared latest-frame slot — also carries the frame pipe's current
    /// display aspect ratio (W340's reviewer note, W345, folded in by
    /// W380): seeded from the core's boot-time `av_info` and updated on
    /// `RETRO_ENVIRONMENT_SET_GEOMETRY`; read into every delivered
    /// [`crate::play::native::frame::Rgba8Frame`] so the frontend can render
    /// at the correct aspect instead of assuming a fixed box. Folding aspect
    /// ratio into this same slot (rather than a second mutex) means a
    /// publish or an IPC poll is a single lock, not two — see
    /// `super::video`'s module doc.
    pub(super) latest_frame: &'a Mutex<FrameSlot>,
    pub(super) pixel_format: &'a Mutex<PixelFormat>,
    /// `None` until a core negotiates `RETRO_ENVIRONMENT_SET_HW_RENDER`
    /// (W345) — created lazily by `bring_up_hw_render` the first time
    /// [`callbacks::EnvironmentEvent::HwRenderRequested`] is drained, never
    /// eagerly. `Arc` (not `Box`) because
    /// [`callbacks::install_hw_render_context`] needs its own handle for the
    /// process-global FFI callbacks (`callbacks::hw_get_current_framebuffer`/
    /// `callbacks::hw_get_proc_address`) to read from a different call
    /// stack (the core's own `retro_run`, re-entering through the C ABI)
    /// than the one that owns it here.
    pub(super) hw_render: Option<Arc<HwRenderContext>>,
    /// The core's declared max frame dimensions — sizes the HW-render FBO
    /// the first time it is created. Meaningless (and unread) for a
    /// software-rendered session.
    pub(super) max_width: u32,
    pub(super) max_height: u32,
    pub(super) stop: &'a AtomicBool,
    pub(super) paused: &'a AtomicBool,
    /// W370: the per-session RetroAchievements trigger evaluator. Always
    /// present (constructed empty when no set is loaded — see
    /// `session::NativeRuntime::start`) so [`AchievementRuntime::do_frame`]'s
    /// no-set fast path is what every session runs by default.
    pub(super) achievements: AchievementRuntime,
    /// Monotonic per-session frame count, stamped onto achievement unlock
    /// events (see [`AchievementRuntime::do_frame`]) — distinct from
    /// `counters.frames_run` (a perf counter) so achievements' frame
    /// numbering is never coupled to perf instrumentation being enabled.
    pub(super) frame_counter: u64,
}

/// Drives `retro_run` on an absolute-deadline [`FrameClock`] (`1/fps`
/// period) until `stop` is set, draining each frame's environment/video/
/// audio callback output into the shared buffers, executing save/load
/// commands between frames, flushing dirty battery SRAM periodically,
/// logging perf counters, and writing the final SRAM + auto save-state on
/// exit.
pub(super) fn run_core_loop(mut ctx: CoreLoop<'_>) {
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
    // Pre-sized to the core's declared max geometry (W380) so even the
    // first frame after boot avoids a reallocation, not just later frames
    // at a now-familiar size — see `frame.rs::max_rgba8_capacity` and its
    // `video_scratch_reallocs` perf counter.
    let mut rgba_scratch: Vec<u8> =
        Vec::with_capacity(crate::play::native::frame::max_rgba8_capacity(
            ctx.max_width,
            ctx.max_height,
        ));
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
        ctx.frame_counter = ctx.frame_counter.wrapping_add(1);
        // W370: peek the core's live system RAM straight into rcheevos'
        // evaluator, immediately after retro_run so achievements see this
        // frame's memory before anything else (save/load commands,
        // audio/video drain) has a chance to run. With no achievement set
        // loaded, `do_frame` is the single `has_active_set` branch the
        // design doc requires — no allocation, no FFI call.
        if let Some((ptr, len)) = ctx.core.system_ram_pointer() {
            // SAFETY: `ptr` was just returned by `system_ram_pointer` on the
            // core this same call owns, valid for `len` bytes; the core is
            // not touched again until this borrow ends a few lines below
            // (achievements' peek callback only reads, never retains the
            // pointer past `do_frame`'s synchronous return).
            let system_ram = unsafe { std::slice::from_raw_parts(ptr, len) };
            ctx.achievements.do_frame(ctx.frame_counter, system_ram);
        }
        // Before video: a core typically negotiates its pixel format (or,
        // for N64/W345, its HW-render context) once near startup, before its
        // first real video_refresh call.
        drain_environment(&mut ctx);
        drain_video(
            &ctx.channels,
            ctx.latest_frame,
            ctx.pixel_format,
            ctx.hw_render.as_deref(),
            &mut rgba_scratch,
            &ctx.counters,
        );
        super::audio::drain_audio(&ctx.channels, &mut ctx.audio, &mut resample_scratch);
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
            CoreCommand::LoadAchievementSet { set, reply } => {
                let result = ctx.achievements.load_set(&set);
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
    // W370 (docs/design/retroachievements-design.md §Evaluation loop): a
    // core is free to reallocate its backing memory on `retro_unserialize`,
    // which would invalidate a cached `RETRO_MEMORY_SYSTEM_RAM` pointer.
    // This wrapper never caches one across frames — the loop above calls
    // `system_ram_pointer()` fresh every tick — so no explicit
    // re-fetch/invalidation is needed here; the next tick's peek is already
    // guaranteed to see whatever pointer the core reports post-restore.
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
