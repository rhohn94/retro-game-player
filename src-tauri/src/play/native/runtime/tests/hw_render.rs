//! W345 acceptance ("readback throughput ... does not regress the frame
//! pipe" / "software-render systems are untouched"): an end-to-end proof
//! that a core negotiating `RETRO_ENVIRONMENT_SET_HW_RENDER` boots through
//! the exact same [`NativeRuntime::start`] entrypoint as every
//! software-rendered stub, and that its FBO-rendered frames arrive at
//! [`NativeRuntime::latest_frame`] as real, non-blank RGBA pixels. macOS-only
//! (HW-render negotiation is refused elsewhere).

#[cfg(target_os = "macos")]
use crate::play::native::runtime::NativeRuntime;
#[cfg(target_os = "macos")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

/// W345 acceptance ("readback throughput ... does not regress the frame
/// pipe" / "software-render systems are untouched"): an end-to-end proof
/// that a core negotiating `RETRO_ENVIRONMENT_SET_HW_RENDER` boots
/// through the exact same [`NativeRuntime::start`] entrypoint as every
/// software-rendered stub above, and that its FBO-rendered frames arrive
/// at [`NativeRuntime::latest_frame`] as real, non-blank RGBA pixels —
/// proving the whole chain (environment negotiation → CGL/FBO bring-up →
/// `context_reset` → the core drawing via real `glClearColor`/`glClear`
/// resolved through `get_proc_address` → the `RETRO_HW_FRAME_BUFFER_VALID`
/// sentinel → `glReadPixels` readback → the same frame slot every
/// software core uses) headlessly, with no bundled/copyrighted ROM or
/// real N64 core. macOS-only (HW-render negotiation is refused
/// elsewhere), matching this module's other `cfg(target_os = "macos")`
/// gates.
#[cfg(target_os = "macos")]
const STUB_HW_RENDER_CORE_C: &str = r#"
#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

struct retro_system_info {
    const char *library_name;
    const char *library_version;
    const char *valid_extensions;
    bool need_fullpath;
    bool block_extract;
};
struct retro_game_geometry { unsigned base_width, base_height, max_width, max_height; float aspect_ratio; };
struct retro_system_timing { double fps, sample_rate; };
struct retro_system_av_info { struct retro_game_geometry geometry; struct retro_system_timing timing; };
struct retro_game_info { const char *path; const void *data; size_t size; const char *meta; };

typedef bool (*retro_environment_t)(unsigned cmd, void *data);
typedef void (*retro_video_refresh_t)(const void *data, unsigned width, unsigned height, size_t pitch);
typedef size_t (*retro_audio_sample_batch_t)(const short *data, size_t frames);
typedef void (*retro_input_poll_t)(void);
typedef short (*retro_input_state_t)(unsigned port, unsigned device, unsigned index, unsigned id);

typedef void (*retro_hw_context_reset_t)(void);
typedef uintptr_t (*retro_hw_get_current_framebuffer_t)(void);
typedef void (*retro_proc_address_t)(void);
typedef retro_proc_address_t (*retro_hw_get_proc_address_t)(const char *sym);
struct retro_hw_render_callback {
    int context_type;
    retro_hw_context_reset_t context_reset;
    retro_hw_get_current_framebuffer_t get_current_framebuffer;
    retro_hw_get_proc_address_t get_proc_address;
    bool depth;
    bool stencil;
    bool bottom_left_origin;
    unsigned version_major;
    unsigned version_minor;
    bool cache_context;
    retro_hw_context_reset_t context_destroy;
    bool debug_context;
};

static retro_environment_t env_cb = 0;
static retro_video_refresh_t video_cb = 0;
static struct retro_hw_render_callback hw = {0};
static int context_reset_calls = 0;
static void (*glBindFramebuffer_p)(unsigned, unsigned) = 0;
static void (*glClearColor_p)(float, float, float, float) = 0;
static void (*glClear_p)(unsigned) = 0;
static void (*glScissor_p)(int, int, int, int) = 0;
static void (*glEnable_p)(unsigned) = 0;
static void (*glDisable_p)(unsigned) = 0;

static void on_context_reset(void) {
    context_reset_calls++;
    glBindFramebuffer_p = (void (*)(unsigned, unsigned)) hw.get_proc_address("glBindFramebuffer");
    glClearColor_p = (void (*)(float, float, float, float)) hw.get_proc_address("glClearColor");
    glClear_p = (void (*)(unsigned)) hw.get_proc_address("glClear");
    glScissor_p = (void (*)(int, int, int, int)) hw.get_proc_address("glScissor");
    glEnable_p = (void (*)(unsigned)) hw.get_proc_address("glEnable");
    glDisable_p = (void (*)(unsigned)) hw.get_proc_address("glDisable");
}

