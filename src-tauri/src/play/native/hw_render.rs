//! HW-render subsystem (W345) — a headless OpenGL context + FBO for cores
//! that negotiate `RETRO_ENVIRONMENT_SET_HW_RENDER` (mupen64plus_next/N64
//! and, per the acceptance note, any future GL-rendering core) instead of
//! pushing software pixel buffers through `retro_video_refresh_t`. See
//! docs/design/native-emulation-design.md §HW-render.
//!
//! **Created only on demand.** [`HwRenderContext::create`] is called exactly
//! once per session, and only after [`super::callbacks::environment`] has
//! accepted a `RETRO_ENVIRONMENT_SET_HW_RENDER` negotiation — a
//! software-rendered core (every system before N64) never touches this
//! module at all, so it can never regress the existing frame pipe.
//!
//! **macOS only.** The context/FBO plumbing is CGL (`CGLPixelFormatObj`/
//! `CGLContextObj`) — the lowest-level, windowless way to get a real OpenGL
//! context on macOS, cfg-gated the same way [`super::runtime`]'s core-thread
//! QoS elevation is. No `NSView`/window is created or required: CGL contexts
//! are usable fully offscreen, which is exactly what an FBO-only render
//! target needs.

use super::ffi::{RetroHwContextResetFn, RetroProcAddressFn};
use crate::error::{AppError, AppResult};
#[cfg(target_os = "macos")]
use std::ffi::CString;
use std::os::raw::c_void;
use std::sync::Mutex;

// ---- Raw OpenGL constants/typedefs this module needs (a small, curated
// subset — not a full gl bindings crate, matching the project's
// hand-rolled-FFI convention for narrow, ABI-stable surfaces like `ffi.rs`). ----

type GLenum = u32;
type GLuint = u32;
type GLsizei = i32;
type GLint = i32;
type GLbitfield = u32;

const GL_FRAMEBUFFER: GLenum = 0x8D40;
const GL_RENDERBUFFER: GLenum = 0x8D41;
const GL_COLOR_ATTACHMENT0: GLenum = 0x8CE0;
const GL_DEPTH_ATTACHMENT: GLenum = 0x8D00;
const GL_DEPTH_STENCIL_ATTACHMENT: GLenum = 0x821A;
const GL_RGBA8: GLenum = 0x8058;
const GL_DEPTH24_STENCIL8: GLenum = 0x88F0;
const GL_DEPTH_COMPONENT24: GLenum = 0x81A6;
const GL_FRAMEBUFFER_COMPLETE: GLenum = 0x8CD5;
const GL_RGBA: GLenum = 0x1908;
const GL_UNSIGNED_BYTE: GLenum = 0x1401;

#[allow(non_snake_case)]
extern "C" {
    fn glGenFramebuffers(n: GLsizei, framebuffers: *mut GLuint);
    fn glDeleteFramebuffers(n: GLsizei, framebuffers: *const GLuint);
    fn glBindFramebuffer(target: GLenum, framebuffer: GLuint);
    fn glGenRenderbuffers(n: GLsizei, renderbuffers: *mut GLuint);
    fn glDeleteRenderbuffers(n: GLsizei, renderbuffers: *const GLuint);
    fn glBindRenderbuffer(target: GLenum, renderbuffer: GLuint);
    fn glRenderbufferStorage(target: GLenum, internal_format: GLenum, width: GLsizei, height: GLsizei);
    fn glFramebufferRenderbuffer(
        target: GLenum,
        attachment: GLenum,
        renderbuffer_target: GLenum,
        renderbuffer: GLuint,
    );
    fn glCheckFramebufferStatus(target: GLenum) -> GLenum;
    fn glViewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei);
    fn glReadPixels(
        x: GLint,
        y: GLint,
        width: GLsizei,
        height: GLsizei,
        format: GLenum,
        gl_type: GLenum,
        pixels: *mut c_void,
    );
    fn glClear(mask: GLbitfield);
    fn glClearColor(r: f32, g: f32, b: f32, a: f32);
}

