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
