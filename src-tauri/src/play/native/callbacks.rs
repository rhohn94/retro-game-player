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
use std::os::raw::c_void;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;

/// A decoded video frame, copied out of the core's buffer (which is only
/// valid for the duration of the `retro_video_refresh_t` call).
#[derive(Debug, Clone, PartialEq)]
pub struct VideoFrame {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub pitch: usize,
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

/// Environment-callback events worth surfacing to the runtime loop. Most
/// `RETRO_ENVIRONMENT_*` commands are answered synchronously inline
/// ([`environment`]) and never reach this channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvironmentEvent {
    PixelFormat(PixelFormat),
    Shutdown,
}

struct CallbackSinks {
    video: Sender<VideoFrame>,
    audio: Sender<AudioBatch>,
    environment: Sender<EnvironmentEvent>,
}

static SINKS: Mutex<Option<CallbackSinks>> = Mutex::new(None);

/// Bitmask of currently-pressed joypad buttons, indexed by
/// `RETRO_DEVICE_ID_JOYPAD_*`. Written by the input-mapping layer (W216) via
/// [`set_joypad_state`], read by [`input_state`] on every core poll.
static JOYPAD_STATE: AtomicU16 = AtomicU16::new(0);

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
pub fn install() -> CallbackChannels {
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

/// Clears the global sinks and resets joypad state so a stray callback after
/// a session ends becomes a silent no-op instead of sending into a receiver
/// nobody drains anymore.
pub fn uninstall() {
    *sinks_lock() = None;
    JOYPAD_STATE.store(0, Ordering::Relaxed);
}

/// Sets the full joypad bitmask [`input_state`] reads on the core's next
/// poll. Bit `n` corresponds to `RETRO_DEVICE_ID_JOYPAD_*` value `n`.
pub fn set_joypad_state(bits: u16) {
    JOYPAD_STATE.store(bits, Ordering::Relaxed);
}

/// `retro_video_refresh_t`. A null `data` means "this frame is a duplicate of
/// the last one" (negotiated via `RETRO_ENVIRONMENT_GET_CAN_DUPE`) — dropped
/// rather than forwarded, since there's nothing new to paint.
///
/// # Safety
/// `data`, when non-null, must point to at least `pitch * height` readable
/// bytes — the contract `retro_video_refresh_t` callers (the core, via
/// `retro_run`) are required to uphold.
pub unsafe extern "C" fn video_refresh(data: *const c_void, width: u32, height: u32, pitch: usize) {
    if data.is_null() {
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
/// hosts NES first; no analog/mouse/lightgun devices) — anything else
/// reports "not pressed" rather than panicking.
///
/// # Safety
/// Touches no pointers; safe to call unconditionally. Marked `unsafe` only
/// for signature uniformity with the rest of this callback set.
pub unsafe extern "C" fn input_state(_port: u32, device: u32, _index: u32, id: u32) -> i16 {
    if device != ffi::RETRO_DEVICE_JOYPAD || id > ffi::RETRO_DEVICE_ID_JOYPAD_R {
        return 0;
    }
    let bits = JOYPAD_STATE.load(Ordering::Relaxed);
    i16::from(bits & (1 << id) != 0)
}

fn write_bool(data: *mut c_void, value: bool) {
    if !data.is_null() {
        unsafe {
            *(data as *mut bool) = value;
        }
    }
}

/// `retro_environment_t`. Handles the small subset of commands the design
/// doc scopes in (overscan/dupe negotiation, pixel format, shutdown, message
/// acknowledgment); everything else reports unhandled (`false`), matching
/// what a real core would see querying a feature Harmony doesn't implement.
///
/// # Safety
/// `data`, when non-null, must point to a valid, correctly-typed output
/// location for `cmd` (e.g. a `bool` for `GET_CAN_DUPE`/`GET_OVERSCAN`, a
/// `u32` for `SET_PIXEL_FORMAT`) — the contract `retro_environment_t`
/// callers are required to uphold.
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
        ffi::RETRO_ENVIRONMENT_SHUTDOWN => {
            if let Some(sinks) = sinks_lock().as_ref() {
                let _ = sinks.environment.send(EnvironmentEvent::Shutdown);
            }
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use std::time::Duration;

    /// [`SINKS`]/[`JOYPAD_STATE`] are process-global by FFI necessity (see
    /// the module doc), so tests that touch them must not run concurrently —
    /// `cargo test` runs tests in parallel threads within one process by
    /// default.
    static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn lock_tests() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner())
    }

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
        set_joypad_state(1 << ffi::RETRO_DEVICE_ID_JOYPAD_A);
        assert_eq!(
            unsafe { input_state(0, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_A) },
            1
        );
        assert_eq!(
            unsafe { input_state(0, ffi::RETRO_DEVICE_JOYPAD, 0, ffi::RETRO_DEVICE_ID_JOYPAD_B) },
            0
        );
        set_joypad_state(0);
    }

    #[test]
    fn input_state_rejects_unsupported_devices() {
        let _guard = lock_tests();
        set_joypad_state(u16::MAX);
        assert_eq!(unsafe { input_state(0, 999, 0, 0) }, 0); // not RETRO_DEVICE_JOYPAD
        set_joypad_state(0);
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

    #[test]
    fn callbacks_before_install_are_silent_no_ops() {
        let _guard = lock_tests();
        uninstall(); // ensure a clean slate regardless of test execution order
        let pixels: [u8; 4] = [1, 2, 3, 4];
        unsafe { video_refresh(pixels.as_ptr() as *const c_void, 1, 1, 4) }; // must not panic
        let consumed = unsafe { audio_sample_batch(std::ptr::null(), 0) };
        assert_eq!(consumed, 0);
    }
}