/// One FBO's backing storage: a color renderbuffer always, plus a combined
/// depth/stencil (or depth-only) renderbuffer when the core asked for either
/// (libretro doesn't offer a stencil-without-depth combination worth
/// modeling separately — a core wanting stencil gets depth too, matching
/// RetroArch's own GL driver behavior).
struct Fbo {
    framebuffer: GLuint,
    color_renderbuffer: GLuint,
    depth_stencil_renderbuffer: Option<GLuint>,
    width: u32,
    height: u32,
}

impl Fbo {
    fn create(width: u32, height: u32, depth: bool, stencil: bool) -> AppResult<Self> {
        unsafe {
            let mut framebuffer = 0;
            glGenFramebuffers(1, &mut framebuffer);
            glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);

            let mut color_renderbuffer = 0;
            glGenRenderbuffers(1, &mut color_renderbuffer);
            glBindRenderbuffer(GL_RENDERBUFFER, color_renderbuffer);
            glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, width as GLsizei, height as GLsizei);
            glFramebufferRenderbuffer(
                GL_FRAMEBUFFER,
                GL_COLOR_ATTACHMENT0,
                GL_RENDERBUFFER,
                color_renderbuffer,
            );

            let depth_stencil_renderbuffer = if depth || stencil {
                let mut rb = 0;
                glGenRenderbuffers(1, &mut rb);
                glBindRenderbuffer(GL_RENDERBUFFER, rb);
                let (internal_format, attachment) = if stencil {
                    (GL_DEPTH24_STENCIL8, GL_DEPTH_STENCIL_ATTACHMENT)
                } else {
                    (GL_DEPTH_COMPONENT24, GL_DEPTH_ATTACHMENT)
                };
                glRenderbufferStorage(GL_RENDERBUFFER, internal_format, width as GLsizei, height as GLsizei);
                // A combined depth+stencil format (GL_DEPTH24_STENCIL8)
                // satisfies both attachment points at once on desktop GL by
                // being bound to GL_DEPTH_STENCIL_ATTACHMENT — no separate
                // GL_STENCIL_ATTACHMENT bind is needed or valid alongside it.
                glFramebufferRenderbuffer(GL_FRAMEBUFFER, attachment, GL_RENDERBUFFER, rb);
                Some(rb)
            } else {
                None
            };

            let status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
            let fbo = Fbo {
                framebuffer,
                color_renderbuffer,
                depth_stencil_renderbuffer,
                width,
                height,
            };
            if status != GL_FRAMEBUFFER_COMPLETE {
                drop(fbo); // frees the GL objects before returning the error
                return Err(AppError::Internal(format!(
                    "HW-render FBO incomplete (status 0x{status:x})"
                )));
            }
            Ok(fbo)
        }
    }

    /// Rebuilds this FBO's storage at a new size (`SET_GEOMETRY`
    /// renegotiation, or the initial size growing past `max_width`/
    /// `max_height` for a core that under-declared them) — replaces every GL
    /// object rather than trying to resize in place, since renderbuffer
    /// storage is immutable once allocated.
    fn resize(&mut self, width: u32, height: u32, depth: bool, stencil: bool) -> AppResult<()> {
        if width == self.width && height == self.height {
            return Ok(());
        }
        let rebuilt = Fbo::create(width, height, depth, stencil)?;
        let old = std::mem::replace(self, rebuilt);
        drop(old);
        Ok(())
    }
}

impl Drop for Fbo {
    fn drop(&mut self) {
        unsafe {
            if let Some(rb) = self.depth_stencil_renderbuffer {
                glDeleteRenderbuffers(1, &rb);
            }
            glDeleteRenderbuffers(1, &self.color_renderbuffer);
            glDeleteFramebuffers(1, &self.framebuffer);
        }
    }
}

/// The negotiated HW-render request a core made via
/// `RETRO_ENVIRONMENT_SET_HW_RENDER`, decoded out of the raw
/// `retro_hw_render_callback` the moment negotiation is accepted
/// ([`super::callbacks::environment`]). Carried to the core thread so
/// [`HwRenderContext::create`] knows what to build; the raw
/// `context_reset`/`context_destroy` function pointers are `Copy` (plain
/// `unsafe extern "C" fn`s), so this struct is freely `Send` between the
/// callback-registration call site and the core thread.
#[derive(Debug, Clone, Copy)]
pub struct HwRenderRequest {
    pub depth: bool,
    pub stencil: bool,
    pub bottom_left_origin: bool,
    pub context_reset: Option<RetroHwContextResetFn>,
    pub context_destroy: Option<RetroHwContextResetFn>,
}

