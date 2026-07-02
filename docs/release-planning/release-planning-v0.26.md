# Release Planning — v0.26

> status: draft
> Companion to `version-design.md` and `version-history.md`. Captures
> the scope, pass structure, and implementation ledger for v0.26.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.26` |
| **Previous** | v0.25.1 (Scout + Aura Dependency Channel hotfix) |
| **Theme** | "Theater" — the couch release: the entire 10-foot TV epic (#8–#13) lands in one pass (leanback shell, art-forward shelves, distance-legible controller navigation, seamless game transitions, auto-enter on startup), on a new library-life data foundation, alongside controller completion (#20 + Xbox/PS4/PS5 compat) and the product rename to **Retro Game Player**. |

User directive of record (2026-07-02): TV mode is critically important to the
core mission — state-of-the-art TV GUI, beautiful styling, fluid animations,
high-resolution artwork, seamless transitions, optional auto-enter at startup,
retro aesthetics within the Aura design philosophy. Merge/push/release/ticket
closure explicitly authorized for this session.

---

## 2. Major Features

### W269 — Rename & branding → Retro Game Player

Rename the product from "Harmony" across user-visible and internal surfaces:
`tauri.conf.json` (productName, window title, identifier →
`com.retro-game-player.app` **with an in-place app-data migration** moving
`$APPDATA` from the old identifier dir on first launch), `package.json`,
`Cargo.toml` (crate `retro_game_player_lib`), `index.html`, sidebar header,
localStorage keys (with value migration), README/docs sweep, CSS
token/class codemod `--harmony-*` → `--rgp-*` / `.harmony-*` → `.rgp-*`
(guard tests updated). GitHub repo rename happens at the push stage
(master's job), not in this branch.

- **Acceptance:** app builds + launches under the new name; existing user
  data (DB, art-cache, config) survives via the migration (unit test on the
  move logic); no stray "Harmony" in user-visible strings (`git grep`
  sweep documented in the branch); all guards green.
- **Branch:** `feat/w269-rename-rgp` · **Design:** app-infrastructure-design.md (§rename note added by branch)

### W264 — Library-life data foundation (subset of #21)

Schema + hooks + IPC for favorites, recently-played, play-count, play-time
across all three play paths; detail-page favorite toggle.

- **Acceptance:** per [library-life-design.md](../design/library-life-design.md) §Acceptance.
- **Branch:** `feat/w264-library-life` · **Design:** library-life-design.md

### W267 — Controller remapping UI (#20)

Replace the ControllersPane stub with a real press-to-rebind editor: per
device family, table of semantic actions → bound button with live "press a
button" capture, persist via existing `controller_bindings` IPC,
reset-to-defaults, conflict handling (button already bound → swap/clear).

- **Acceptance:** rebinding any action takes effect live in nav without
  restart; persists across restart; reset restores family defaults; pure
  capture/merge logic unit-tested; pane fully controller-navigable itself.
- **Branch:** `feat/w267-remap-ui` · **Design:** controller-input-design.md (§remap UI extension)

### W268 — Controller compatibility: Xbox / PS4 / PS5 on macOS

Audit + harden `detectFamily` and mappings: DualShock 4 ("Wireless
Controller", vendor 054c) and DualSense id-string detection, Xbox variants,
non-standard `mapping !== "standard"` fallback behavior, PS-family glyphs,
axis/dpad handling differences; close any non-controller-navigable surface
(SearchPage noted as stub). Document the compat matrix.

- **Acceptance:** id-detection table covers Xbox (wired/BT), DualShock 4,
  DualSense, 8BitDo, Switch Pro with unit tests per id string; nav works from
  every route including Search; compat matrix added to
  controller-input-design.md; degraded (non-standard mapping) path logs a
  visible hint rather than dead input.
- **Branch:** `feat/w268-controller-compat` · **Design:** controller-input-design.md (§compat matrix)

### W263 — High-resolution + full-bleed artwork (#12, #13)

Fetch and cache full-resolution art tiers (boxart + title + snap) rather than
single-tier boxart; expose tier selection in the art IPC/DTO; full-bleed,
unblurred hero art path for TV/detail surfaces (the pre-blurred vibrancy hero
stays for desktop); graceful fallback order snap → title → boxart → blur.

- **Acceptance:** art cache stores per-tier files; hero surfaces render
  full-bleed unblurred art at native resolution; fallback order unit-tested;
  existing desktop tiles unchanged; fixture/mocks updated.
- **Branch:** `feat/w263-hires-art` · **Design:** metadata-art-design.md (§high-res tiers extension)

### W260 — TV shell: leanback layout + enter/exit + auto-start

`src/features/tv/` mode provider + TV shell (sidebar hidden, TV-safe margins,
10-foot `*-tv` token scale), enter/exit via sidebar button / Cmd+T /
controller `menu` long-press, fullscreen coupling, `auto_tv_mode` AppConfig
flag + Settings toggle + startup wiring.

- **Acceptance:** per [tv-mode-design.md](../design/tv-mode-design.md)
  §Acceptance bullets 1, 2, 7 (mode entry/exit, auto-enter, token guards).
- **Branch:** `feat/w260-tv-shell` · **Design:** tv-mode-design.md

### W261 — TV home: shelves + key-art hero (#10)

`TvHome` with hero region + rails (Continue playing / Favorites / Recently
added / per-console), windowed rail rendering, per-rail focus memory,
hero crossfade on focus settle, retro-but-Aura flourishes.

- **Acceptance:** tv-mode-design.md §Acceptance bullets 3, 4 (shelves
  populated, fully controller-navigable); hero crossfades from high-res art.
- **Branch:** `feat/w261-tv-home` · **Design:** tv-mode-design.md

### W262 — Distance-legible focus + snap navigation (#11)

Enlarged TV focus treatment (scale ≥1.08, high-contrast ring, glow),
scroll-snap rails keeping focus fully visible, focus-settle animation via
motion tokens; applies to TV surfaces without regressing desktop focus.

- **Acceptance:** tv-mode-design.md §Acceptance bullet 5; desktop focus
  visuals unchanged (visual-inspect on desktop routes); motion guard green.
- **Branch:** `feat/w262-tv-focus` · **Design:** tv-mode-design.md

### W265 — Seamless game entry/exit transitions

Tile → fullscreen takeover animation (player boots under the expanding art;
boot sound intact, no play gate), reverse transition on exit restoring rail +
tile position; consistent takeover chrome on native/external paths.

- **Acceptance:** tv-mode-design.md §Acceptance bullet 6; in-page auto-boot
  with sound verified (no mute, no manual gate — standing product intent);
  reduced-motion path is a plain crossfade.
- **Branch:** `feat/w265-tv-transitions` · **Design:** tv-mode-design.md

### W26A — TV polish + runtime verification

Integrated quality pass after all TV branches land: run the app, capture TV
routes in the visual-inspection harness, fix visual jank (spacing, scrim
legibility, animation timing), verify `recipe.py smoke` incl. TV routes, and
extend the inspection script to cover TV home + takeover so a broken TV GUI
fails smoke from now on.

- **Acceptance:** smoke exits 0 with TV routes asserted; screenshots of TV
  home/detail/takeover attached to the branch; no console errors on TV
  surfaces; tv-mode-design.md §Acceptance fully checked off.
- **Branch:** `feat/w26a-tv-polish` · **Design:** tv-mode-design.md

---

## 3. Parallel Implementation Strategy

| Phase | Items | Rationale |
|---|---|---|
| 1 | W269 (solo) | Whole-repo mechanical sweep (rename); everything later builds on the new names. |
| 2 | W264 ∥ W267 ∥ W268 ∥ W263 | Disjoint areas: DB/play-stats vs settings pane vs controller mapping vs art pipeline. |
| 3 | W260 (solo) | Creates `src/features/tv/` structure + tokens all later TV work extends. |
| 4 | W261 (solo) | The TV home centerpiece; consumes W264 data + W263 art + W260 shell. |
| 5 | W262 ∥ W265 | Focus/snap (spatial + tv CSS) vs transitions (play + takeover) — minor shared edges in TvShell accepted; merge order W262 → W265. |
| 6 | W26A (solo) | Integrated polish on the assembled result. |

**Conflict map:** W269 touches everything (hence solo, first). Phase 2
overlap points: W264/W267 both touch IPC barrel exports (accepted, trivial);
W268/W267 both touch `src/features/controller/` — W267 is confined to the
settings pane + bindings IPC, W268 to `actions.ts`/`useGamepadPoll.ts`/glyphs.
Phase 5 overlap: both may touch `TvShell.tsx`/`tv.css` — merge W262 first.
Merge order within each phase = listed order. Every branch roots on
`version/0.26`.

---

## 4. Out of Scope for v0.26

- **Collections + curation UI** (rest of #21) — future release.
- **CRT/scanline display filters over gameplay** (#23) — v0.29 Craft (the
  TV hero's static scanline *texture* accent is in scope; live gameplay
  filters are not).
- **Keyboard accessibility completion** (#29) — v0.29.
- **Notarized DMG** (#27) — v0.30 Passport.
- **Metadata enrichment (ScreenScraper/Familiar)** (#24) — backlog.
- **Decompressed-core caching** (#31) — backlog.
- **Windows/Linux, netplay, RetroAchievements** — backlog (standing).

No open `Grimoire-Requirement` issues exist (tracker checked this pass —
zero results), so no framework-required scope is trimmed here.

---

## 5. Status Ledger

### Phase 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.26 |
|---|---|---|---|---|
| `feat/w269-rename-rgp` (W269) | ☐ | ☐ | ☐ | ☐ |

### Phase 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.26 |
|---|---|---|---|---|
| `feat/w264-library-life` (W264) | ☑ | ☐ | ☐ | ☐ |
| `feat/w267-remap-ui` (W267) | ☐ | ☐ | ☐ | ☐ |
| `feat/w268-controller-compat` (W268) | ☐ | ☐ | ☐ | ☐ |
| `feat/w263-hires-art` (W263) | ☐ | ☐ | ☐ | ☐ |

### Phase 3

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.26 |
|---|---|---|---|---|
| `feat/w260-tv-shell` (W260) | ☑ | ☐ | ☐ | ☐ |

### Phase 4

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.26 |
|---|---|---|---|---|
| `feat/w261-tv-home` (W261) | ☑ | ☐ | ☐ | ☐ |

### Phase 5

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.26 |
|---|---|---|---|---|
| `feat/w262-tv-focus` (W262) | ☑ | ☐ | ☐ | ☐ |
| `feat/w265-tv-transitions` (W265) | ☑ | ☐ | ☐ | ☐ |

### Phase 6

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.26 |
|---|---|---|---|---|
| `feat/w26a-tv-polish` (W26A) | ☑ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

(populated as branches land)
