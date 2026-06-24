//! Domain logic root (architecture-design.md §1.2). Pure, Tauri-free modules
//! the thin `commands/<domain>.rs` adapters call into. Each work item adds one
//! `pub mod <domain>;` line below; modules never cross-import another item's
//! domain, so this file merges by append. (Fleet lives in `src/fleet/`, not here.)

// --- APPEND DOMAIN MODULES BELOW THIS LINE ---
pub mod cores; // W5 — libretro core management (buildbot client, arch check, system→core map, install)
pub mod library; // W6 — folder walk, ROM hashing, DAT parse/match, system mapping
pub mod launch; // W7 — RetroArch locate + arg builder + shell-out
pub mod metadata; // W8 — libretro-thumbnails CDN client, name sanitizer, art cache
pub mod search; // W9 — user-supplied file-search providers (links only)
pub mod vibrancy; // W10 — pre-blurred hero pipeline + cache
pub mod familiar; // W12 — Familiar soft-dependency enrichment client