/// Manual `PartialEq`: compares the negotiated flags and each callback's
/// *presence* (`is_some()`), not raw function-pointer identity — comparing
/// `fn` pointers for equality is meaningless per the language reference (two
/// pointers to the same function are not guaranteed to compare equal after
/// inlining/deduplication) and trips `clippy::fn_address_comparisons`. Only
/// used by tests (`EnvironmentEvent` derives `PartialEq` to assert on the
/// event it carries) — no production code compares two `HwRenderRequest`s.
impl PartialEq for HwRenderRequest {
    fn eq(&self, other: &Self) -> bool {
        self.depth == other.depth
            && self.stencil == other.stencil
            && self.bottom_left_origin == other.bottom_left_origin
            && self.context_reset.is_some() == other.context_reset.is_some()
            && self.context_destroy.is_some() == other.context_destroy.is_some()
    }
}

/// A live headless OpenGL context + FBO render target, owned by the core
/// thread for the lifetime of one HW-rendered session. Never constructed for
/// a software-rendered core (see the module doc).
///
/// `fbo` sits behind a `Mutex` purely for interior mutability, not real
/// contention: this struct is shared as an `Arc` between the run loop (which
/// resizes it on `SET_GEOMETRY` and reads it back every frame) and the
/// process-global FFI callback slot
/// ([`super::callbacks::install_hw_render_context`]) the core calls back
/// into — but both call sites only ever run on the same core thread, inside
/// the same `retro_run` tick, one at a time (the libretro contract is
/// single-threaded), so the lock is never actually contended.
pub struct HwRenderContext {
    /// Held only for its `Drop` side effect (tearing down the CGL context) —
    /// never read directly, matching `host.rs`'s `LibretroCore::_library`
    /// convention for the same "RAII handle, no live reads" shape.
    _cgl: CglContext,
    fbo: Mutex<Fbo>,
    request: HwRenderRequest,
}

impl HwRenderContext {
    /// Creates the CGL context, makes it current on the calling (core)
    /// thread, and allocates the initial FBO sized from the core's declared
    /// `max_width`/`max_height` (the frame pipe's own frame-size discipline —
    /// `to_rgba8_into` — is per-frame, but the FBO's GPU storage must be
    /// allocated up front and only reallocated on an explicit resize).
    #[cfg(target_os = "macos")]
    pub fn create(max_width: u32, max_height: u32, request: HwRenderRequest) -> AppResult<Self> {
        let cgl = CglContext::create()?;
        cgl.make_current()?;
        let fbo = Fbo::create(max_width, max_height, request.depth, request.stencil)?;
        unsafe {
            glBindFramebuffer(GL_FRAMEBUFFER, fbo.framebuffer);
            glViewport(0, 0, fbo.width as GLint, fbo.height as GLint);
        }
        Ok(HwRenderContext {
            _cgl: cgl,
            fbo: Mutex::new(fbo),
            request,
        })
    }

    /// No headless-GL story off macOS — HW-render negotiation is refused
    /// before this is ever called (see `callbacks::environment`), so this
    /// exists only to keep the module compiling on other targets.
    #[cfg(not(target_os = "macos"))]
    pub fn create(_max_width: u32, _max_height: u32, _request: HwRenderRequest) -> AppResult<Self> {
        Err(AppError::Unsupported(
            "HW-render is only supported on macOS".into(),
        ))
    }

    fn fbo_lock(&self) -> std::sync::MutexGuard<'_, Fbo> {
        self.fbo.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// `retro_hw_get_current_framebuffer_t`'s answer — the FBO id the core
    /// should render into on this tick.
    pub fn current_framebuffer(&self) -> usize {
        self.fbo_lock().framebuffer as usize
    }

