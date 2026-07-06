//! Safe wrapper over rcheevos' `rc_runtime_t` ([`super::ffi`]). Owns the
//! allocated runtime and enforces the same "no raw pointer escapes" rule
//! `play::native::host::LibretroCore` upholds for the libretro surface —
//! callers load an [`AchievementSet`], feed it a frame's worth of system RAM
//! each tick, and drain unlocks through [`super::events`]. W370 — see
//! docs/design/retroachievements-design.md §Evaluation loop.

use super::definitions::AchievementSet;
use super::events::{self, UnlockEvent};
use super::ffi::{
    rc_runtime_activate_achievement, rc_runtime_alloc, rc_runtime_destroy, rc_runtime_do_frame,
    rc_runtime_init, RcRuntimeEvent, RC_OK, RC_RUNTIME_EVENT_ACHIEVEMENT_TRIGGERED,
};
use crate::error::{AppError, AppResult};
use std::ffi::CString;
use std::os::raw::c_void;
use std::sync::atomic::{AtomicU64, Ordering};

/// The current frame number, stamped onto every [`UnlockEvent`] pushed by
/// [`achievement_event_handler`] — process-global for the same "no userdata
/// pointer in the C callback" reason [`super::events`]'s sink is. Reset to 0
/// each time a fresh [`AchievementRuntime`] is constructed so a new session's
/// frame numbering never carries over a stale count from a previous one.
static CURRENT_FRAME: AtomicU64 = AtomicU64::new(0);

/// `rc_runtime_event_handler_t` (no userdata parameter, same ABI constraint
/// as libretro's own callbacks — see [`super::events`]'s doc): translates a
/// trigger event into a [`UnlockEvent`] and pushes it onto the installed
/// sink. Every event type other than `ACHIEVEMENT_TRIGGERED` (armed/paused/
/// reset/primed/etc., see `rc_runtime.h`) is intentionally ignored — this
/// release only surfaces unlocks (docs/design/retroachievements-design.md
/// non-goals: no rich progress UI yet).
extern "C" fn achievement_event_handler(event: *const RcRuntimeEvent) {
    // SAFETY: rcheevos always passes a valid, non-null pointer to a live
    // `rc_runtime_event_t` for the duration of this call — it is a borrow of
    // a stack value inside `rc_runtime_do_frame`, never stored past the
    // call. Copying the `Copy` struct out immediately keeps no borrow alive
    // beyond that.
    let event = unsafe { *event };
    if event.event_type != RC_RUNTIME_EVENT_ACHIEVEMENT_TRIGGERED {
        return;
    }
    events::push(UnlockEvent {
        achievement_id: event.id,
        frame: CURRENT_FRAME.load(Ordering::Relaxed),
    });
}

/// A live rcheevos evaluator: zero or more activated achievement triggers,
/// ticked once per emulated frame against a peek into the core's system RAM.
/// With no set loaded, [`Self::do_frame`] is a single branch (the
/// `is_empty` check) — the design doc's "no measurable frame-loop
/// regression" requirement.
pub struct AchievementRuntime {
    runtime: *mut c_void,
    /// Tracks whether any achievement is currently activated so
    /// [`Self::do_frame`] can skip the FFI call entirely on an empty
    /// runtime — calling `rc_runtime_do_frame` on a genuinely empty runtime
    /// is harmless but still walks its (empty) trigger list and pays a
    /// non-virtual call; this flag makes "no set loaded" a single bool load
    /// and branch, matching the design doc's per-frame cost requirement.
    has_active_set: bool,
}

// SAFETY: `rc_runtime_t` is never touched concurrently — Harmony's core loop
// (the only caller of `do_frame`) is single-threaded per session, matching
// `LibretroCore`'s same "not Sync across threads that could call
// concurrently" contract. `Send` is required because the core loop that owns
// this runtime is itself spawned onto its own thread from `NativeRuntime`.
unsafe impl Send for AchievementRuntime {}

