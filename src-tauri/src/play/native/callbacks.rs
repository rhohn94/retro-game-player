//! `extern "C"` callbacks libretro calls into during `retro_run` — video
//! refresh, audio sample batch, input poll/state, and environment queries.
//! Each pushes into an `mpsc` channel the runtime loop ([`super::host`]'s
//! caller, landing in W212) drains; none ever touch UI code directly.
//! W211 — see docs/design/native-emulation-design.md §1.
//!
//! Libretro's pre-v2 callback ABI passes no userdata pointer to any
//! callback, so there is no way to route a call back to a particular
//! [`super::host::LibretroCore`] instance — the callbacks must be free
//! functions backed by process-global state ([`SINKS`], [`JOYPAD_STATE`]).
//! This is fine in practice: Harmony only ever runs one native core session
//! at a time (a single game playing natively), and [`install`] simply
//! replaces whatever was previously registered.
//!
//! Some items here aren't called from production code yet — they're wired to
//! a real [`super::host::LibretroCore`] by the runtime loop (W212), not by
//! this module. `#![allow(dead_code)]` matches [`super::ffi`]'s same
//! intentionally-narrow-scope rationale.

#![allow(dead_code)]

use super::ffi;
use super::hw_render::HwRenderRequest;
use std::collections::{HashMap, HashSet};
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_void};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;

/// Environment-command IDs already logged as unhandled, so the log below
/// prints each distinct unhandled `cmd` once per session rather than flooding
/// stderr on every `retro_run` tick. Kept beyond the v0.21 crash
/// investigation: the once-per-command trace is the cheapest map of what a
/// core actually asks for, which is exactly what broadening core coverage
/// (roadmap Backlog) needs.
static LOGGED_UNHANDLED_ENV_CMDS: Mutex<Option<HashSet<u32>>> = Mutex::new(None);

/// Serializes every test in the crate that touches this module's
/// process-global state ([`SINKS`], [`JOYPAD_STATE`], [`CORE_VARIABLES`],
/// [`HW_RENDER_CONTEXT`]) —
/// `cargo test` runs tests in parallel threads within one process by
/// default, and these statics are process-global by FFI necessity (see the
/// module doc). `pub(crate)` (not `#[cfg(test)]`-gated) so other modules'
/// tests that also drive [`install`]/[`environment`]/[`uninstall`] directly
/// (e.g. `core::core_options::probe`'s headless-boot tests) share the same
/// lock rather than racing this module's own test suite.
#[cfg(test)]
pub(crate) static TEST_LOCK: Mutex<()> = Mutex::new(());

/// Acquires [`TEST_LOCK`], recovering from a poisoned lock the same way
/// every other lock in this module does (a panicked test must not wedge
/// every subsequent test that touches this shared state).
#[cfg(test)]
pub(crate) fn lock_tests() -> std::sync::MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A decoded video frame, copied out of the core's buffer (which is only
/// valid for the duration of the `retro_video_refresh_t` call) — OR, for a
/// hardware-rendered core (W345), a marker that a new frame is sitting in
/// the active [`super::hw_render::HwRenderContext`]'s FBO instead. `data` is
/// empty and `pitch` is meaningless when [`Self::is_hw_frame`] is set; the
/// run loop reads the real pixels back from the FBO
/// ([`super::hw_render::HwRenderContext::read_frame_into`]), never from this
/// struct, for that case.
#[derive(Debug, Clone, PartialEq)]
pub struct VideoFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub pitch: usize,
    pub is_hw_frame: bool,
}

/// A batch of interleaved stereo `i16` samples (L, R, L, R, ...) — libretro's
/// `retro_audio_sample_batch_t` contract.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioBatch {
    pub samples: Vec<i16>,
}

/// Pixel formats a core may negotiate via
/// `RETRO_ENVIRONMENT_SET_PIXEL_FORMAT`. Harmony accepts all three the
/// libretro API defines; the runtime loop (W212) is responsible for
/// converting to RGBA for the canvas.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Rgb1555,
    Xrgb8888,
    Rgb565,
}

impl PixelFormat {
    fn from_raw(value: u32) -> Option<Self> {
        match value {
            ffi::RETRO_PIXEL_FORMAT_0RGB1555 => Some(Self::Rgb1555),
            ffi::RETRO_PIXEL_FORMAT_XRGB8888 => Some(Self::Xrgb8888),
            ffi::RETRO_PIXEL_FORMAT_RGB565 => Some(Self::Rgb565),
            _ => None,
        }
    }
}

/// One core-declared option, decoded from `RETRO_ENVIRONMENT_SET_VARIABLES`'s
/// `"description; default_value|choice1|choice2|..."` value string
/// (libretro's `retro_variable` contract — see docs/design/core-options-design.md).
/// `choices[0]` is always the core's own declared default.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreVariable {
    pub key: String,
    pub description: String,
    pub choices: Vec<String>,
}

impl CoreVariable {
    /// The core's declared default — always `choices[0]` per the libretro
    /// contract (the frontend/first value listed after the description).
    pub fn default_value(&self) -> &str {
        // Every CoreVariable this module constructs has a non-empty
        // `choices` (parse_variable_value rejects an empty choice list), so
        // this is always Some in practice; "" is a safe, non-panicking
        // fallback for any future construction path that forgets to enforce it.
        self.choices.first().map(String::as_str).unwrap_or("")
    }
}

/// Parses one `retro_variable.value` string into `(description, choices)`.
/// Returns `None` for a malformed value (no `;` separator, or zero choices
/// after it) — the caller skips such an entry rather than surfacing a broken
/// option to the UI.
fn parse_variable_value(value: &str) -> Option<(String, Vec<String>)> {
    let (description, choices_str) = value.split_once(';')?;
    let choices: Vec<String> = choices_str
        .trim()
        .split('|')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if choices.is_empty() {
        return None;
    }
    Some((description.trim().to_string(), choices))
}

/// A core's video geometry, as reported at boot (`retro_get_system_av_info`)
/// or renegotiated mid-game (`RETRO_ENVIRONMENT_SET_GEOMETRY`, W340). Only
/// the fields the frame pipe actually needs — `max_width`/`max_height`
/// (buffer sizing) are handled by the runtime always allocating exactly the
/// frame it receives ([`super::frame::to_rgba8_into`] resizes per frame), so
/// they are not tracked separately here.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GeometryUpdate {
    pub width: u32,
    pub height: u32,
    pub aspect_ratio: f32,
}

