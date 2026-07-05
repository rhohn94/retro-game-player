//! Raw libretro C ABI surface — struct layouts, constants, and function-pointer
//! typedefs transcribed verbatim from `libretro.h`
//! (<https://github.com/libretro/libretro-common/blob/master/include/libretro.h>).
//! Field order and types must match the header exactly: this is the one place
//! in the codebase where a wrong line silently corrupts memory across the FFI
//! boundary instead of tripping a compiler error. Scope is intentionally
//! narrow — only the functions [`super::host::LibretroCore`] actually calls:
//! the original ~13 lifecycle/callback functions plus the five
//! serialize/memory functions save persistence needs (v0.23 W230, see
//! docs/design/save-persistence-design.md). Still no controller-port/device
//! switching.

#![allow(dead_code)]

use std::os::raw::{c_char, c_void};

/// The libretro API version Harmony hosts against. A core reporting a
/// different version is refused at load time rather than risking an ABI
/// mismatch deeper in the call chain.
pub const RETRO_API_VERSION: u32 = 1;

pub const RETRO_DEVICE_JOYPAD: u32 = 1;

/// `retro_get_memory_data`/`_size` id for battery-backed save RAM (`.srm`).
pub const RETRO_MEMORY_SAVE_RAM: u32 = 0;

pub const RETRO_DEVICE_ID_JOYPAD_B: u32 = 0;
pub const RETRO_DEVICE_ID_JOYPAD_Y: u32 = 1;
pub const RETRO_DEVICE_ID_JOYPAD_SELECT: u32 = 2;
pub const RETRO_DEVICE_ID_JOYPAD_START: u32 = 3;
pub const RETRO_DEVICE_ID_JOYPAD_UP: u32 = 4;
pub const RETRO_DEVICE_ID_JOYPAD_DOWN: u32 = 5;
pub const RETRO_DEVICE_ID_JOYPAD_LEFT: u32 = 6;
pub const RETRO_DEVICE_ID_JOYPAD_RIGHT: u32 = 7;
pub const RETRO_DEVICE_ID_JOYPAD_A: u32 = 8;
pub const RETRO_DEVICE_ID_JOYPAD_X: u32 = 9;
pub const RETRO_DEVICE_ID_JOYPAD_L: u32 = 10;
pub const RETRO_DEVICE_ID_JOYPAD_R: u32 = 11;

pub const RETRO_PIXEL_FORMAT_0RGB1555: u32 = 0;
pub const RETRO_PIXEL_FORMAT_XRGB8888: u32 = 1;
pub const RETRO_PIXEL_FORMAT_RGB565: u32 = 2;

pub const RETRO_ENVIRONMENT_SET_ROTATION: u32 = 1;
pub const RETRO_ENVIRONMENT_GET_OVERSCAN: u32 = 2;
pub const RETRO_ENVIRONMENT_GET_CAN_DUPE: u32 = 3;
pub const RETRO_ENVIRONMENT_SET_MESSAGE: u32 = 6;
pub const RETRO_ENVIRONMENT_SHUTDOWN: u32 = 7;
pub const RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: u32 = 10;
pub const RETRO_ENVIRONMENT_GET_VARIABLE: u32 = 15;
pub const RETRO_ENVIRONMENT_SET_VARIABLES: u32 = 16;
/// A core renegotiating its video geometry mid-game (e.g. a system whose
/// resolution or aspect ratio changes between titles/scenes) without a full
/// `retro_get_system_av_info` re-query — W340 (multi-system engine
/// generalization). Payload is a `RetroGameGeometry` (the `geometry` half of
/// `RetroSystemAvInfo`); timing is unaffected by this command.
pub const RETRO_ENVIRONMENT_SET_GEOMETRY: u32 = 37;
/// A core requesting a hardware-rendered (GPU) video context instead of
/// pushing pixel buffers through `retro_video_refresh_t` — W345 (HW-render
/// subsystem). Payload is a [`RetroHwRenderCallback`] the core has partly
/// filled in (`context_type`, `depth`, `stencil`, `bottom_left_origin`,
/// `cache_context`, `debug_context`); Harmony fills in
/// `get_current_framebuffer`/`get_proc_address` and stores
/// `context_reset`/`context_destroy` for later, then reports success only
/// for a context type it can actually create ([`RetroHwContextType::Opengl`]
/// or [`RetroHwContextType::OpenglCore`] on macOS) — anything else is
/// refused so the core falls back to its own software path or fails init
/// cleanly, never a corrupted negotiation.
pub const RETRO_ENVIRONMENT_SET_HW_RENDER: u32 = 14;