    /// `retro_hw_get_proc_address_t`'s answer for `sym` — looked up in the
    /// system OpenGL framework via `CGLGetProcAddress`-equivalent (this
    /// module uses `dlsym` against the already-linked GL framework, since
    /// CGL contexts don't have a per-context proc-address table the way
    /// EGL/WGL do — every symbol the framework exports is available once the
    /// context is current).
    pub fn get_proc_address(&self, sym: &str) -> Option<RetroProcAddressFn> {
        gl_get_proc_address(sym)
    }

    /// Resizes the FBO for a new geometry (`SET_GEOMETRY`, W340's event) —
    /// called from the run loop, on the core thread, between frames.
    pub fn resize(&self, width: u32, height: u32) -> AppResult<()> {
        let mut fbo = self.fbo_lock();
        fbo.resize(width, height, self.request.depth, self.request.stencil)?;
        unsafe {
            glBindFramebuffer(GL_FRAMEBUFFER, fbo.framebuffer);
            glViewport(0, 0, fbo.width as GLint, fbo.height as GLint);
        }
        Ok(())
    }

    /// Calls the core's `context_reset` — the libretro contract fires this
    /// once the context AND the FBO are ready, after `retro_load_game`
    /// (never during `retro_init`, when the core hasn't yet declared its
    /// geometry). A core that requested HW render but supplied no
    /// `context_reset` is unusual but not an error — it simply never gets
    /// the callback (harmless no-op).
    pub fn signal_context_reset(&self) {
        if let Some(cb) = self.request.context_reset {
            unsafe { cb() };
        }
    }

    /// Reads the current FBO's color attachment back into `out` as tightly
    /// packed RGBA8888 — the hand-off point into the existing software frame
    /// pipe ([`super::frame::to_rgba8_into`]'s sibling for the HW path;
    /// unlike that function this reads real GPU pixels, so there is no
    /// separate pixel-format-decode step). `out` is resized to exactly
    /// `width * height * 4` and reused across calls (steady-state zero
    /// allocation, matching the software path's `to_rgba8_into` discipline).
    ///
    /// Respects `bottom_left_origin`, reasoning through the full chain:
    ///
    /// 1. `glReadPixels(0, 0, w, h, ..)` fills `out` starting at framebuffer
    ///    coordinate y=0 — which GL defines as the framebuffer's **bottom**
    ///    row. So `out`'s first row is always the *framebuffer-bottom* row;
    ///    whether that is the *image's* top or bottom depends entirely on
    ///    which way up the core drew.
    /// 2. A core that declared `bottom_left_origin = true` (mupen64plus_next
    ///    and most GL cores) draws with GL's native bottom-left convention:
    ///    the image's bottom row lands at framebuffer y=0. Readback therefore
    ///    yields the image bottom-first (vertically inverted for any top-down
    ///    consumer) — the rows **must be flipped** here.
    /// 3. A core that left it `false` drew top-left-origin: the image's top
    ///    row is at framebuffer y=0, so the readback is already in top-down
    ///    order and **no flip** is applied.
    /// 4. Every downstream consumer assumes a top-down buffer: the shared
    ///    frame pipe's `Rgba8Frame` contract (all software cores produce
    ///    top-down rows), `NativePlayer`'s `putImageData` (ImageData is
    ///    top-down by definition), and `crtWebglRenderer.ts` (which sets
    ///    `UNPACK_FLIP_Y_WEBGL = true`, i.e. it expects a top-down source it
    ///    flips into GL texture space itself).
    ///
    /// Net: flip iff `bottom_left_origin == true`. This is exactly the class
    /// of bug the v0.29.1 flip regression (a row-order mistake in an
    /// unrelated, software-only path) warns about, so beyond
    /// [`flip_rows_in_place`]'s pure unit tests the end-to-end HW-render
    /// stub test draws an asymmetric top/bottom banding pattern and asserts
    /// row 0 of the delivered frame for **both** `bottom_left_origin` values
    /// (`runtime.rs::native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels`).
    pub fn read_frame_into(&self, out: &mut Vec<u8>) {
        let fbo = self.fbo_lock();
        let (width, height) = (fbo.width, fbo.height);
        let len = width as usize * height as usize * 4;
        out.clear();
        out.resize(len, 0);
        unsafe {
            glBindFramebuffer(GL_FRAMEBUFFER, fbo.framebuffer);
            glReadPixels(
                0,
                0,
                width as GLsizei,
                height as GLsizei,
                GL_RGBA,
                GL_UNSIGNED_BYTE,
                out.as_mut_ptr() as *mut c_void,
            );
        }
        // glReadPixels delivered framebuffer-bottom-first rows; a
        // bottom-left-origin core drew the image bottom at framebuffer y=0,
        // so its readback is image-bottom-first and must be flipped to the
        // top-down order the frame pipe assumes. A top-left-origin core's
        // readback is already top-down. (See the method doc for the full
        // chain.)
        if self.request.bottom_left_origin {
            flip_rows_in_place(out, width as usize, height as usize, 4);
        }
    }