/// Environment-callback events worth surfacing to the runtime loop. Most
/// `RETRO_ENVIRONMENT_*` commands are answered synchronously inline
/// ([`environment`]) and never reach this channel.
#[derive(Debug, Clone, PartialEq)]
pub enum EnvironmentEvent {
    PixelFormat(PixelFormat),
    /// The core declared its option list via `RETRO_ENVIRONMENT_SET_VARIABLES`
    /// (typically once, during `retro_init`/`retro_load_game`).
    VariablesDeclared(Vec<CoreVariable>),
    /// `RETRO_ENVIRONMENT_SET_GEOMETRY` (W340) — a mid-game resolution/aspect
    /// change. The runtime loop doesn't need to act on this beyond it being
    /// observable: each delivered [`VideoFrame`] already carries its own
    /// width/height, and [`super::frame::to_rgba8_into`] resizes its output
    /// buffer to match every frame, so a new frame at the new geometry just
    /// works. Surfaced anyway so callers that want to react (e.g. resizing a
    /// UI element ahead of the next frame) can.
    GeometryChanged(GeometryUpdate),
    /// `RETRO_ENVIRONMENT_SET_HW_RENDER` was accepted (W345) — the runtime
    /// loop creates the [`super::hw_render::HwRenderContext`] in response
    /// (never eagerly, and never for a core that didn't ask). Carries the
    /// decoded request (flags + the core's `context_reset`/`context_destroy`
    /// callbacks); the negotiation itself already happened synchronously in
    /// [`environment`] by the time this is sent.
    HwRenderRequested(HwRenderRequest),
    Shutdown,
}

struct CallbackSinks {
    video: Sender<VideoFrame>,
    audio: Sender<AudioBatch>,
    environment: Sender<EnvironmentEvent>,
}

static SINKS: Mutex<Option<CallbackSinks>> = Mutex::new(None);

/// How many joypad ports Harmony hosts input for (v0.35 "Player Two" W350).
/// Two this release (NES/SNES two-controller multiplayer); the storage and
/// port-handling below are written generically over this constant so raising
/// it later (a real 4-player need — see native-emulation-design.md's Out of
/// Scope) is a one-line change, not a redesign.
pub const NUM_NATIVE_INPUT_PORTS: usize = 2;

/// Per-port bitmask of currently-pressed joypad buttons, indexed by
/// `RETRO_DEVICE_ID_JOYPAD_*`. Port `n` is written by the input-mapping layer
/// (W216, extended for multiplayer in W350) via [`set_joypad_state`], and
/// read by [`input_state`] on every core poll for the port the core is
/// currently asking about. Each port is an independent `AtomicU16` (not a
/// `Mutex<[u16; N]>`) so the hot per-tick poll path stays lock-free, matching
/// the single-mask design this replaces.
static JOYPAD_STATE: [AtomicU16; NUM_NATIVE_INPUT_PORTS] =
    [AtomicU16::new(0), AtomicU16::new(0)];

// Ties the fixed-length array literal above to `NUM_NATIVE_INPUT_PORTS` at
// compile time — bumping the constant without updating the initializer (or
// vice versa) fails the build instead of silently sizing the storage wrong.
const _: () = assert!(JOYPAD_STATE.len() == NUM_NATIVE_INPUT_PORTS);

/// The current value for each core-declared option key, read by
/// `RETRO_ENVIRONMENT_GET_VARIABLE`. Populated by [`set_core_variables`]
/// before a session starts (the persisted value, or the core's own declared
/// default when nothing is persisted — W282, core-options-design.md) and
/// cleared by [`uninstall`].
static CORE_VARIABLES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn core_variables_lock() -> std::sync::MutexGuard<'static, Option<HashMap<String, String>>> {
    CORE_VARIABLES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Seeds the values [`environment`]'s `GET_VARIABLE` handler answers with for
/// the upcoming session. Call before [`super::host::LibretroCore::init`] —
/// cores may query variables during init, same ordering requirement as the
/// environment callback registration itself.
pub fn set_core_variables(values: HashMap<String, String>) {
    *core_variables_lock() = Some(values);
}

fn sinks_lock() -> std::sync::MutexGuard<'static, Option<CallbackSinks>> {
    SINKS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The receiving end of [`install`]'s channels.
pub struct CallbackChannels {
    pub video: Receiver<VideoFrame>,
    pub audio: Receiver<AudioBatch>,
    pub environment: Receiver<EnvironmentEvent>,
}

/// Replaces any previously-registered sinks and returns fresh receivers. Call
/// once per native playback session, before wiring the returned function
/// pointers up via `LibretroCore::set_video_refresh` etc.
///
/// Also clears every port's joypad state — the session-start half of the
/// release-all contract (W350, native-emulation-design.md §Multiplayer
/// input): `set_native_input` is deliberately a no-session no-op, so a stray
/// keydown landing between sessions (the keydown race after a stop) would
/// otherwise leave ghost held buttons the next session's core reads at boot.
pub fn install() -> CallbackChannels {
    release_all_native_input();
    let (video_tx, video_rx) = mpsc::channel();
    let (audio_tx, audio_rx) = mpsc::channel();
    let (environment_tx, environment_rx) = mpsc::channel();
    *sinks_lock() = Some(CallbackSinks {
        video: video_tx,
        audio: audio_tx,
        environment: environment_tx,
    });
    CallbackChannels {
        video: video_rx,
        audio: audio_rx,
        environment: environment_rx,
    }
}

/// Clears the global sinks, resets every port's joypad state, and drops any
/// seeded core variables so a stray callback after a session ends becomes a
/// silent no-op instead of sending into a receiver nobody drains anymore (or
/// answering a `GET_VARIABLE` query with a stale prior session's values).
pub fn uninstall() {
    *sinks_lock() = None;
    release_all_native_input();
    *core_variables_lock() = None;
    clear_hw_render_context();
}

/// Sets `port`'s full joypad bitmask — [`input_state`] reads it back on the
/// core's next poll of that port. Bit `n` corresponds to
/// `RETRO_DEVICE_ID_JOYPAD_*` value `n`. A `port >= `[`NUM_NATIVE_INPUT_PORTS`]
/// is a silent no-op (nothing polls it — see [`input_state`]'s same-bound
/// check), matching this module's existing "stray call is harmless" contract.
pub fn set_joypad_state(bits: u16, port: usize) {
    if let Some(state) = JOYPAD_STATE.get(port) {
        state.store(bits, Ordering::Relaxed);
    }
}

/// Releases every port's held buttons (all-zero bitmask) — the overlay
/// open / session start ([`install`]) / session-stop ([`uninstall`]) contract
/// (W350, native-emulation-design.md §Multiplayer input): a single call
/// clears both players' input rather than requiring one release call per
/// port, so the existing single-call release sites (overlay open, session
/// start, session teardown) keep working unmodified as multiplayer lands.
pub fn release_all_native_input() {
    for state in &JOYPAD_STATE {
        state.store(0, Ordering::Relaxed);
    }
}

