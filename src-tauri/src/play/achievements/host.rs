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

    /// Advances every activated trigger by one frame. `frame` is stamped
    /// onto any [`UnlockEvent`] this tick produces (see
    /// [`achievement_event_handler`]). `peek`/`peek_ud` are the memory-read
    /// callback pair the caller wires to the core's current
    /// `RETRO_MEMORY_SYSTEM_RAM` pointer — see
    /// `play::native::runtime::core_loop`'s call site, which revalidates
    /// that pointer after every `retro_unserialize` before the next tick
    /// reaches here.
    ///
    /// With no achievement set loaded this is a single branch (the
    /// `has_active_set` check) and returns immediately — the design doc's
    /// no-measurable-regression requirement for a session with achievements
    /// off.
    ///
    /// # Safety
    /// `peek_ud` must be a pointer `peek` can safely dereference (or ignore)
    /// for the duration of this call — this wrapper passes it through to
    /// rcheevos opaquely and never reads it itself. The caller (the core
    /// loop) upholds this by pointing `peek_ud` at the core whose memory
    /// `peek` reads, kept alive across the call.
    pub unsafe fn do_frame(
        &mut self,
        frame: u64,
        peek: super::ffi::RcRuntimePeekFn,
        peek_ud: *mut c_void,
    ) {
        if !self.has_active_set {
            return;
        }
        CURRENT_FRAME.store(frame, Ordering::Relaxed);
        // SAFETY: `self.runtime` is live (see `load_set`'s safety comment);
        // `achievement_event_handler` is a valid `extern "C" fn` matching
        // `rc_runtime_event_handler_t`'s signature exactly; `peek` is the
        // caller-supplied memory-read callback, required by this method's
        // contract to be valid for the duration of this call (the core loop
        // holds the core alive across it); `peek_ud` is passed through
        // opaquely and never dereferenced by this wrapper.
        unsafe {
            rc_runtime_do_frame(
                self.runtime,
                achievement_event_handler,
                peek,
                peek_ud,
                std::ptr::null_mut(),
            );
        }
    }
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

    /// A single byte of "system RAM" the tests can mutate between frames to
    /// script an unlock, plus the peek callback rcheevos calls to read it.
    static SCRIPTED_MEMORY: Mutex<[u8; 1]> = Mutex::new([0u8; 1]);

    unsafe extern "C" fn scripted_peek(address: u32, num_bytes: u32, _ud: *mut c_void) -> u32 {
        // Only ever asked to read a single byte at address 0 by the tests
        // below — a real core-loop peek (core_loop.rs) handles the general
        // multi-byte/any-address case against real system RAM.
        assert_eq!(address, 0);
        assert_eq!(num_bytes, 1);
        SCRIPTED_MEMORY.lock().unwrap_or_else(|p| p.into_inner())[0] as u32
    }

    fn set_scripted_memory(value: u8) {
        SCRIPTED_MEMORY.lock().unwrap_or_else(|p| p.into_inner())[0] = value;
    }

    /// A trigger that fires once byte 0 (8-bit read, `0xH00`) equals 1 —
    /// rcheevos' MemAddr mini-language for "8-bit value at address 0".
    const TRIGGER_BYTE_ZERO_EQUALS_ONE: &str = "0xH00=1";

    #[test]
    fn empty_runtime_do_frame_is_a_single_branch_and_produces_no_events() {
        let _guard = lock_tests();
        let (mut runtime, rx) = AchievementRuntime::new();
        set_scripted_memory(1);
        unsafe { runtime.do_frame(1, scripted_peek, std::ptr::null_mut()) };
        assert!(
            rx.try_recv().is_err(),
            "no achievements activated ⇒ no unlock possible"
        );
    }

    #[test]
    fn scripted_memory_change_triggers_exactly_one_unlock() {
        let _guard = lock_tests();
        set_scripted_memory(0);
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
        unsafe { runtime.do_frame(1, scripted_peek, std::ptr::null_mut()) };
        assert!(rx.try_recv().is_err(), "condition not yet met");

        // Script the memory change the trigger watches for.
        set_scripted_memory(1);
        unsafe { runtime.do_frame(2, scripted_peek, std::ptr::null_mut()) };
        let unlock = rx.try_recv().expect("unlock on the triggering frame");
        assert_eq!(unlock.achievement_id, 42);
        assert_eq!(unlock.frame, 2);

        // Further frames with the condition still true must not re-fire —
        // rcheevos triggers are edge-triggered (WAITING → PRIMED →
        // TRIGGERED), not level-triggered.
        unsafe { runtime.do_frame(3, scripted_peek, std::ptr::null_mut()) };
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
        set_scripted_memory(1);
        unsafe { runtime.do_frame(1, scripted_peek, std::ptr::null_mut()) };
        assert!(
            rx.try_recv().is_err(),
            "a rejected trigger must not be silently active"
        );
    }
}
