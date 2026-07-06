//! The bounded unlock event stream the frontend drains (W370), following the
//! same process-global-sink pattern `play::native::callbacks` uses for
//! libretro's callbacks: `rc_runtime_event_handler_t` (like libretro's
//! callback ABI) carries no userdata pointer, so there is no way to route an
//! event back to a particular [`super::host::AchievementRuntime`] instance
//! except through same-process global state. This is fine for the same
//! reason it is fine there — Harmony runs one native play session at a time.

use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Mutex;

/// One achievement unlocking. `id` is RA's achievement id (matches
/// [`super::definitions::AchievementDefinition::id`]); `frame` is a
/// diagnostic sequence number the caller assigns (this module does not
/// generate its own), useful for correlating an unlock with a specific
/// point in a capture/replay without adding a second channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnlockEvent {
    pub achievement_id: u32,
    pub frame: u64,
}

/// Caps the unlock queue: a session that unlocks more than this many
/// achievements before the frontend drains even once is not a realistic
/// play session (RA sets are, at most, a few hundred achievements total,
/// let alone unlocked in a single unread burst) — bounding here converts a
/// stuck/never-polling frontend from an unbounded memory leak into a
/// bounded, harmless backlog that silently drops the oldest overflow
/// (favoring the newest unlocks, which are the ones a still-playing session
/// most needs surfaced first).
const UNLOCK_QUEUE_CAPACITY: usize = 256;

static UNLOCK_SINK: Mutex<Option<SyncSender<UnlockEvent>>> = Mutex::new(None);

fn sink_lock() -> std::sync::MutexGuard<'static, Option<SyncSender<UnlockEvent>>> {
    UNLOCK_SINK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Installs a fresh bounded channel for one session, returning the receiving
/// half for the frontend-facing drain to hold. Replaces (rather than
/// requiring explicit teardown of) whatever was previously installed —
/// Harmony runs one native session at a time, matching
/// `play::native::callbacks::install`'s same convention.
pub fn install() -> Receiver<UnlockEvent> {
    let (tx, rx) = mpsc::sync_channel(UNLOCK_QUEUE_CAPACITY);
    *sink_lock() = Some(tx);
    rx
}

/// Drops the installed sink so a stopped session's stray unlock (if any
/// in-flight FFI call still landed one) is silently discarded rather than
/// delivered to whichever session installs next.
pub fn uninstall() {
    *sink_lock() = None;
}

/// Pushes `event` onto the installed sink, if any. A full queue drops the
/// event with a log line (see [`UNLOCK_QUEUE_CAPACITY`]'s doc) rather than
/// blocking the core thread — an unpolled frontend must never stall
/// gameplay. No sink installed (no session running) is silently a no-op.
pub(super) fn push(event: UnlockEvent) {
    let guard = sink_lock();
    let Some(tx) = guard.as_ref() else { return };
    if let Err(TrySendError::Full(_)) = tx.try_send(event) {
        eprintln!(
            "[rgp-native] achievement unlock queue full; dropping unlock for achievement {}",
            event.achievement_id
        );
    }
    // TrySendError::Disconnected means the receiver was dropped without
    // calling `uninstall` first — nothing to do, the session is going away.
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes tests in this module against the shared [`UNLOCK_SINK`]
    /// global, the same reason `play::native::callbacks::TEST_LOCK` exists.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn lock_tests() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn push_without_install_is_a_silent_no_op() {
        let _guard = lock_tests();
        uninstall();
        // Must not panic even though nothing is installed.
        push(UnlockEvent { achievement_id: 1, frame: 0 });
    }

    #[test]
    fn installed_sink_delivers_pushed_events_in_order() {
        let _guard = lock_tests();
        let rx = install();
        push(UnlockEvent { achievement_id: 1, frame: 10 });
        push(UnlockEvent { achievement_id: 2, frame: 11 });

        let first = rx.try_recv().expect("first event");
        let second = rx.try_recv().expect("second event");
        assert_eq!(first, UnlockEvent { achievement_id: 1, frame: 10 });
        assert_eq!(second, UnlockEvent { achievement_id: 2, frame: 11 });
        assert!(rx.try_recv().is_err(), "queue should be drained");
        uninstall();
    }

    #[test]
    fn queue_overflow_drops_rather_than_blocks() {
        let _guard = lock_tests();
        let rx = install();
        for i in 0..(UNLOCK_QUEUE_CAPACITY as u32 + 10) {
            push(UnlockEvent { achievement_id: i, frame: 0 });
        }
        // Draining must yield at most the bounded capacity — proves `push`
        // never blocked past the cap rather than growing unboundedly.
        let drained: Vec<_> = rx.try_iter().collect();
        assert!(drained.len() <= UNLOCK_QUEUE_CAPACITY);
        uninstall();
    }

    #[test]
    fn uninstall_then_reinstall_gives_a_fresh_queue() {
        let _guard = lock_tests();
        let rx1 = install();
        push(UnlockEvent { achievement_id: 1, frame: 0 });
        uninstall();

        let rx2 = install();
        push(UnlockEvent { achievement_id: 2, frame: 0 });

        assert_eq!(
            rx2.try_recv().expect("second session's event"),
            UnlockEvent { achievement_id: 2, frame: 0 }
        );
        // The first receiver still holds whatever was buffered before
        // uninstall — but no new events can reach it.
        assert_eq!(rx1.try_recv().expect("stale event"), UnlockEvent { achievement_id: 1, frame: 0 });
    }
}
