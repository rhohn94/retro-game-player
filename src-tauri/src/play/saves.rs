//! On-disk save persistence shared by both play paths (v0.23 "Continuity",
//! W230/W231) — one layout under `<app-support>/saves/` for battery SRAM and
//! slot save-states, written atomically, with slot metadata in a sidecar
//! JSON. `.srm` files are raw `RETRO_MEMORY_SAVE_RAM` bytes (cross-path and
//! RetroArch-convention compatible); `.state*` blobs are **path-tagged** in
//! the metadata because a native `retro_serialize` blob and an EmulatorJS
//! state are not interchangeable. Design:
//! docs/design/save-persistence-design.md.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The auto slot written on session exit (backs the "Continue" affordance).
pub const AUTO_SLOT: &str = "auto";

/// Manual slots the overlay exposes (W232).
pub const MANUAL_SLOTS: [&str; 4] = ["1", "2", "3", "4"];

/// Which play path produced a state blob. `.srm` SRAM is path-agnostic;
/// states are only loadable by the path that wrote them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayPath {
    Native,
    Ejs,
}

/// One recorded state slot, as stored in `<stem>.saves.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotMeta {
    pub slot: String,
    pub play_path: PlayPath,
    /// Unix seconds.
    pub created_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct SavesMeta {
    slots: Vec<SlotMeta>,
}

/// Path-and-IO layer for one game's saves: `<root>/<system>/<stem>.*`.
/// `root` is `Paths::saves_dir()` in production, a tempdir in tests.
#[derive(Debug, Clone)]
pub struct GameSaves {
    dir: PathBuf,
    stem: String,
}

/// The ROM's filename stem — RetroArch's convention for save naming, so
/// users can migrate `.srm` files in either direction.
pub fn rom_stem(rom_path: &Path) -> String {
    rom_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".into())
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Writes atomically: temp file in the same dir, then rename — a crash
/// mid-write can never leave a truncated save in place.
fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::Internal(format!("save path has no parent: {path:?}")))?;
    fs::create_dir_all(dir).map_err(|e| AppError::Io(format!("create {dir:?}: {e}")))?;
    let tmp = path.with_extension("tmp-write");
    fs::write(&tmp, bytes).map_err(|e| AppError::Io(format!("write {tmp:?}: {e}")))?;
    fs::rename(&tmp, path).map_err(|e| AppError::Io(format!("rename to {path:?}: {e}")))?;
    Ok(())
}

impl GameSaves {
    /// `root` = the `saves/` dir; `system` = the game's system key;
    /// `rom_path` = the library row's ROM path (stem taken per RetroArch
    /// convention).
    pub fn new(root: &Path, system: &str, rom_path: &Path) -> Self {
        GameSaves {
            dir: root.join(system),
            stem: rom_stem(rom_path),
        }
    }

    fn file(&self, ext: &str) -> PathBuf {
        self.dir.join(format!("{}.{ext}", self.stem))
    }

    pub fn sram_path(&self) -> PathBuf {
        self.file("srm")
    }

    fn state_path(&self, slot: &str) -> PathBuf {
        if slot == AUTO_SLOT {
            self.file("state.auto")
        } else {
            self.file(&format!("state{slot}"))
        }
    }

    fn meta_path(&self) -> PathBuf {
        self.file("saves.json")
    }