/// `retro_video_refresh_t`. A null `data` means "this frame is a duplicate of
/// the last one" (negotiated via `RETRO_ENVIRONMENT_GET_CAN_DUPE`) — dropped
/// rather than forwarded, since there's nothing new to paint. A `data` equal
/// to [`ffi::RETRO_HW_FRAME_BUFFER_VALID`] (W345) means a hardware-rendered
/// core already drew this frame into the FBO
/// [`hw_get_current_framebuffer`] handed it — forwarded as an
/// [`VideoFrame::is_hw_frame`] marker (no pixel bytes to copy; the run loop
/// reads them back from the FBO itself) rather than treated as a real
/// pointer.
///
/// # Safety
/// `data`, when neither null nor [`ffi::RETRO_HW_FRAME_BUFFER_VALID`], must
/// point to at least `pitch * height` readable bytes — the contract
/// `retro_video_refresh_t` callers (the core, via `retro_run`) are required
/// to uphold.
pub unsafe extern "C" fn video_refresh(data: *const c_void, width: u32, height: u32, pitch: usize) {
    if data.is_null() {
        return;
    }
    if data == ffi::RETRO_HW_FRAME_BUFFER_VALID {
        if let Some(sinks) = sinks_lock().as_ref() {
            let _ = sinks.video.send(VideoFrame {
                data: Vec::new(),
                width,
                height,
                pitch,
                is_hw_frame: true,
            });
        }
        return;
    }
    let len = pitch.saturating_mul(height as usize);
    let bytes = unsafe { std::slice::from_raw_parts(data as *const u8, len) }.to_vec();
    if let Some(sinks) = sinks_lock().as_ref() {
        let _ = sinks.video.send(VideoFrame {
            data: bytes,
            width,
            height,
            pitch,
            is_hw_frame: false,
        });
    }
}

/// `retro_audio_sample_batch_t`. Always reports the full batch consumed —
/// Harmony has no partial-consume backpressure protocol at this layer; the
/// ring buffer (W212) is where real backpressure is handled.
///
/// # Safety
/// `data`, when non-null, must point to at least `frames * 2` readable `i16`
/// samples (interleaved stereo) — the contract `retro_audio_sample_batch_t`
/// callers are required to uphold.
pub unsafe extern "C" fn audio_sample_batch(data: *const i16, frames: usize) -> usize {
    if !data.is_null() && frames > 0 {
        let samples = unsafe { std::slice::from_raw_parts(data, frames * 2) }.to_vec();
        if let Some(sinks) = sinks_lock().as_ref() {
            let _ = sinks.audio.send(AudioBatch { samples });
        }
    }
    frames
}

/// `retro_input_poll_t`. Harmony's input snapshot ([`set_joypad_state`]) is
/// kept current independently of this call (the input-mapping layer, W216,
/// writes to it as events arrive) — a no-op, present only because the core
/// requires a non-null callback to be registered.
///
/// # Safety
/// Takes no arguments and touches no pointers; safe to call unconditionally.
/// Marked `unsafe` only for signature uniformity with the rest of this
/// callback set, all of which match libretro's `unsafe extern "C" fn`
/// typedefs ([`super::ffi`]).
pub unsafe extern "C" fn input_poll() {}

/// `retro_input_state_t`. Only `RETRO_DEVICE_JOYPAD` is supported (Harmony
/// hosts NES/SNES; no analog/mouse/lightgun devices) — anything else reports
/// "not pressed" rather than panicking. Returns the polled `port`'s own mask
/// (W350 multiplayer input); a `port` beyond [`NUM_NATIVE_INPUT_PORTS`] (a
/// core probing for more controllers than Harmony hosts this release) also
/// reports "not pressed" rather than panicking or wrapping.
///
/// # Safety
/// Touches no pointers; safe to call unconditionally. Marked `unsafe` only
/// for signature uniformity with the rest of this callback set.
pub unsafe extern "C" fn input_state(port: u32, device: u32, _index: u32, id: u32) -> i16 {
    if device != ffi::RETRO_DEVICE_JOYPAD || id > ffi::RETRO_DEVICE_ID_JOYPAD_R {
        return 0;
    }
    let Some(state) = JOYPAD_STATE.get(port as usize) else {
        return 0;
    };
    let bits = state.load(Ordering::Relaxed);
    i16::from(bits & (1 << id) != 0)
}

fn write_bool(data: *mut c_void, value: bool) {
    if !data.is_null() {
        unsafe {
            *(data as *mut bool) = value;
        }
    }
}

/// Backing storage for the `CString`s [`environment`]'s `GET_VARIABLE` answers
/// point into. A `retro_variable.value` pointer must stay valid for the core
/// to read after the callback returns; libretro cores read it immediately
/// (never across frames), so replacing the previous answer on every query is
/// safe and keeps this from growing unbounded across a long session.
static GET_VARIABLE_ANSWER: Mutex<Option<CString>> = Mutex::new(None);

fn get_variable_answer_lock() -> std::sync::MutexGuard<'static, Option<CString>> {
    GET_VARIABLE_ANSWER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `RETRO_ENVIRONMENT_GET_VARIABLE`: reads `data.key`, looks it up in
/// [`CORE_VARIABLES`], and — when present — points `data.value` at a
/// same-process `CString` holding the answer. Reports unhandled (`false`)
/// when no variables have been seeded (no session in progress) or the key is
/// unknown, matching how a real frontend answers a query for an option it
/// doesn't recognize.
///
/// # Safety
/// `data` must point to a valid `RetroVariable` whose `key` is either null or
/// a valid, NUL-terminated C string — the `retro_environment_t` contract for
/// `GET_VARIABLE`.
unsafe fn get_variable(data: *mut c_void) -> bool {
    if data.is_null() {
        return false;
    }
    let var = unsafe { &mut *(data as *mut ffi::RetroVariable) };
    if var.key.is_null() {
        return false;
    }
    let key = unsafe { CStr::from_ptr(var.key) }.to_string_lossy().into_owned();
    let Some(value) = core_variables_lock().as_ref().and_then(|vars| vars.get(&key).cloned())
    else {
        return false;
    };
    let Ok(c_value) = CString::new(value) else {
        return false; // an embedded NUL can never come from a valid option value
    };
    let mut answer = get_variable_answer_lock();
    var.value = c_value.as_ptr();
    *answer = Some(c_value);
    true
}