impl AchievementRuntime {
    /// Allocates and initializes an empty rcheevos runtime with no
    /// achievements activated. Installs a fresh [`super::events`] sink and
    /// resets the frame counter, so a new session's unlocks never carry a
    /// previous session's stale frame numbers or backlog.
    ///
    /// Returns the runtime paired with the [`std::sync::mpsc::Receiver`]
    /// half of its unlock stream — callers hold onto both for the session's
    /// lifetime.
    pub fn new() -> (Self, std::sync::mpsc::Receiver<UnlockEvent>) {
        // SAFETY: `rc_runtime_alloc`/`rc_runtime_init` have no preconditions
        // beyond "call init on what alloc returned" (upheld by calling them
        // back to back here) and never fail by returning null for `init`
        // (only `alloc`'s out-of-memory case, handled below).
        let runtime = unsafe { rc_runtime_alloc() };
        assert!(
            !runtime.is_null(),
            "rc_runtime_alloc returned null (out of memory)"
        );
        unsafe { rc_runtime_init(runtime) };
        CURRENT_FRAME.store(0, Ordering::Relaxed);
        let rx = events::install();
        (
            AchievementRuntime {
                runtime,
                has_active_set: false,
            },
            rx,
        )
    }

    /// Activates every achievement in `set`, replacing anything previously
    /// loaded (rcheevos' own `rc_runtime_activate_achievement` reuses/
    /// replaces by id, so re-loading a different set for the same ids is
    /// safe). A malformed trigger string for one achievement is logged and
    /// skipped rather than aborting the whole set — one bad definition
    /// (e.g. a future RA syntax addition this rcheevos version doesn't
    /// parse) must not silently disable every other achievement in the
    /// game.
    pub fn load_set(&mut self, set: &AchievementSet) -> AppResult<()> {
        for achievement in &set.achievements {
            let memaddr = CString::new(achievement.trigger.as_str()).map_err(|e| {
                AppError::Validation(format!(
                    "achievement {} trigger has an embedded NUL: {e}",
                    achievement.id
                ))
            })?;
            // SAFETY: `self.runtime` is a live, initialized `rc_runtime_t*`
            // for the lifetime of `self` (allocated in `new`, freed only in
            // `Drop`). `memaddr` is a valid NUL-terminated C string kept
            // alive for the duration of this call by the local binding.
            let rc = unsafe {
                rc_runtime_activate_achievement(
                    self.runtime,
                    achievement.id,
                    memaddr.as_ptr(),
                    std::ptr::null_mut(),
                    0,
                )
            };
            if rc != RC_OK {
                eprintln!(
                    "[rgp-native] achievement {} trigger rejected (rc {rc}); skipping",
                    achievement.id
                );
                continue;
            }
            self.has_active_set = true;
        }
        Ok(())
    }

    /// Advances every activated trigger by one frame against `system_ram`
    /// (the core's `RETRO_MEMORY_SYSTEM_RAM` region for this tick — see
    /// `play::native::runtime::core_loop`'s call site, which re-fetches this
    /// slice from [`crate::play::native::host::LibretroCore::system_ram_pointer`]
    /// after every `retro_unserialize` so it is never stale across a
    /// save-state load). `frame` is stamped onto any [`UnlockEvent`] this
    /// tick produces.
    ///
    /// With no achievement set loaded this is a single branch (the
    /// `has_active_set` check) and returns immediately — the design doc's
    /// no-measurable-regression requirement for a session with achievements
    /// off. All FFI/unsafe needed to bridge `system_ram` into rcheevos' peek
    /// callback is contained entirely within this method; callers never
    /// touch a raw pointer.
    pub fn do_frame(&mut self, frame: u64, system_ram: &[u8]) {
        if !self.has_active_set {
            return;
        }
        CURRENT_FRAME.store(frame, Ordering::Relaxed);
        // The peek callback (`peek_system_ram`) receives this slice as its
        // `ud` pointer, valid only for the duration of the call below —
        // `rc_runtime_do_frame` is synchronous and never retains `ud` past
        // its own return.
        let view = MemoryView { ptr: system_ram.as_ptr(), len: system_ram.len() };
        // SAFETY: `self.runtime` is live (see `load_set`'s safety comment);
        // `achievement_event_handler`/`peek_system_ram` are valid
        // `extern "C" fn`s matching their respective rcheevos typedefs
        // exactly; `&view` is a valid pointer to a live `MemoryView` for the
        // duration of this synchronous call, and `system_ram` (which `view`
        // borrows from) outlives it as this function's own parameter.
        unsafe {
            rc_runtime_do_frame(
                self.runtime,
                achievement_event_handler,
                peek_system_ram,
                &view as *const MemoryView as *mut c_void,
                std::ptr::null_mut(),
            );
        }
    }
}