/// `retro_hw_context_type` — only the two variants Harmony can actually
/// satisfy on macOS (CGL only speaks desktop OpenGL) are given names; every
/// other libretro-defined value (GLES, Vulkan, D3D*, ...) is intentionally
/// absent here and handled as "unrecognized/unsupported" by
/// [`RetroHwContextType::from_raw`] — the environment callback then reports
/// negotiation failure rather than misinterpreting the raw integer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum RetroHwContextType {
    Opengl = 1,
    OpenglCore = 3,
}

impl RetroHwContextType {
    pub fn from_raw(value: u32) -> Option<Self> {
        match value {
            1 => Some(Self::Opengl),
            3 => Some(Self::OpenglCore),
            _ => None,
        }
    }
}

/// `retro_hw_get_current_framebuffer_t` — returns the FBO (or 0 for the
/// default framebuffer) the core should render into on this call.
pub type RetroHwGetCurrentFramebufferFn = unsafe extern "C" fn() -> usize;
/// `retro_proc_address_t` — an opaque GL function pointer, cast by the core
/// to the real signature it looked up.
pub type RetroProcAddressFn = unsafe extern "C" fn();
/// `retro_hw_get_proc_address_t`.
pub type RetroHwGetProcAddressFn = unsafe extern "C" fn(sym: *const c_char) -> Option<RetroProcAddressFn>;
/// `retro_hw_context_reset_t` — used for both `context_reset` and
/// `context_destroy` (libretro reuses the same function-pointer typedef for
/// both fields).
pub type RetroHwContextResetFn = unsafe extern "C" fn();

/// `retro_hw_render_callback`. Field order/types match `libretro.h` exactly.
/// A core fills in `context_type`/`context_reset`/`context_destroy`/`depth`/
/// `stencil`/`bottom_left_origin`/`version_major`/`version_minor`/
/// `cache_context`/`debug_context` before calling
/// `RETRO_ENVIRONMENT_SET_HW_RENDER`; Harmony fills in
/// `get_current_framebuffer`/`get_proc_address` before returning `true`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct RetroHwRenderCallback {
    pub context_type: u32,
    pub context_reset: Option<RetroHwContextResetFn>,
    pub get_current_framebuffer: Option<RetroHwGetCurrentFramebufferFn>,
    pub get_proc_address: Option<RetroHwGetProcAddressFn>,
    pub depth: bool,
    pub stencil: bool,
    pub bottom_left_origin: bool,
    pub version_major: u32,
    pub version_minor: u32,
    pub cache_context: bool,
    pub context_destroy: Option<RetroHwContextResetFn>,
    pub debug_context: bool,
}

/// `retro_variable` (a single core-declared option query/answer pair).
/// Field order/types must match `libretro.h` exactly — this crosses the FFI
/// boundary the same way [`RawSymbols`] does.
#[repr(C)]
pub struct RetroVariable {
    pub key: *const c_char,
    pub value: *const c_char,
}

#[repr(C)]
pub struct RetroSystemInfo {
    pub library_name: *const c_char,
    pub library_version: *const c_char,
    pub valid_extensions: *const c_char,
    pub need_fullpath: bool,
    pub block_extract: bool,
}