    /// Clears the FBO's color (and, if present, depth/stencil) buffers —
    /// exposed so a session that boots before the core's first real render
    /// (or the frame between `context_reset` and the first `retro_run`)
    /// presents black rather than uninitialized GPU memory.
    pub fn clear(&self) {
        unsafe {
            glBindFramebuffer(GL_FRAMEBUFFER, self.fbo_lock().framebuffer);
            glClearColor(0.0, 0.0, 0.0, 1.0);
            glClear(0x0000_4000 /* GL_COLOR_BUFFER_BIT */);
        }
    }
}

impl Drop for HwRenderContext {
    fn drop(&mut self) {
        // libretro contract: context_destroy fires before the context itself
        // goes away, mirroring context_reset's "after the context is ready"
        // pairing — the core gets one last chance to free its own GL
        // resources while the context is still current.
        if let Some(cb) = self.request.context_destroy {
            unsafe { cb() };
        }
    }
}

/// Row-order flip, extracted as a free function so it's unit-testable
/// without a live GL context (a real `glReadPixels` result can't be
/// constructed in a headless CI runner — see the module doc's "created only
/// on demand" note and this crate's established stub-core testing
/// convention for FFI-adjacent logic).
fn flip_rows_in_place(buf: &mut [u8], width: usize, height: usize, bytes_per_pixel: usize) {
    let row_bytes = width * bytes_per_pixel;
    if row_bytes == 0 || height < 2 {
        return;
    }
    let (mut top, mut bottom) = (0usize, height - 1);
    while top < bottom {
        let (top_start, bottom_start) = (top * row_bytes, bottom * row_bytes);
        // Two disjoint mutable slices of the same buffer via split_at_mut,
        // then a plain swap — no temporary row allocation.
        let (first, second) = buf.split_at_mut(bottom_start);
        first[top_start..top_start + row_bytes].swap_with_slice(&mut second[..row_bytes]);
        top += 1;
        bottom -= 1;
    }
}

/// Looks up `sym` in the process's already-loaded OpenGL framework via
/// `dlsym(RTLD_DEFAULT, ...)` — every libretro HW-render core resolves its GL
/// entry points this way (there is no separate "GL context proc table" on
/// desktop OpenGL/CGL the way there is on EGL), and Harmony links against
/// the system OpenGL framework transitively through the CGL calls in this
/// module, so every core symbol it needs is already resolvable.
#[cfg(target_os = "macos")]
fn gl_get_proc_address(sym: &str) -> Option<RetroProcAddressFn> {
    let Ok(cname) = CString::new(sym) else {
        return None;
    };
    // SAFETY: `RTLD_DEFAULT` searches every already-loaded image in the
    // process for `sym`; `dlsym` is safe to call with a valid, NUL-terminated
    // string and returns null (mapped to `None`) rather than a dangling
    // pointer for an unresolved symbol.
    let ptr = unsafe { libc::dlsym(libc::RTLD_DEFAULT, cname.as_ptr()) };
    if ptr.is_null() {
        None
    } else {
        // SAFETY: a non-null `dlsym` result for a GL entry point is a valid
        // C function pointer; libretro's `retro_proc_address_t` contract is
        // exactly "an opaque function pointer the core casts itself", which
        // is what `RetroProcAddressFn` (a bare `unsafe extern "C" fn()`)
        // represents.
        Some(unsafe { std::mem::transmute::<*mut c_void, RetroProcAddressFn>(ptr) })
    }
}