/// The `ud` payload [`AchievementRuntime::do_frame`] passes to
/// [`peek_system_ram`]: a borrowed view of the core's system RAM for exactly
/// the duration of one `rc_runtime_do_frame` call. Never stored past that
/// call, so the borrow it represents never outlives the slice it came from.
struct MemoryView {
    ptr: *const u8,
    len: usize,
}

/// `rc_runtime_peek_t`: reads `num_bytes` (1/2/4) little-endian bytes
/// starting at `address` from the [`MemoryView`] `ud` points to. Addresses
/// (or reads) past the end of the region return 0 — RA's own convention for
/// "this system doesn't have memory here" (a trigger addressing unmapped
/// memory simply never fires, rather than the peek erroring).
unsafe extern "C" fn peek_system_ram(address: u32, num_bytes: u32, ud: *mut c_void) -> u32 {
    // SAFETY: `ud` is always the `&view as *const MemoryView` pointer
    // `do_frame` passed in for this exact call, valid for the call's
    // duration per that method's contract.
    let view = unsafe { &*(ud as *const MemoryView) };
    // SAFETY: `view.ptr`/`view.len` describe the same borrowed
    // `system_ram` slice `do_frame` was called with, live for this call.
    let memory = unsafe { std::slice::from_raw_parts(view.ptr, view.len) };
    let start = address as usize;
    let end = start.saturating_add(num_bytes as usize);
    let Some(bytes) = memory.get(start..end.min(memory.len())) else {
        return 0;
    };
    if bytes.len() != num_bytes as usize {
        return 0; // partially out-of-range read; RA's "unmapped" convention
    }
    let mut value = 0u32;
    for (i, &b) in bytes.iter().enumerate() {
        value |= (b as u32) << (8 * i); // little-endian, per rc_runtime_peek_t's contract
    }
    value
}