void retro_init(void) {
    hw.context_type = 3; /* RETRO_HW_CONTEXT_OPENGL_CORE */
    hw.context_reset = on_context_reset;
    hw.depth = false;
    hw.stencil = false;
    /* Baked in at compile time (0 or 1) so the harness proves the row-flip
     * decision for BOTH orientations a real core can declare. */
    hw.bottom_left_origin = STUB_BOTTOM_LEFT_ORIGIN;
    bool accepted = env_cb(14 /* RETRO_ENVIRONMENT_SET_HW_RENDER */, &hw);
    (void)accepted; /* the test asserts on real frame content, not this flag */
}
void retro_deinit(void) {}
unsigned retro_api_version(void) { return 1; }

void retro_get_system_info(struct retro_system_info *info) {
    info->library_name = "Stub HW-Render Core";
    info->library_version = "1.0";
    info->valid_extensions = "z64";
    info->need_fullpath = false;
    info->block_extract = false;
}

void retro_get_system_av_info(struct retro_system_av_info *info) {
    info->geometry.base_width = 4;
    info->geometry.base_height = 4;
    info->geometry.max_width = 4;
    info->geometry.max_height = 4;
    info->geometry.aspect_ratio = 4.0f / 3.0f;
    info->timing.fps = 60.0;
    info->timing.sample_rate = 44100.0;
}

void retro_set_environment(retro_environment_t cb) { env_cb = cb; }
void retro_set_video_refresh(retro_video_refresh_t cb) { video_cb = cb; }
void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) {}
void retro_set_input_poll(retro_input_poll_t cb) {}
void retro_set_input_state(retro_input_state_t cb) {}

bool retro_load_game(const struct retro_game_info *game) { return true; }
void retro_unload_game(void) {}

/* Draws an ASYMMETRIC two-band pattern into the FBO Harmony handed out via
 * get_current_framebuffer (a uniform clear could never catch a row-flip
 * bug): the whole target is cleared blue-ish, then a scissored second clear
 * paints the framebuffer's BOTTOM two rows (GL y = 0..2) red-ish. Which band
 * is the image's top depends on the declared bottom_left_origin — that is
 * exactly what the host's readback flip must sort out. The frame is then
 * reported via the RETRO_HW_FRAME_BUFFER_VALID sentinel rather than a real
 * pointer — exactly the libretro HW-render contract. */
void retro_run(void) {
    if (glBindFramebuffer_p && hw.get_current_framebuffer) {
        glBindFramebuffer_p(0x8D40 /* GL_FRAMEBUFFER */, (unsigned)hw.get_current_framebuffer());
    }
    if (glClearColor_p) glClearColor_p(0.2f, 0.6f, 1.0f, 1.0f); /* blue-ish */
    if (glClear_p) glClear_p(0x00004000 /* GL_COLOR_BUFFER_BIT */);
    if (glScissor_p && glEnable_p && glDisable_p) {
        glEnable_p(0x0C11 /* GL_SCISSOR_TEST */);
        glScissor_p(0, 0, 4, 2); /* the framebuffer's bottom two rows */
        glClearColor_p(1.0f, 0.2f, 0.2f, 1.0f); /* red-ish */
        glClear_p(0x00004000 /* GL_COLOR_BUFFER_BIT */);
        glDisable_p(0x0C11 /* GL_SCISSOR_TEST */);
    }
    if (video_cb) video_cb((const void *)(uintptr_t)(intptr_t)-1, 4, 4, 0);
}

size_t retro_serialize_size(void) { return 0; }
bool retro_serialize(void *data, size_t size) { return false; }
bool retro_unserialize(const void *data, size_t size) { return false; }
void *retro_get_memory_data(unsigned id) { return 0; }
size_t retro_get_memory_size(unsigned id) { return 0; }
"#;

/// Compiles [`STUB_HW_RENDER_CORE_C`] with `STUB_BOTTOM_LEFT_ORIGIN`
/// defined to `bottom_left_origin` (as 0/1), mirroring the cohort stub's
/// compile-time-define parameterization. `None` (skip, not fail) with no
/// C toolchain on `PATH`.
#[cfg(target_os = "macos")]
fn build_stub_hw_render_core(dir: &Path, bottom_left_origin: bool) -> Option<PathBuf> {
    let blo = u32::from(bottom_left_origin);
    let c_path = dir.join(format!("stub_hw_render_core_{blo}.c"));
    std::fs::write(&c_path, STUB_HW_RENDER_CORE_C).ok()?;
    let dylib_path = dir.join(format!("stub_hw_render_core_{blo}.dylib"));
    let status = Command::new("cc")
        .arg("-dynamiclib")
        .arg(format!("-DSTUB_BOTTOM_LEFT_ORIGIN={blo}"))
        .arg("-o")
        .arg(&dylib_path)
        .arg(&c_path)
        .status()
        .ok()?;
    status.success().then_some(dylib_path)
}