/// `RETRO_ENVIRONMENT_SET_VARIABLES`: decodes the core's null-terminated
/// `retro_variable` array into [`CoreVariable`]s and forwards them as an
/// [`EnvironmentEvent::VariablesDeclared`] — the one-time (per session)
/// moment a core's option list becomes visible to Rust (W282,
/// core-options-design.md). Entries with a malformed value string
/// ([`parse_variable_value`] returns `None`) are skipped rather than failing
/// the whole declaration.
///
/// # Safety
/// `data`, when non-null, must point to a null-terminated (`key == NULL`)
/// array of valid `RetroVariable`s whose `key`/`value` are NUL-terminated C
/// strings — the `retro_environment_t` contract for `SET_VARIABLES`.
unsafe fn set_variables(data: *mut c_void) -> bool {
    if data.is_null() {
        return true; // a core clearing its option list is not an error
    }
    let mut variables = Vec::new();
    let mut cursor = data as *const ffi::RetroVariable;
    loop {
        let entry = unsafe { &*cursor };
        if entry.key.is_null() {
            break;
        }
        let key = unsafe { CStr::from_ptr(entry.key) }.to_string_lossy().into_owned();
        if !entry.value.is_null() {
            let raw_value = unsafe { CStr::from_ptr(entry.value) }.to_string_lossy();
            if let Some((description, choices)) = parse_variable_value(&raw_value) {
                variables.push(CoreVariable {
                    key,
                    description,
                    choices,
                });
            }
        }
        cursor = unsafe { cursor.add(1) };
    }
    if let Some(sinks) = sinks_lock().as_ref() {
        let _ = sinks
            .environment
            .send(EnvironmentEvent::VariablesDeclared(variables));
    }
    true
}

/// `retro_hw_get_current_framebuffer_t` — Harmony's answer, wired into every
/// accepted [`ffi::RetroHwRenderCallback`]. Reads the active session's
/// [`super::hw_render::HwRenderContext`] (installed by the runtime loop once
/// it has actually created one in response to
/// [`EnvironmentEvent::HwRenderRequested`]); before that point (or after
/// teardown) there is nothing to render into, so this answers 0 — the
/// libretro-defined "default framebuffer" sentinel, which a core calling
/// this before context_reset has no business doing anyway.
///
/// # Safety
/// Takes no arguments and touches no caller-supplied pointers; safe to call
/// unconditionally. `unsafe extern "C"` only for ABI-signature uniformity
/// with the rest of this callback set.
pub unsafe extern "C" fn hw_get_current_framebuffer() -> usize {
    active_hw_render_context()
        .map(|ctx| ctx.current_framebuffer())
        .unwrap_or(0)
}

/// `retro_hw_get_proc_address_t` — Harmony's answer, wired into every
/// accepted [`ffi::RetroHwRenderCallback`]. `None` (a null answer, the
/// libretro-defined "not found" result) with no active HW-render context or
/// an unresolvable symbol — never a dangling pointer.
///
/// # Safety
/// `sym`, when non-null, must be a valid, NUL-terminated C string — the
/// `retro_hw_get_proc_address_t` contract.
pub unsafe extern "C" fn hw_get_proc_address(sym: *const c_char) -> Option<ffi::RetroProcAddressFn> {
    if sym.is_null() {
        return None;
    }
    let name = unsafe { CStr::from_ptr(sym) }.to_string_lossy();
    active_hw_render_context().and_then(|ctx| ctx.get_proc_address(&name))
}

/// The active session's [`super::hw_render::HwRenderContext`], if any —
/// installed by the runtime loop after it creates one
/// ([`super::runtime::CoreLoop`]'s HW-render bring-up) and cleared on
/// teardown, mirroring how [`SINKS`] tracks the rest of a session's
/// process-global state (see the module doc's rationale: libretro's
/// pre-v2 callback ABI has no per-instance userdata pointer).
static HW_RENDER_CONTEXT: Mutex<Option<std::sync::Arc<super::hw_render::HwRenderContext>>> =
    Mutex::new(None);