impl Drop for AchievementRuntime {
    fn drop(&mut self) {
        // SAFETY: `self.runtime` was allocated by `rc_runtime_alloc` in
        // `new` and is never freed anywhere else — this is the one and only
        // `rc_runtime_destroy` call for this pointer, upheld by `Drop`
        // running at most once per value.
        unsafe {
            rc_runtime_destroy(self.runtime);
        }
        events::uninstall();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::play::achievements::definitions::AchievementDefinition;
    use std::sync::Mutex;

    /// Serializes tests here against the shared `events`/`CURRENT_FRAME`
    /// process-global state, same rationale as the other modules' TEST_LOCKs.
    static TEST_LOCK: Mutex<()> = Mutex::new(());
    fn lock_tests() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A trigger that fires once byte 0 (8-bit read, `0xH00`) equals 1 —
    /// rcheevos' MemAddr mini-language for "8-bit value at address 0".
    const TRIGGER_BYTE_ZERO_EQUALS_ONE: &str = "0xH00=1";

    #[test]
    fn empty_runtime_do_frame_is_a_single_branch_and_produces_no_events() {
        let _guard = lock_tests();
        let (mut runtime, rx) = AchievementRuntime::new();
        runtime.do_frame(1, &[1]);
        assert!(
            rx.try_recv().is_err(),
            "no achievements activated ⇒ no unlock possible"
        );
    }

    #[test]
    fn scripted_memory_change_triggers_exactly_one_unlock() {
        let _guard = lock_tests();
        let (mut runtime, rx) = AchievementRuntime::new();
        runtime
            .load_set(&AchievementSet {
                hash: "test".into(),
                achievements: vec![AchievementDefinition {
                    id: 42,
                    title: "Byte Zero".into(),
                    trigger: TRIGGER_BYTE_ZERO_EQUALS_ONE.into(),
                }],
            })
            .expect("load_set");

        // Frame before the scripted change: condition false, no unlock.
        runtime.do_frame(1, &[0]);
        assert!(rx.try_recv().is_err(), "condition not yet met");

        // Script the memory change the trigger watches for.
        runtime.do_frame(2, &[1]);
        let unlock = rx.try_recv().expect("unlock on the triggering frame");
        assert_eq!(unlock.achievement_id, 42);
        assert_eq!(unlock.frame, 2);

        // Further frames with the condition still true must not re-fire —
        // rcheevos triggers are edge-triggered (WAITING → PRIMED →
        // TRIGGERED), not level-triggered.
        runtime.do_frame(3, &[1]);
        assert!(
            rx.try_recv().is_err(),
            "an already-triggered achievement must not unlock a second time"
        );
    }

    #[test]
    fn malformed_trigger_is_skipped_not_fatal() {
        let _guard = lock_tests();
        let (mut runtime, rx) = AchievementRuntime::new();
        // "0xZZ00=1" names an unrecognized memory-operand type ("ZZ") —
        // rcheevos rejects this with RC_INVALID_MEMORY_OPERAND, unlike a
        // merely-empty or degenerate-but-parseable string.
        let result = runtime.load_set(&AchievementSet {
            hash: "test".into(),
            achievements: vec![AchievementDefinition {
                id: 1,
                title: "Bad".into(),
                trigger: "0xZZ00=1".into(),
            }],
        });
        assert!(result.is_ok(), "one bad trigger must not error the whole set");
        // The rejected trigger must never activate — scripting the memory
        // it would have watched and running a frame must produce no unlock.
        runtime.do_frame(1, &[1]);
        assert!(
            rx.try_recv().is_err(),
            "a rejected trigger must not be silently active"
        );
    }

    /// W370 evaluation-loop requirement: after a save-state load
    /// (`retro_unserialize`), the next tick's peek must read the
    /// **current** memory, not a value captured before the reload — proven
    /// here by feeding a different slice than the previous tick used and
    /// confirming the trigger reacts to the new value, not the old one.
    #[test]
    fn do_frame_reads_a_freshly_supplied_memory_slice_each_call() {
        let _guard = lock_tests();
        let (mut runtime, rx) = AchievementRuntime::new();
        runtime
            .load_set(&AchievementSet {
                hash: "test".into(),
                achievements: vec![AchievementDefinition {
                    id: 7,
                    title: "Reload-safe".into(),
                    trigger: TRIGGER_BYTE_ZERO_EQUALS_ONE.into(),
                }],
            })
            .expect("load_set");

        // First "memory region" (e.g. pre-reload): condition false.
        let before_reload = vec![0u8; 4];
        runtime.do_frame(1, &before_reload);
        assert!(rx.try_recv().is_err());

        // Simulate a save-state load handing back a distinct allocation
        // (as `system_ram_pointer` re-fetch would after retro_unserialize)
        // whose content already satisfies the trigger.
        let after_reload = vec![1u8, 0, 0, 0];
        runtime.do_frame(2, &after_reload);
        let unlock = rx.try_recv().expect("unlock reacts to the fresh slice, not a stale one");
        assert_eq!(unlock.achievement_id, 7);
    }
}
