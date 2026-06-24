//! Domain logic root (architecture-design.md §1.2). Pure, Tauri-free modules
//! the thin `commands/<domain>.rs` adapters call into. Each work item adds one
//! `pub mod <domain>;` line below; modules never cross-import another item's
//! domain, so this file merges by append.

// --- APPEND DOMAIN MODULES BELOW THIS LINE ---
pub mod cores; // W5 — libretro core management (buildbot client, arch check, system→core map, install)
