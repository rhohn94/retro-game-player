//! Raw rcheevos C ABI surface — function signatures and constants
//! transcribed verbatim from the vendored headers
//! (`vendor/rcheevos/include/rc_hash.h`, `rc_runtime.h`, `rc_consoles.h`,
//! `rc_error.h`). Mirrors [`super::super::native::ffi`]'s role for the
//! libretro surface: this is the one place a wrong signature silently
//! corrupts memory across the FFI boundary instead of tripping a compiler
//! error. Scope is intentionally narrow — only the entry points
//! [`super::host::AchievementRuntime`] and [`super::hash`] actually call.

#![allow(dead_code)]

use std::os::raw::{c_char, c_void};

/// `rc_consoles.h` console identifiers — only the two systems this release
/// supports (NES/SNES, see docs/design/retroachievements-design.md §Scope).
pub const RC_CONSOLE_NINTENDO: u32 = 7;
pub const RC_CONSOLE_SUPER_NINTENDO: u32 = 3;

/// `rc_error.h`: `RC_OK` — the only non-negative return code every rcheevos
/// entry point here uses; anything else is a negative error code.
pub const RC_OK: i32 = 0;

/// `rc_runtime_types.h`'s `rc_runtime_event_t.type` values this wrapper
/// surfaces. Only `ACHIEVEMENT_TRIGGERED` is acted on today; the rest are
/// listed for documentation/parity with the header (`#![allow(dead_code)]`
/// above keeps the unused ones from warning).
pub const RC_RUNTIME_EVENT_ACHIEVEMENT_TRIGGERED: u8 = 3;

extern "C" {
    /// `rc_hash_generate_from_buffer` — hashes an in-memory ROM buffer for
    /// `console_id`, writing a 33-byte (32 hex chars + NUL) MD5 string into
    /// `hash`. Returns non-zero on success. Per-console header handling
    /// (e.g. NES's 16-byte iNES header) happens **inside** this call —
    /// callers must pass the raw ROM bytes, never pre-stripped (see
    /// [`super::hash`]'s doc).
    pub fn rc_hash_generate_from_buffer(
        hash: *mut c_char,
        console_id: u32,
        buffer: *const u8,
        buffer_size: usize,
    ) -> i32;
}

/// `rc_runtime_peek_t` — reads `num_bytes` (1/2/4) from `address` in the
/// emulated system's memory map, little-endian. `ud` is the opaque userdata
/// pointer passed through from [`rc_runtime_do_frame`]'s call site.
pub type RcRuntimePeekFn =
    unsafe extern "C" fn(address: u32, num_bytes: u32, ud: *mut c_void) -> u32;

/// `rc_runtime_event_t` (`rc_runtime.h`). Field order/types match the header
/// exactly.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RcRuntimeEvent {
    pub id: u32,
    pub value: i32,
    pub event_type: u8,
}

/// `rc_runtime_event_handler_t` — invoked synchronously, on the calling
/// thread, once per state-change event during [`rc_runtime_do_frame`].
pub type RcRuntimeEventHandlerFn = unsafe extern "C" fn(event: *const RcRuntimeEvent);

extern "C" {
    /// Allocates a zeroed `rc_runtime_t` on the C heap. Opaque to Rust — this
    /// wrapper never reads its fields, only passes the pointer back into
    /// other rcheevos calls.
    pub fn rc_runtime_alloc() -> *mut c_void;
    pub fn rc_runtime_init(runtime: *mut c_void);
    pub fn rc_runtime_destroy(runtime: *mut c_void);

    /// Parses `memaddr` (a rcheevos trigger definition string, e.g.
    /// `"0xH0010=1"`) and activates it under `id`. Returns `RC_OK` (0) on
    /// success, a negative `rc_error.h` code otherwise. `unused_lua`/
    /// `unused_funcs_idx` are Lua-rich-presence hooks this project never
    /// uses — always `null`/`0`.
    pub fn rc_runtime_activate_achievement(
        runtime: *mut c_void,
        id: u32,
        memaddr: *const c_char,
        unused_lua: *mut c_void,
        unused_funcs_idx: i32,
    ) -> i32;

    /// Advances every activated trigger by one frame, invoking
    /// `event_handler` synchronously for each state-change event (an unlock
    /// is `RC_RUNTIME_EVENT_ACHIEVEMENT_TRIGGERED`). `peek`/`ud` are the
    /// memory-read callback pair; `unused_lua` is always null.
    pub fn rc_runtime_do_frame(
        runtime: *mut c_void,
        event_handler: RcRuntimeEventHandlerFn,
        peek: RcRuntimePeekFn,
        ud: *mut c_void,
        unused_lua: *mut c_void,
    );
}