#[cfg(not(target_os = "macos"))]
fn gl_get_proc_address(_sym: &str) -> Option<RetroProcAddressFn> {
    None
}

// ---- CGL: the macOS windowless OpenGL context ----

#[cfg(target_os = "macos")]
mod cgl {
    use std::os::raw::{c_int, c_void};

    pub type CglPixelFormatObj = *mut c_void;
    pub type CglContextObj = *mut c_void;
    pub type CglError = i32;

    #[allow(non_snake_case)]
    #[link(name = "OpenGL", kind = "framework")]
    extern "C" {
        pub fn CGLChoosePixelFormat(
            attribs: *const c_int,
            pix: *mut CglPixelFormatObj,
            npix: *mut c_int,
        ) -> CglError;
        pub fn CGLDestroyPixelFormat(pix: CglPixelFormatObj) -> CglError;
        pub fn CGLCreateContext(
            pix: CglPixelFormatObj,
            share: CglContextObj,
            ctx: *mut CglContextObj,
        ) -> CglError;
        pub fn CGLDestroyContext(ctx: CglContextObj) -> CglError;
        pub fn CGLSetCurrentContext(ctx: CglContextObj) -> CglError;
    }

    // A curated subset of `CGLPixelFormatAttribute` — enough to request a
    // modern, hardware-accelerated, windowless (FBO-only) OpenGL context.
    pub const KCGL_PFA_ACCELERATED: c_int = 73;
    pub const KCGL_PFA_OPENGL_PROFILE: c_int = 99;
    pub const KCGL_OGL_PVERSION_GL3_CORE: c_int = 0x3200;
    pub const ATTRIBUTE_LIST_END: c_int = 0;
}

/// A CGL pixel format + context pair, made current on the calling thread.
/// `Drop` tears both down — never leaked across a session stop/restart (the
/// acceptance-mandated "unload cleanly so a second session can start").
#[cfg(target_os = "macos")]
struct CglContext {
    context: cgl::CglContextObj,
}

// SAFETY: `CglContextObj` is an opaque CGL handle (a raw pointer only ever
// dereferenced inside the CGL framework's own C code, never by Harmony) —
// moving the handle between threads is fine as long as CGL calls against it
// aren't made concurrently from two threads at once. Harmony upholds that:
// a `NativeRuntime` session's `HwRenderContext` (which owns this) is created,
// used, and dropped entirely on one core thread for the session's whole
// lifetime (see `HwRenderContext`'s own doc for the single-thread rationale
// the `Mutex<Fbo>` there shares); wrapping it in `Arc` is only to hand the
// same context to the process-global FFI callback slot on that same thread,
// never a second thread.
#[cfg(target_os = "macos")]
unsafe impl Send for CglContext {}
#[cfg(target_os = "macos")]
unsafe impl Sync for CglContext {}

#[cfg(target_os = "macos")]
impl CglContext {
    fn create() -> AppResult<Self> {
        use cgl::*;
        use std::os::raw::c_int;
        let attribs = [
            KCGL_PFA_ACCELERATED,
            KCGL_PFA_OPENGL_PROFILE,
            KCGL_OGL_PVERSION_GL3_CORE,
            ATTRIBUTE_LIST_END,
        ];
        let mut pixel_format: CglPixelFormatObj = std::ptr::null_mut();
        let mut num_formats: c_int = 0;
        // SAFETY: `attribs` is a valid, zero-terminated CGL attribute array
        // per the `CGLChoosePixelFormat` contract; `pixel_format`/
        // `num_formats` are valid out-params.
        let err = unsafe { CGLChoosePixelFormat(attribs.as_ptr(), &mut pixel_format, &mut num_formats) };
        if err != 0 || pixel_format.is_null() {
            return Err(AppError::Dependency(format!(
                "CGLChoosePixelFormat failed (error {err}); no OpenGL core-profile pixel format available"
            )));
        }
        let mut context: CglContextObj = std::ptr::null_mut();
        // SAFETY: `pixel_format` was just validated non-null above; `context`
        // is a valid out-param; sharing with `null` (no share group) is
        // explicitly allowed by the CGL contract.
        let err = unsafe { CGLCreateContext(pixel_format, std::ptr::null_mut(), &mut context) };
        unsafe { CGLDestroyPixelFormat(pixel_format) }; // no longer needed once the context exists
        if err != 0 || context.is_null() {
            return Err(AppError::Dependency(format!(
                "CGLCreateContext failed (error {err})"
            )));
        }
        Ok(CglContext { context })
    }