impl Default for RetroSystemInfo {
    fn default() -> Self {
        RetroSystemInfo {
            library_name: std::ptr::null(),
            library_version: std::ptr::null(),
            valid_extensions: std::ptr::null(),
            need_fullpath: false,
            block_extract: false,
        }
    }
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct RetroGameGeometry {
    pub base_width: u32,
    pub base_height: u32,
    pub max_width: u32,
    pub max_height: u32,
    pub aspect_ratio: f32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct RetroSystemTiming {
    pub fps: f64,
    pub sample_rate: f64,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
pub struct RetroSystemAvInfo {
    pub geometry: RetroGameGeometry,
    pub timing: RetroSystemTiming,
}

#[repr(C)]
pub struct RetroGameInfo {
    pub path: *const c_char,
    pub data: *const c_void,
    pub size: usize,
    pub meta: *const c_char,
}

pub type RetroVideoRefreshFn =
    unsafe extern "C" fn(data: *const c_void, width: u32, height: u32, pitch: usize);

/// The sentinel `data` pointer value (`(void *)-1`) a hardware-rendered core
/// passes to `retro_video_refresh_t` to mean "I already rendered this frame
/// into the framebuffer you gave me via `get_current_framebuffer` — go read
/// it back yourself" (W345), as opposed to a real pointer (software render)
/// or null (duplicate-frame). Defined here, not in `callbacks.rs`, because it
/// is part of the raw ABI contract, same as the other `RETRO_*` constants.
pub const RETRO_HW_FRAME_BUFFER_VALID: *const c_void = usize::MAX as *const c_void;
pub type RetroAudioSampleBatchFn = unsafe extern "C" fn(data: *const i16, frames: usize) -> usize;
pub type RetroInputPollFn = unsafe extern "C" fn();
pub type RetroInputStateFn =
    unsafe extern "C" fn(port: u32, device: u32, index: u32, id: u32) -> i16;
pub type RetroEnvironmentFn = unsafe extern "C" fn(cmd: u32, data: *mut c_void) -> bool;

/// The raw exported symbol table, loaded once at [`super::host::LibretroCore::load`]
/// time. Every field is `unsafe extern "C" fn` because calling into a
/// dynamically loaded core can never be proven safe by the type system — the
/// safety obligation (correct lifecycle order, single-threaded calls) is
/// upheld by [`super::host::LibretroCore`], not by this struct.
#[derive(Debug)]
pub struct RawSymbols {
    pub retro_init: unsafe extern "C" fn(),
    pub retro_deinit: unsafe extern "C" fn(),
    pub retro_api_version: unsafe extern "C" fn() -> u32,
    pub retro_get_system_info: unsafe extern "C" fn(*mut RetroSystemInfo),
    pub retro_get_system_av_info: unsafe extern "C" fn(*mut RetroSystemAvInfo),
    pub retro_set_environment: unsafe extern "C" fn(RetroEnvironmentFn),
    pub retro_set_video_refresh: unsafe extern "C" fn(RetroVideoRefreshFn),
    pub retro_set_audio_sample_batch: unsafe extern "C" fn(RetroAudioSampleBatchFn),
    pub retro_set_input_poll: unsafe extern "C" fn(RetroInputPollFn),
    pub retro_set_input_state: unsafe extern "C" fn(RetroInputStateFn),
    pub retro_run: unsafe extern "C" fn(),
    pub retro_load_game: unsafe extern "C" fn(*const RetroGameInfo) -> bool,
    pub retro_unload_game: unsafe extern "C" fn(),
    pub retro_serialize_size: unsafe extern "C" fn() -> usize,
    pub retro_serialize: unsafe extern "C" fn(*mut c_void, usize) -> bool,
    pub retro_unserialize: unsafe extern "C" fn(*const c_void, usize) -> bool,
    pub retro_get_memory_data: unsafe extern "C" fn(u32) -> *mut c_void,
    pub retro_get_memory_size: unsafe extern "C" fn(u32) -> usize,
}