/// The stub's blue-ish full clear, (0.2, 0.6, 1.0, 1.0) ≈ [51, 153, 255,
/// 255] in RGBA8888, with tolerance for renderer rounding.
#[cfg(target_os = "macos")]
fn is_stub_blue(px: &[u8]) -> bool {
    (45..=57).contains(&px[0]) && (147..=159).contains(&px[1]) && px[2] >= 250 && px[3] == 255
}

/// The stub's red-ish scissored clear, (1.0, 0.2, 0.2, 1.0) ≈ [255, 51,
/// 51, 255] in RGBA8888, with tolerance for renderer rounding.
#[cfg(target_os = "macos")]
fn is_stub_red(px: &[u8]) -> bool {
    px[0] >= 250 && (45..=57).contains(&px[1]) && (45..=57).contains(&px[2]) && px[3] == 255
}

/// A single-pixel-band classifier (`is_stub_blue`/`is_stub_red`) — factored
/// out of the `(top_ok, bottom_ok)` pair's inline type below to clear
/// clippy's `type_complexity` lint (W383).
#[cfg(target_os = "macos")]
type BandClassifier = fn(&[u8]) -> bool;

/// Parameterized over BOTH `bottom_left_origin` values so the readback
/// row-flip decision (`hw_render::HwRenderContext::read_frame_into`) is
/// proven end-to-end, not just via `flip_rows_in_place`'s pure unit
/// tests: the stub draws an asymmetric pattern (red band at the
/// framebuffer's bottom two GL rows, blue elsewhere), so the delivered
/// frame's row 0 tells us exactly which orientation the host handed the
/// frame pipe. A `bottom_left_origin = true` core drew the image's
/// bottom at GL y=0, so a top-down consumer must see row 0 = blue (the
/// image top); a `false` core drew the image's top at GL y=0, so row 0 =
/// red. A uniform clear (the pre-fix fixture) could never catch a flip
/// bug — this pattern fails for either inversion of the flip condition.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "needs a live CGL context — RGP_LIVE_GL_TESTS=1 cargo test -- --ignored"]
fn native_runtime_hosts_a_hw_render_core_and_reads_back_real_gpu_pixels() {
    crate::play::native::require_live_gl_opt_in();
    for bottom_left_origin in [false, true] {
        let _guard = crate::play::native::lock_tests();
        let dir = tempfile::tempdir().expect("tempdir");
        let Some(dylib) = build_stub_hw_render_core(dir.path(), bottom_left_origin) else {
            eprintln!("skipping: no C toolchain on PATH");
            return;
        };
        let rom_path = dir.path().join("game.z64");
        std::fs::write(&rom_path, [0u8; 16]).expect("write stub rom");

        let runtime =
            NativeRuntime::start(&dylib, &rom_path, None, None).expect("runtime starts");

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut first_frame = None;
        while Instant::now() < deadline {
            if let Some((seq, frame)) = runtime.latest_frame() {
                first_frame = Some((seq, frame));
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let (_seq, frame) = first_frame.unwrap_or_else(|| {
            panic!(
                "bottom_left_origin={bottom_left_origin}: a real HW-rendered frame \
                 must be produced within the deadline"
            )
        });

        assert_eq!((frame.width, frame.height), (4, 4));
        assert_eq!(frame.data.len(), 4 * 4 * 4);
        // Every pixel must be one of the stub's two known band colors —
        // real, non-blank GPU-rendered content (not a stale/zeroed
        // buffer) reached the frame pipe.
        for px in frame.data.chunks_exact(4) {
            assert!(
                is_stub_blue(px) || is_stub_red(px),
                "bottom_left_origin={bottom_left_origin}: unexpected pixel {px:?}, \
                 expected ~[51, 153, 255, 255] or ~[255, 51, 51, 255]"
            );
        }
        // Orientation: the delivered buffer must be top-down. The image's
        // top band is blue for a bottom-left-origin core (its GL-y=0 red
        // band is the image bottom) and red for a top-left-origin core.
        let row = |i: usize| &frame.data[i * 4 * 4..(i + 1) * 4 * 4];
        let (top_ok, bottom_ok): (BandClassifier, BandClassifier) =
            if bottom_left_origin {
                (is_stub_blue, is_stub_red)
            } else {
                (is_stub_red, is_stub_blue)
            };
        assert!(
            row(0).chunks_exact(4).all(top_ok) && row(1).chunks_exact(4).all(top_ok),
            "bottom_left_origin={bottom_left_origin}: delivered rows 0-1 have the wrong \
             band color — the readback row-flip is wrong for this orientation \
             (rows: {:?})",
            frame.data
        );
        assert!(
            row(2).chunks_exact(4).all(bottom_ok) && row(3).chunks_exact(4).all(bottom_ok),
            "bottom_left_origin={bottom_left_origin}: delivered rows 2-3 have the wrong \
             band color — the readback row-flip is wrong for this orientation \
             (rows: {:?})",
            frame.data
        );

        drop(runtime); // stops + joins both threads; context_destroy fires
    }
}
