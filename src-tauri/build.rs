// Tauri build script: generates the context (config, icons, capabilities) the
// app embeds at compile time, then statically compiles the vendored rcheevos
// C library (W370 — see src-tauri/vendor/rcheevos/README.md) into the crate.
fn main() {
    build_rcheevos();
    tauri_build::build();
}

/// Compiles `vendor/rcheevos`'s ROM-hashing + trigger-evaluator sources
/// (see `vendor/rcheevos/README.md` for exactly which upstream files and why)
/// into a static library and links it into `retro_game_player_lib`. Static
/// link (not `libloading`) because rcheevos is a first-party dependency
/// compiled from source we vendor and control — unlike libretro cores, which
/// are third-party `.dylib`s discovered and `dlopen`ed at runtime (see
/// `src/play/native/host.rs`).
fn build_rcheevos() {
    let vendor_dir = "vendor/rcheevos";
    let include_dir = format!("{vendor_dir}/include");
    let src_dir = format!("{vendor_dir}/src");

    let sources = [
        "src/rc_compat.c",
        "src/rc_util.c",
        "src/rc_version.c",
        "src/rcheevos/alloc.c",
        "src/rcheevos/condition.c",
        "src/rcheevos/condset.c",
        "src/rcheevos/consoleinfo.c",
        "src/rcheevos/format.c",
        "src/rcheevos/lboard.c",
        "src/rcheevos/memref.c",
        "src/rcheevos/operand.c",
        "src/rcheevos/rc_validate.c",
        "src/rcheevos/richpresence.c",
        "src/rcheevos/runtime.c",
        "src/rcheevos/runtime_progress.c",
        "src/rcheevos/trigger.c",
        "src/rcheevos/value.c",
        "src/rhash/hash.c",
        "src/rhash/hash_rom.c",
        "src/rhash/md5.c",
    ];

    let mut build = cc::Build::new();
    build
        .include(&include_dir)
        .include(&src_dir)
        .std("c99")
        // Disc/zip/encrypted hashing sources are not vendored (out of scope
        // for NES/SNES, see vendor/rcheevos/README.md) — these macros stub
        // out the corresponding branches in rhash/hash.c at compile time.
        .define("RC_HASH_NO_DISC", None)
        .define("RC_HASH_NO_ZIP", None)
        .define("RC_HASH_NO_ENCRYPTED", None)
        // We build+link rcheevos directly into this binary, never as a
        // shared library the app loads at runtime.
        .define("RC_STATIC", None)
        .warnings(true);

    for source in sources {
        build.file(format!("{vendor_dir}/{source}"));
        println!("cargo:rerun-if-changed={source}", source = format!("{vendor_dir}/{source}"));
    }
    println!("cargo:rerun-if-changed={include_dir}");

    build.compile("rcheevos");
}