    fn make_current(&self) -> AppResult<()> {
        // SAFETY: `self.context` is a live context created by `Self::create`
        // and never destroyed before `Drop`.
        let err = unsafe { cgl::CGLSetCurrentContext(self.context) };
        if err != 0 {
            return Err(AppError::Internal(format!(
                "CGLSetCurrentContext failed (error {err})"
            )));
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
impl Drop for CglContext {
    fn drop(&mut self) {
        unsafe {
            // Clear the current context first so no thread-local reference
            // to a about-to-be-freed context lingers.
            let _ = cgl::CGLSetCurrentContext(std::ptr::null_mut());
            let _ = cgl::CGLDestroyContext(self.context);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flip_rows_reverses_row_order_for_a_multi_row_buffer() {
        // 2x3 RGBA (2 rows... use 3 rows x 1 col to keep it simple to eyeball).
        let mut buf: Vec<u8> = vec![
            1, 1, 1, 1, // row 0
            2, 2, 2, 2, // row 1
            3, 3, 3, 3, // row 2
        ];
        flip_rows_in_place(&mut buf, 1, 3, 4);
        assert_eq!(
            buf,
            vec![3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1],
            "row 0 and row 2 must swap; the middle row stays put"
        );
    }

    #[test]
    fn flip_rows_is_a_no_op_for_a_single_row() {
        let mut buf: Vec<u8> = vec![9, 9, 9, 9];
        let before = buf.clone();
        flip_rows_in_place(&mut buf, 1, 1, 4);
        assert_eq!(buf, before);
    }

    #[test]
    fn flip_rows_is_a_no_op_for_zero_height_or_width() {
        let mut buf: Vec<u8> = vec![];
        flip_rows_in_place(&mut buf, 0, 0, 4);
        assert!(buf.is_empty());
    }

    #[test]
    fn flip_rows_handles_an_even_row_count_with_no_middle_row() {
        let mut buf: Vec<u8> = vec![
            1, 1, // row 0 (2 bytes/pixel for brevity, width=1)
            2, 2, // row 1
            3, 3, // row 2
            4, 4, // row 3
        ];
        flip_rows_in_place(&mut buf, 1, 4, 2);
        assert_eq!(buf, vec![4, 4, 3, 3, 2, 2, 1, 1]);
    }

    #[test]
    fn hw_render_request_carries_flags_and_callbacks_through_construction() {
        unsafe extern "C" fn reset_cb() {}
        unsafe extern "C" fn destroy_cb() {}
        let request = HwRenderRequest {
            depth: true,
            stencil: false,
            bottom_left_origin: true,
            context_reset: Some(reset_cb),
            context_destroy: Some(destroy_cb),
        };
        assert!(request.depth);
        assert!(!request.stencil);
        assert!(request.bottom_left_origin);
        assert!(request.context_reset.is_some());
        assert!(request.context_destroy.is_some());
    }

    /// On macOS (this project's only target), a real headless CGL context +
    /// FBO comes up with no display server (CGL, unlike GLX/EGL, is fully
    /// windowless) — this is the equivalent proof point to `host.rs`'s
    /// stub-core lifecycle tests, but for the GL layer instead of the
    /// libretro FFI layer. Like every test below that touches a live CGL
    /// context, it is `#[ignore]`d behind the `RGP_LIVE_GL_TESTS` opt-in
    /// (see [`crate::play::native::require_live_gl_opt_in`]) so plain
    /// `cargo test` stays green on GL-less runners; the pure logic in this
    /// module (`flip_rows_in_place`, `HwRenderRequest`) stays un-ignored.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs a live CGL context — RGP_LIVE_GL_TESTS=1 cargo test -- --ignored"]
    fn hw_render_context_creates_and_reads_back_a_cleared_fbo() {
        crate::play::native::require_live_gl_opt_in();
        let request = HwRenderRequest {
            depth: false,
            stencil: false,
            bottom_left_origin: false,
            context_reset: None,
            context_destroy: None,
        };
        let ctx = HwRenderContext::create(4, 4, request).expect("headless CGL context + FBO");
        assert_ne!(ctx.current_framebuffer(), 0, "a real FBO id must be non-zero");
        ctx.clear();
        let mut out = Vec::new();
        ctx.read_frame_into(&mut out);
        assert_eq!(out.len(), 4 * 4 * 4);
        // Cleared to opaque black: RGB channels 0, alpha 255.
        assert!(out.chunks_exact(4).all(|px| px == [0, 0, 0, 255]));
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs a live CGL context — RGP_LIVE_GL_TESTS=1 cargo test -- --ignored"]
    fn hw_render_context_resize_changes_the_readback_dimensions() {
        crate::play::native::require_live_gl_opt_in();
        let request = HwRenderRequest {
            depth: true,
            stencil: true,
            bottom_left_origin: false,
            context_reset: None,
            context_destroy: None,
        };
        let ctx = HwRenderContext::create(4, 4, request).expect("context");
        ctx.resize(8, 6).expect("resize");
        ctx.clear();
        let mut out = Vec::new();
        ctx.read_frame_into(&mut out);
        assert_eq!(out.len(), 8 * 6 * 4);
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs a live CGL context — RGP_LIVE_GL_TESTS=1 cargo test -- --ignored"]
    fn hw_render_context_get_proc_address_resolves_a_real_gl_symbol() {
        crate::play::native::require_live_gl_opt_in();
        let request = HwRenderRequest {
            depth: false,
            stencil: false,
            bottom_left_origin: false,
            context_reset: None,
            context_destroy: None,
        };
        let ctx = HwRenderContext::create(2, 2, request).expect("context");
        assert!(
            ctx.get_proc_address("glGetString").is_some(),
            "a linked, always-present GL symbol must resolve"
        );
        assert!(
            ctx.get_proc_address("glThisFunctionDoesNotExist").is_none(),
            "an unresolvable symbol must answer None, not a dangling pointer"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs a live CGL context — RGP_LIVE_GL_TESTS=1 cargo test -- --ignored"]
    fn a_second_session_can_create_a_fresh_context_after_the_first_is_dropped() {
        crate::play::native::require_live_gl_opt_in();
        // The acceptance-mandated "unload cleanly so a second session can
        // start" — proven by literally doing it twice in a row.
        let request = HwRenderRequest {
            depth: false,
            stencil: false,
            bottom_left_origin: false,
            context_reset: None,
            context_destroy: None,
        };
        {
            let _first = HwRenderContext::create(2, 2, request).expect("first context");
        }
        let _second = HwRenderContext::create(2, 2, request).expect("second context after teardown");
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs a live CGL context — RGP_LIVE_GL_TESTS=1 cargo test -- --ignored"]
    fn context_destroy_is_called_exactly_once_on_drop() {
        crate::play::native::require_live_gl_opt_in();
        use std::sync::atomic::{AtomicUsize, Ordering};
        static DESTROY_CALLS: AtomicUsize = AtomicUsize::new(0);
        unsafe extern "C" fn destroy_cb() {
            DESTROY_CALLS.fetch_add(1, Ordering::SeqCst);
        }
        let request = HwRenderRequest {
            depth: false,
            stencil: false,
            bottom_left_origin: false,
            context_reset: None,
            context_destroy: Some(destroy_cb),
        };
        DESTROY_CALLS.store(0, Ordering::SeqCst);
        {
            let _ctx = HwRenderContext::create(2, 2, request).expect("context");
        }
        assert_eq!(DESTROY_CALLS.load(Ordering::SeqCst), 1);
    }
}