fn active_hw_render_context() -> Option<std::sync::Arc<super::hw_render::HwRenderContext>> {
    HW_RENDER_CONTEXT
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

/// Installs the runtime's freshly created HW-render context so
/// [`hw_get_current_framebuffer`]/[`hw_get_proc_address`] can answer the
/// core's calls during `retro_run`. Called once per session, only after a
/// core's `RETRO_ENVIRONMENT_SET_HW_RENDER` negotiation was accepted.
pub fn install_hw_render_context(ctx: std::sync::Arc<super::hw_render::HwRenderContext>) {
    *HW_RENDER_CONTEXT.lock().unwrap_or_else(|p| p.into_inner()) = Some(ctx);
}

/// Clears the active HW-render context — called on session teardown
/// ([`uninstall`]) so a stray callback from a dying core thread never reaches
/// a context another session is about to build.
fn clear_hw_render_context() {
    *HW_RENDER_CONTEXT.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// `RETRO_ENVIRONMENT_SET_HW_RENDER`: decodes the core's partially-filled
/// [`ffi::RetroHwRenderCallback`], accepts only a context type Harmony can
/// actually create ([`ffi::RetroHwContextType::Opengl`] or
/// [`ffi::RetroHwContextType::OpenglCore`] — CGL only speaks desktop OpenGL,
/// never GLES/Vulkan/D3D), fills in `get_current_framebuffer`/
/// `get_proc_address`, and forwards the rest
/// ([`EnvironmentEvent::HwRenderRequested`]) so the runtime loop can actually
/// build the context (never eagerly — this callback only negotiates, it
/// never touches GL itself). Rejecting an unsupported context type answers
/// `false`, exactly like any other unhandled environment command — the core
/// then falls back to its own software path or fails `retro_load_game`
/// cleanly, which the existing EJS fallback already covers.
///
/// # Safety
/// `data`, when non-null, must point to a valid, mutable
/// [`ffi::RetroHwRenderCallback`] — the `retro_environment_t` contract for
/// `SET_HW_RENDER`.
unsafe fn set_hw_render(data: *mut c_void) -> bool {
    if data.is_null() {
        return false;
    }
    let render = unsafe { &mut *(data as *mut ffi::RetroHwRenderCallback) };
    if ffi::RetroHwContextType::from_raw(render.context_type).is_none() {
        return false; // GLES/Vulkan/D3D/etc — no CGL equivalent, refuse cleanly
    }
    let request = HwRenderRequest {
        depth: render.depth,
        stencil: render.stencil,
        bottom_left_origin: render.bottom_left_origin,
        context_reset: render.context_reset,
        context_destroy: render.context_destroy,
    };
    render.get_current_framebuffer = Some(hw_get_current_framebuffer);
    render.get_proc_address = Some(hw_get_proc_address);
    if let Some(sinks) = sinks_lock().as_ref() {
        let _ = sinks
            .environment
            .send(EnvironmentEvent::HwRenderRequested(request));
    }
    true
}

/// `retro_environment_t`. Handles the subset of commands the design doc
/// scopes in (overscan/dupe negotiation, pixel format, shutdown, message
/// acknowledgment, core-declared option variables — W282, mid-game geometry
/// renegotiation — W340, HW-render negotiation — W345); everything else
/// reports unhandled (`false`), matching what a real core would see querying
/// a feature Harmony doesn't implement.
///
/// # Safety
/// `data`, when non-null, must point to a valid, correctly-typed output
/// location for `cmd` (e.g. a `bool` for `GET_CAN_DUPE`/`GET_OVERSCAN`, a
/// `u32` for `SET_PIXEL_FORMAT`, a [`ffi::RetroVariable`] for `GET_VARIABLE`,
/// a null-terminated `RetroVariable` array for `SET_VARIABLES`, a
/// [`ffi::RetroGameGeometry`] for `SET_GEOMETRY`) — the contract
/// `retro_environment_t` callers are required to uphold.
pub unsafe extern "C" fn environment(cmd: u32, data: *mut c_void) -> bool {
    match cmd {
        ffi::RETRO_ENVIRONMENT_GET_CAN_DUPE => {
            write_bool(data, true);
            true
        }
        ffi::RETRO_ENVIRONMENT_GET_OVERSCAN => {
            write_bool(data, false);
            true
        }
        ffi::RETRO_ENVIRONMENT_SET_PIXEL_FORMAT => {
            if data.is_null() {
                return false;
            }
            let raw = unsafe { *(data as *const u32) };
            match PixelFormat::from_raw(raw) {
                Some(format) => {
                    if let Some(sinks) = sinks_lock().as_ref() {
                        let _ = sinks.environment.send(EnvironmentEvent::PixelFormat(format));
                    }
                    true
                }
                None => false,
            }
        }
        // Acknowledged; Harmony doesn't surface core toast messages (yet).
        ffi::RETRO_ENVIRONMENT_SET_MESSAGE => true,
        ffi::RETRO_ENVIRONMENT_GET_VARIABLE => unsafe { get_variable(data) },
        ffi::RETRO_ENVIRONMENT_SET_VARIABLES => unsafe { set_variables(data) },
        ffi::RETRO_ENVIRONMENT_SET_GEOMETRY => {
            if data.is_null() {
                return false;
            }
            let geometry = unsafe { &*(data as *const ffi::RetroGameGeometry) };
            if let Some(sinks) = sinks_lock().as_ref() {
                let _ = sinks
                    .environment
                    .send(EnvironmentEvent::GeometryChanged(GeometryUpdate {
                        width: geometry.base_width,
                        height: geometry.base_height,
                        aspect_ratio: geometry.aspect_ratio,
                    }));
            }
            true
        }
        ffi::RETRO_ENVIRONMENT_SET_HW_RENDER => unsafe { set_hw_render(data) },
        ffi::RETRO_ENVIRONMENT_SHUTDOWN => {
            if let Some(sinks) = sinks_lock().as_ref() {
                let _ = sinks.environment.send(EnvironmentEvent::Shutdown);
            }
            true
        }
        cmd => {
            let mut logged = LOGGED_UNHANDLED_ENV_CMDS.lock().unwrap_or_else(|p| p.into_inner());
            if logged.get_or_insert_with(HashSet::new).insert(cmd) {
                eprintln!("[harmony-native] unhandled environment cmd {cmd} (core queried, Harmony returned false)");
            }
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn video_refresh_copies_frame_data_into_the_channel() {
        let _guard = lock_tests();
        let channels = install();
        let pixels: [u8; 8] = [1, 2, 3, 4, 5, 6, 7, 8]; // 2 rows of 4-byte stride
        unsafe { video_refresh(pixels.as_ptr() as *const c_void, 2, 2, 4) };
        let frame = channels
            .video
            .recv_timeout(Duration::from_millis(200))
            .expect("frame sent");
        assert_eq!(frame.data, pixels);
        assert_eq!(frame.width, 2);
        assert_eq!(frame.height, 2);
        assert_eq!(frame.pitch, 4);
        uninstall();
    }

    #[test]
    fn video_refresh_with_null_data_is_a_duplicate_frame_and_is_dropped() {
        let _guard = lock_tests();
        let channels = install();
        unsafe { video_refresh(std::ptr::null(), 2, 1, 4) };
        assert!(channels
            .video
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        uninstall();
    }

    // ---- W345: RETRO_HW_FRAME_BUFFER_VALID sentinel ----

    #[test]
    fn video_refresh_with_the_hw_frame_sentinel_forwards_a_marker_not_pixel_data() {
        let _guard = lock_tests();
        let channels = install();
        unsafe { video_refresh(ffi::RETRO_HW_FRAME_BUFFER_VALID, 320, 240, 0) };
        let frame = channels
            .video
            .recv_timeout(Duration::from_millis(200))
            .expect("a marker frame must be sent");
        assert!(frame.is_hw_frame);
        assert!(frame.data.is_empty(), "no pixel bytes are copied for a HW frame");
        assert_eq!((frame.width, frame.height), (320, 240));
        uninstall();
    }

    #[test]
    fn video_refresh_with_real_data_is_not_marked_as_a_hw_frame() {
        let _guard = lock_tests();
        let channels = install();
        let pixels: [u8; 4] = [1, 2, 3, 4];
        unsafe { video_refresh(pixels.as_ptr() as *const c_void, 1, 1, 4) };
        let frame = channels
            .video
            .recv_timeout(Duration::from_millis(200))
            .expect("frame sent");
        assert!(!frame.is_hw_frame);
        assert_eq!(frame.data, pixels);
        uninstall();
    }

    #[test]
    fn audio_sample_batch_copies_interleaved_stereo_samples() {
        let _guard = lock_tests();
        let channels = install();
        let samples: [i16; 4] = [100, -100, 200, -200]; // 2 stereo frames
        let consumed = unsafe { audio_sample_batch(samples.as_ptr(), 2) };
        assert_eq!(consumed, 2);
        let batch = channels
            .audio
            .recv_timeout(Duration::from_millis(200))
            .expect("batch sent");
        assert_eq!(batch.samples, samples);
        uninstall();
    }

    #[test]
    fn audio_sample_batch_with_zero_frames_sends_nothing() {
        let _guard = lock_tests();
        let channels = install();
        let consumed = unsafe { audio_sample_batch(std::ptr::null(), 0) };
        assert_eq!(consumed, 0);
        assert!(channels
            .audio
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        uninstall();
    }

    #[test]
    fn input_state_reflects_the_last_set_joypad_bitmask() {
        let _guard = lock_tests();
        set_joypad_state(1 << ffi::RETRO_DEVICE_ID_JOYPAD_A, 0);
        assert_eq!(
            unsafe { input_state(0, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_A) },
            1
        );
        assert_eq!(
            unsafe { input_state(0, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_B) },
            0
        );
        release_all_native_input();
    }

    #[test]
    fn input_state_rejects_unsupported_devices() {
        let _guard = lock_tests();
        set_joypad_state(u16::MAX, 0);
        assert_eq!(unsafe { input_state(0, 999, 0, 0) }, 0); // not RETRO_DEVICE_JOYPAD
        release_all_native_input();
    }

    #[test]
    fn a_stub_core_polling_ports_0_and_1_sees_two_independent_masks() {
        let _guard = lock_tests();
        set_joypad_state(1 << ffi::RETRO_DEVICE_ID_JOYPAD_A, 0);
        set_joypad_state(1 << ffi::RETRO_DEVICE_ID_JOYPAD_B, 1);
        assert_eq!(
            unsafe { input_state(0, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_A) },
            1
        );
        assert_eq!(
            unsafe { input_state(1, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_B) },
            1
        );
        release_all_native_input();
    }

    #[test]
    fn a_press_on_port_1_never_leaks_into_port_0() {
        let _guard = lock_tests();
        set_joypad_state(1 << ffi::RETRO_DEVICE_ID_JOYPAD_START, 1);
        assert_eq!(
            unsafe {
                input_state(0, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_START)
            },
            0
        );
        assert_eq!(
            unsafe {
                input_state(1, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_START)
            },
            1
        );
        release_all_native_input();
    }

    #[test]
    fn ports_at_or_beyond_num_native_input_ports_report_not_pressed() {
        let _guard = lock_tests();
        set_joypad_state(u16::MAX, 0);
        set_joypad_state(u16::MAX, 1);
        assert_eq!(
            unsafe {
                input_state(
                    NUM_NATIVE_INPUT_PORTS as u32,
                    ffi::RETRO_DEVICE_JOYPAD,
                    0,
                    ffi::RETRO_DEVICE_ID_JOYPAD_A,
                )
            },
            0
        );
        release_all_native_input();
    }

    #[test]
    fn set_joypad_state_beyond_num_native_input_ports_is_a_silent_no_op() {
        let _guard = lock_tests();
        // Must not panic — an out-of-range port is a harmless no-op, matching
        // this module's existing "stray call" contract.
        set_joypad_state(u16::MAX, NUM_NATIVE_INPUT_PORTS);
        release_all_native_input();
    }

    #[test]
    fn release_all_native_input_clears_every_port() {
        let _guard = lock_tests();
        set_joypad_state(u16::MAX, 0);
        set_joypad_state(u16::MAX, 1);
        release_all_native_input();
        for port in 0..NUM_NATIVE_INPUT_PORTS as u32 {
            assert_eq!(
                unsafe {
                    input_state(port, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_A)
                },
                0
            );
        }
    }

    /// Pre-merge review follow-up on W350: a stray `set_native_input` landing
    /// between sessions (the keydown race after a stop — the command is a
    /// no-session no-op by design) must not leave ghost held buttons the next
    /// session's core reads at boot. `install` (session start) clears every
    /// port, so the first poll of a fresh session always reads all-zero.
    #[test]
    fn install_clears_stale_port_state_left_between_sessions() {
        let _guard = lock_tests();
        uninstall(); // no session running
        set_joypad_state(u16::MAX, 0); // the stray between-session keydown
        set_joypad_state(u16::MAX, 1);
        let _channels = install(); // session start
        for port in 0..NUM_NATIVE_INPUT_PORTS as u32 {
            assert_eq!(
                unsafe {
                    input_state(port, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_A)
                },
                0,
                "session start must clear port {port}'s stale between-session input"
            );
        }
        uninstall();
    }

    #[test]
    fn uninstall_releases_all_ports_alongside_sinks() {
        let _guard = lock_tests();
        let _channels = install();
        set_joypad_state(u16::MAX, 0);
        set_joypad_state(u16::MAX, 1);
        uninstall();
        for port in 0..NUM_NATIVE_INPUT_PORTS as u32 {
            assert_eq!(
                unsafe {
                    input_state(port, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_A)
                },
                0
            );
        }
    }

    #[test]
    fn environment_negotiates_pixel_format() {
        let _guard = lock_tests();
        let channels = install();
        let mut fmt: u32 = ffi::RETRO_PIXEL_FORMAT_XRGB8888;
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_PIXEL_FORMAT,
                &mut fmt as *mut u32 as *mut c_void,
            )
        };
        assert!(ok);
        let event = channels
            .environment
            .recv_timeout(Duration::from_millis(200))
            .expect("event sent");
        assert_eq!(event, EnvironmentEvent::PixelFormat(PixelFormat::Xrgb8888));
        uninstall();
    }

    // ---- W340: RETRO_ENVIRONMENT_SET_GEOMETRY (mid-game geometry change) ----

    #[test]
    fn environment_forwards_a_mid_game_geometry_change() {
        let _guard = lock_tests();
        let channels = install();
        let mut geometry = ffi::RetroGameGeometry {
            base_width: 512,
            base_height: 448,
            max_width: 512,
            max_height: 448,
            aspect_ratio: 16.0 / 9.0,
        };
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_GEOMETRY,
                &mut geometry as *mut ffi::RetroGameGeometry as *mut c_void,
            )
        };
        assert!(ok);
        let event = channels
            .environment
            .recv_timeout(Duration::from_millis(200))
            .expect("event sent");
        assert_eq!(
            event,
            EnvironmentEvent::GeometryChanged(GeometryUpdate {
                width: 512,
                height: 448,
                aspect_ratio: 16.0 / 9.0,
            })
        );
        uninstall();
    }

    #[test]
    fn environment_set_geometry_with_null_data_is_not_handled() {
        let _guard = lock_tests();
        assert!(!unsafe { environment(ffi::RETRO_ENVIRONMENT_SET_GEOMETRY, std::ptr::null_mut()) });
    }

    // ---- W345: RETRO_ENVIRONMENT_SET_HW_RENDER (HW-render negotiation) ----

    unsafe extern "C" fn stub_context_reset() {}
    unsafe extern "C" fn stub_context_destroy() {}

    fn hw_render_callback(context_type: u32) -> ffi::RetroHwRenderCallback {
        ffi::RetroHwRenderCallback {
            context_type,
            context_reset: Some(stub_context_reset),
            get_current_framebuffer: None,
            get_proc_address: None,
            depth: true,
            stencil: false,
            bottom_left_origin: true,
            version_major: 3,
            version_minor: 1,
            cache_context: false,
            context_destroy: Some(stub_context_destroy),
            debug_context: false,
        }
    }

    #[test]
    fn environment_accepts_opengl_core_hw_render_and_forwards_the_request() {
        let _guard = lock_tests();
        let channels = install();
        let mut render = hw_render_callback(3 /* RETRO_HW_CONTEXT_OPENGL_CORE */);
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_HW_RENDER,
                &mut render as *mut ffi::RetroHwRenderCallback as *mut c_void,
            )
        };
        assert!(ok);
        let event = channels
            .environment
            .recv_timeout(Duration::from_millis(200))
            .expect("event sent");
        match event {
            EnvironmentEvent::HwRenderRequested(request) => {
                assert!(request.depth);
                assert!(!request.stencil);
                assert!(request.bottom_left_origin);
                assert!(request.context_reset.is_some());
                assert!(request.context_destroy.is_some());
            }
            other => panic!("expected HwRenderRequested, got {other:?}"),
        }
        uninstall();
    }

    #[test]
    fn environment_accepts_plain_opengl_hw_render() {
        let _guard = lock_tests();
        let channels = install();
        let mut render = hw_render_callback(1 /* RETRO_HW_CONTEXT_OPENGL */);
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_HW_RENDER,
                &mut render as *mut ffi::RetroHwRenderCallback as *mut c_void,
            )
        };
        assert!(ok);
        assert!(channels
            .environment
            .recv_timeout(Duration::from_millis(200))
            .is_ok());
        uninstall();
    }

    #[test]
    fn environment_set_hw_render_fills_in_the_frontend_callbacks() {
        let _guard = lock_tests();
        let channels = install();
        let mut render = hw_render_callback(3);
        unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_HW_RENDER,
                &mut render as *mut ffi::RetroHwRenderCallback as *mut c_void,
            )
        };
        assert!(render.get_current_framebuffer.is_some());
        assert!(render.get_proc_address.is_some());
        let _ = channels.environment.recv_timeout(Duration::from_millis(200));
        uninstall();
    }

    #[test]
    fn environment_rejects_an_unsupported_hw_context_type() {
        let _guard = lock_tests();
        let channels = install();
        // RETRO_HW_CONTEXT_VULKAN (6) — no CGL equivalent, must be refused.
        let mut render = hw_render_callback(6);
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_HW_RENDER,
                &mut render as *mut ffi::RetroHwRenderCallback as *mut c_void,
            )
        };
        assert!(!ok, "an unsupported context type must be refused, not silently accepted");
        assert!(
            channels
                .environment
                .recv_timeout(Duration::from_millis(50))
                .is_err(),
            "a refused negotiation must not forward an event"
        );
        // Harmony must not have overwritten the core's callback slots for a
        // rejected negotiation — the core is expected to ignore them anyway,
        // but leaving them untouched is the conservative, contract-correct
        // behavior.
        assert!(render.get_current_framebuffer.is_none());
        assert!(render.get_proc_address.is_none());
        uninstall();
    }

    #[test]
    fn environment_set_hw_render_with_null_data_is_not_handled() {
        let _guard = lock_tests();
        assert!(!unsafe { environment(ffi::RETRO_ENVIRONMENT_SET_HW_RENDER, std::ptr::null_mut()) });
    }

    #[test]
    fn hw_get_current_framebuffer_answers_zero_with_no_active_context() {
        let _guard = lock_tests();
        clear_hw_render_context();
        assert_eq!(unsafe { hw_get_current_framebuffer() }, 0);
    }

    #[test]
    fn hw_get_proc_address_answers_none_with_no_active_context() {
        let _guard = lock_tests();
        clear_hw_render_context();
        let sym = CString::new("glGetString").unwrap();
        assert!(unsafe { hw_get_proc_address(sym.as_ptr()) }.is_none());
    }

    #[test]
    fn hw_get_proc_address_with_null_sym_is_none() {
        let _guard = lock_tests();
        assert!(unsafe { hw_get_proc_address(std::ptr::null()) }.is_none());
    }

    #[test]
    fn uninstall_clears_the_active_hw_render_context() {
        let _guard = lock_tests();
        // Build a real context via the same test-only path hw_render's own
        // tests use, install it, then confirm uninstall() tears it back out —
        // proving the "unload cleanly so a second session can start"
        // acceptance criterion at the FFI-callback layer, not just the
        // HwRenderContext layer hw_render.rs's own tests already cover.
        #[cfg(target_os = "macos")]
        {
            let request = HwRenderRequest {
                depth: false,
                stencil: false,
                bottom_left_origin: false,
                context_reset: None,
                context_destroy: None,
            };
            let ctx = super::super::hw_render::HwRenderContext::create(2, 2, request)
                .expect("headless CGL context");
            install_hw_render_context(std::sync::Arc::new(ctx));
            assert_ne!(unsafe { hw_get_current_framebuffer() }, 0);
            uninstall();
            assert_eq!(unsafe { hw_get_current_framebuffer() }, 0);
        }
    }

    #[test]
    fn environment_rejects_unknown_pixel_format() {
        let _guard = lock_tests();
        let mut fmt: u32 = 999;
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_PIXEL_FORMAT,
                &mut fmt as *mut u32 as *mut c_void,
            )
        };
        assert!(!ok);
    }

    #[test]
    fn environment_reports_can_dupe_and_overscan() {
        let _guard = lock_tests();
        let mut can_dupe = false;
        assert!(unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_GET_CAN_DUPE,
                &mut can_dupe as *mut bool as *mut c_void,
            )
        });
        assert!(can_dupe);

        let mut overscan = true;
        assert!(unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_GET_OVERSCAN,
                &mut overscan as *mut bool as *mut c_void,
            )
        });
        assert!(!overscan);
    }

    #[test]
    fn environment_shutdown_is_forwarded() {
        let _guard = lock_tests();
        let channels = install();
        assert!(unsafe { environment(ffi::RETRO_ENVIRONMENT_SHUTDOWN, std::ptr::null_mut()) });
        let event = channels
            .environment
            .recv_timeout(Duration::from_millis(200))
            .expect("event sent");
        assert_eq!(event, EnvironmentEvent::Shutdown);
        uninstall();
    }

    #[test]
    fn environment_unknown_command_is_not_handled() {
        let _guard = lock_tests();
        assert!(!unsafe { environment(9999, std::ptr::null_mut()) });
    }

    /// W344 (PS1, single-disc scope): Harmony implements no disk-control
    /// interface, so a core asking for one (e.g. pcsx_rearmed on a multi-disc
    /// game probing for swap support) must degrade exactly like any other
    /// environment command Harmony doesn't implement — `false`, no panic —
    /// never a crash, and never a silently-invented disk-control response.
    /// `RETRO_ENVIRONMENT_SET_DISK_CONTROL_INTERFACE` is libretro.h's real
    /// numeric id (61); Harmony deliberately gives it no named constant here
    /// (see ffi.rs's "only implemented commands are named" convention) since
    /// it falls through the same unhandled-command arm as any other
    /// unimplemented command.
    #[test]
    fn environment_set_disk_control_interface_is_not_handled() {
        let _guard = lock_tests();
        const RETRO_ENVIRONMENT_SET_DISK_CONTROL_INTERFACE: u32 = 61;
        assert!(!unsafe {
            environment(
                RETRO_ENVIRONMENT_SET_DISK_CONTROL_INTERFACE,
                std::ptr::null_mut(),
            )
        });
    }

    #[test]
    fn callbacks_before_install_are_silent_no_ops() {
        let _guard = lock_tests();
        uninstall(); // ensure a clean slate regardless of test execution order
        let pixels: [u8; 4] = [1, 2, 3, 4];
        unsafe { video_refresh(pixels.as_ptr() as *const c_void, 1, 1, 4) }; // must not panic
        let consumed = unsafe { audio_sample_batch(std::ptr::null(), 0) };
        assert_eq!(consumed, 0);
    }

    // ---- W282: RETRO_ENVIRONMENT_GET_VARIABLE / SET_VARIABLES ----

    #[test]
    fn parse_variable_value_splits_description_default_and_choices() {
        let (desc, choices) = parse_variable_value("Sprite Limit; enabled|disabled").unwrap();
        assert_eq!(desc, "Sprite Limit");
        assert_eq!(choices, vec!["enabled", "disabled"]);
    }

    #[test]
    fn parse_variable_value_trims_whitespace_around_each_piece() {
        let (desc, choices) = parse_variable_value("  Region ;  ntsc | pal  ").unwrap();
        assert_eq!(desc, "Region");
        assert_eq!(choices, vec!["ntsc", "pal"]);
    }

    #[test]
    fn parse_variable_value_rejects_a_missing_separator() {
        assert!(parse_variable_value("no semicolon here").is_none());
    }

    #[test]
    fn parse_variable_value_rejects_zero_choices() {
        assert!(parse_variable_value("Description;").is_none());
        assert!(parse_variable_value("Description; | ").is_none());
    }

    #[test]
    fn core_variable_default_value_is_the_first_choice() {
        let var = CoreVariable {
            key: "fceumm_sprite_limit".into(),
            description: "Sprite Limit".into(),
            choices: vec!["enabled".into(), "disabled".into()],
        };
        assert_eq!(var.default_value(), "enabled");
    }

    /// Builds a null-terminated `retro_variable` array from `(key, value)`
    /// pairs, keeping the backing `CString`s alive in the returned `Vec` so
    /// the raw pointers stored in the array stay valid for the caller's use.
    fn build_variable_array(
        pairs: &[(&str, &str)],
    ) -> (Vec<ffi::RetroVariable>, Vec<CString>) {
        let mut owned = Vec::new();
        let mut array = Vec::new();
        for (k, v) in pairs {
            let key = CString::new(*k).unwrap();
            let value = CString::new(*v).unwrap();
            array.push(ffi::RetroVariable {
                key: key.as_ptr(),
                value: value.as_ptr(),
            });
            owned.push(key);
            owned.push(value);
        }
        array.push(ffi::RetroVariable {
            key: std::ptr::null(),
            value: std::ptr::null(),
        });
        (array, owned)
    }

    #[test]
    fn environment_set_variables_decodes_and_forwards_the_declared_options() {
        let _guard = lock_tests();
        let channels = install();
        let (mut array, _owned) = build_variable_array(&[
            ("fceumm_sprite_limit", "Sprite Limit; enabled|disabled"),
            ("fceumm_region", "Region; auto|ntsc|pal"),
        ]);
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_VARIABLES,
                array.as_mut_ptr() as *mut c_void,
            )
        };
        assert!(ok);
        let event = channels
            .environment
            .recv_timeout(Duration::from_millis(200))
            .expect("event sent");
        match event {
            EnvironmentEvent::VariablesDeclared(vars) => {
                assert_eq!(vars.len(), 2);
                assert_eq!(vars[0].key, "fceumm_sprite_limit");
                assert_eq!(vars[0].description, "Sprite Limit");
                assert_eq!(vars[0].choices, vec!["enabled", "disabled"]);
                assert_eq!(vars[1].key, "fceumm_region");
                assert_eq!(vars[1].choices, vec!["auto", "ntsc", "pal"]);
            }
            other => panic!("expected VariablesDeclared, got {other:?}"),
        }
        uninstall();
    }

    #[test]
    fn environment_set_variables_skips_malformed_entries() {
        let _guard = lock_tests();
        let channels = install();
        let (mut array, _owned) = build_variable_array(&[
            ("good_key", "Good; a|b"),
            ("bad_key", "no separator at all"),
        ]);
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_SET_VARIABLES,
                array.as_mut_ptr() as *mut c_void,
            )
        };
        assert!(ok);
        let event = channels
            .environment
            .recv_timeout(Duration::from_millis(200))
            .expect("event sent");
        match event {
            EnvironmentEvent::VariablesDeclared(vars) => {
                assert_eq!(vars.len(), 1);
                assert_eq!(vars[0].key, "good_key");
            }
            other => panic!("expected VariablesDeclared, got {other:?}"),
        }
        uninstall();
    }

    #[test]
    fn environment_set_variables_with_null_data_is_accepted_as_a_no_op() {
        let _guard = lock_tests();
        assert!(unsafe { environment(ffi::RETRO_ENVIRONMENT_SET_VARIABLES, std::ptr::null_mut()) });
    }

    #[test]
    fn environment_get_variable_answers_a_seeded_value() {
        let _guard = lock_tests();
        let mut values = HashMap::new();
        values.insert("fceumm_region".to_string(), "pal".to_string());
        set_core_variables(values);

        let key = CString::new("fceumm_region").unwrap();
        let mut var = ffi::RetroVariable {
            key: key.as_ptr(),
            value: std::ptr::null(),
        };
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_GET_VARIABLE,
                &mut var as *mut ffi::RetroVariable as *mut c_void,
            )
        };
        assert!(ok);
        assert!(!var.value.is_null());
        let answered = unsafe { CStr::from_ptr(var.value) }.to_str().unwrap();
        assert_eq!(answered, "pal");
        uninstall();
    }

    #[test]
    fn environment_get_variable_rejects_an_unknown_key() {
        let _guard = lock_tests();
        set_core_variables(HashMap::new());

        let key = CString::new("never_declared").unwrap();
        let mut var = ffi::RetroVariable {
            key: key.as_ptr(),
            value: std::ptr::null(),
        };
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_GET_VARIABLE,
                &mut var as *mut ffi::RetroVariable as *mut c_void,
            )
        };
        assert!(!ok);
        uninstall();
    }

    #[test]
    fn environment_get_variable_before_any_seed_is_rejected() {
        let _guard = lock_tests();
        uninstall(); // no set_core_variables call at all this time

        let key = CString::new("anything").unwrap();
        let mut var = ffi::RetroVariable {
            key: key.as_ptr(),
            value: std::ptr::null(),
        };
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_GET_VARIABLE,
                &mut var as *mut ffi::RetroVariable as *mut c_void,
            )
        };
        assert!(!ok);
    }

    #[test]
    fn uninstall_clears_seeded_core_variables() {
        let _guard = lock_tests();
        let mut values = HashMap::new();
        values.insert("k".to_string(), "v".to_string());
        set_core_variables(values);
        uninstall();

        let key = CString::new("k").unwrap();
        let mut var = ffi::RetroVariable {
            key: key.as_ptr(),
            value: std::ptr::null(),
        };
        let ok = unsafe {
            environment(
                ffi::RETRO_ENVIRONMENT_GET_VARIABLE,
                &mut var as *mut ffi::RetroVariable as *mut c_void,
            )
        };
        assert!(!ok, "uninstall must clear previously seeded variables");
    }
}