    /// Validates a slot name from IPC ("1".."4" or "auto").
    pub fn validate_slot(slot: &str) -> AppResult<()> {
        if slot == AUTO_SLOT || MANUAL_SLOTS.contains(&slot) {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "unknown save slot {slot:?} (expected 1-4 or auto)"
            )))
        }
    }

    pub fn read_sram(&self) -> Option<Vec<u8>> {
        fs::read(self.sram_path()).ok()
    }

    pub fn write_sram(&self, bytes: &[u8]) -> AppResult<()> {
        atomic_write(&self.sram_path(), bytes)
    }

    pub fn read_state(&self, slot: &str) -> AppResult<Vec<u8>> {
        Self::validate_slot(slot)?;
        fs::read(self.state_path(slot))
            .map_err(|e| AppError::Io(format!("no save in slot {slot}: {e}")))
    }

    /// Writes a state blob and records/updates its slot metadata.
    pub fn write_state(&self, slot: &str, bytes: &[u8], path: PlayPath) -> AppResult<()> {
        Self::validate_slot(slot)?;
        atomic_write(&self.state_path(slot), bytes)?;
        let mut meta = self.read_meta();
        meta.slots.retain(|s| s.slot != slot);
        meta.slots.push(SlotMeta {
            slot: slot.to_string(),
            play_path: path,
            created_at: now_unix(),
        });
        meta.slots.sort_by(|a, b| a.slot.cmp(&b.slot));
        let json = serde_json::to_vec_pretty(&meta)
            .map_err(|e| AppError::Internal(format!("serialize saves meta: {e}")))?;
        atomic_write(&self.meta_path(), &json)
    }

    fn read_meta(&self) -> SavesMeta {
        fs::read(self.meta_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    /// Everything the detail page / overlay needs to render save affordances:
    /// whether battery SRAM exists, and each recorded state slot. Slots whose
    /// blob file has vanished (user deleted it) are filtered out.
    pub fn list(&self) -> (bool, Vec<SlotMeta>) {
        let has_sram = self.sram_path().is_file();
        let slots = self
            .read_meta()
            .slots
            .into_iter()
            .filter(|s| self.state_path(&s.slot).is_file())
            .collect();
        (has_sram, slots)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saves(dir: &Path) -> GameSaves {
        GameSaves::new(dir, "nes", Path::new("/roms/Zelda (USA) (Rev 1).nes"))
    }

    #[test]
    fn layout_follows_the_retroarch_stem_convention() {
        let g = saves(Path::new("/saves-root"));
        assert_eq!(
            g.sram_path(),
            Path::new("/saves-root/nes/Zelda (USA) (Rev 1).srm")
        );
        assert_eq!(
            g.state_path("2"),
            Path::new("/saves-root/nes/Zelda (USA) (Rev 1).state2")
        );
        assert_eq!(
            g.state_path(AUTO_SLOT),
            Path::new("/saves-root/nes/Zelda (USA) (Rev 1).state.auto")
        );
    }

    #[test]
    fn sram_round_trips() {
        let dir = tempfile::tempdir().expect("tempdir");
        let g = saves(dir.path());
        assert!(g.read_sram().is_none());
        g.write_sram(&[9, 8, 7]).expect("write");
        assert_eq!(g.read_sram().expect("read"), vec![9, 8, 7]);
    }

    #[test]
    fn state_round_trips_and_records_metadata() {
        let dir = tempfile::tempdir().expect("tempdir");
        let g = saves(dir.path());
        g.write_state("1", &[1, 2, 3], PlayPath::Native).expect("write");
        assert_eq!(g.read_state("1").expect("read"), vec![1, 2, 3]);
        let (has_sram, slots) = g.list();
        assert!(!has_sram);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].slot, "1");
        assert_eq!(slots[0].play_path, PlayPath::Native);
        assert!(slots[0].created_at > 0);
    }

    #[test]
    fn rewriting_a_slot_replaces_its_metadata_row() {
        let dir = tempfile::tempdir().expect("tempdir");
        let g = saves(dir.path());
        g.write_state("1", &[1], PlayPath::Native).expect("write 1");
        g.write_state("1", &[2], PlayPath::Ejs).expect("write 2");
        let (_, slots) = g.list();
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].play_path, PlayPath::Ejs);
    }

    #[test]
    fn list_drops_slots_whose_blob_was_deleted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let g = saves(dir.path());
        g.write_state("3", &[1], PlayPath::Native).expect("write");
        std::fs::remove_file(g.state_path("3")).expect("delete blob");
        let (_, slots) = g.list();
        assert!(slots.is_empty());
    }

    #[test]
    fn unknown_slot_names_are_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let g = saves(dir.path());
        assert!(g.read_state("9").is_err());
        assert!(g.write_state("../evil", &[1], PlayPath::Native).is_err());
    }

    #[test]
    fn reading_an_empty_slot_is_an_io_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let g = saves(dir.path());
        assert!(matches!(g.read_state("1"), Err(AppError::Io(_))));
    }
}
