//! Library identification domain (W6). Pure, testable pieces — one file each:
//!
//!   - [`ines`]       — iNES header detection + stripping for NES ROMs.
//!   - [`hasher`]     — CRC32 + MD5 over header-stripped ROM bytes.
//!   - [`walker`]     — recursive content-folder walk yielding candidate ROM files.
//!   - [`dat`]        — No-Intro Logiqx-XML DAT parser + CRC/SHA1 index.
//!   - [`matcher`]    — DAT lookup → clean No-Intro game name.
//!   - [`mapper`]     — file extension → system → suggested core mapping.
//!   - [`disc_ident`] — content-sniffing identification for ambiguous disc
//!     containers (`.cue`/`.chd`/`.bin`) that `mapper` cannot resolve by
//!     extension alone (W343).
//!   - [`scan`]       — orchestration glue binding the above into a folder scan.
//!
//! No magic numbers: system ids, extensions, the iNES magic, and core hints are
//! named constants in [`mapper`] / [`ines`]. The orchestration ([`scan`]) is the
//! only piece that touches the DB repo; everything else is pure.

pub mod dat;
pub mod disc_ident;
pub mod hasher;
pub mod import;
pub mod ines;
pub mod mapper;
pub mod matcher;
pub mod scan;
pub mod walker;

pub use dat::{DatEntry, DatIndex};
pub use disc_ident::{sniff_disc_image, DiscIdentification, SYSTEM_PS1};
pub use hasher::RomHashes;
pub use import::{import_file, ImportOutcome};
pub use mapper::{SystemMapping, SYSTEM_NES, SYSTEM_SNES, SYSTEM_N64};
pub use matcher::{MatchOutcome, Matcher};
pub use scan::{scan_folder_path, ScanReport};
