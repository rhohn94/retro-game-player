# Release Planning — v0.28 "Living Room"

> status: agreed
> User-directed TV-mode refinement release (2026-07-03). Archive into
> `version-history.md` when it ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.28.0` |
| **Previous** | v0.27.1 (EJS audio-warmup hotfix) |
| **Theme** | The whole app from the couch. Two user directives (2026-07-03): **(a)** *"The banner is too big. Let's cut it down. Game thumbnails are chopped top and bottom. Game thumbnails should never be chopped. It is okay to draw them on top of the banner. Shrink them so that at least 5 games are visible at a time."* **(b)** *"Support hitting 'Select' (outside of games) or Playstation Touchpad to open a menu for navigating to other screens in the app, such as the Console database and Settings page. All pages and features should be accessible in TV mode."* |

**Version-number note:** the roadmap previously recorded "v0.28 stays retired"
(after the original v0.28 "Marquee" scope was absorbed into v0.26 Theater).
This release **un-retires the number for a new scope** — same precedent as
v0.27 Immersion reusing its number — keeping the version line dense. The
roadmap note is updated at release time.

---

## 2. Major Features

### W277 — TV shelf aesthetics: smaller banner, unchopped tiles, ≥5 visible

Today (measured at 1920×1080 fullscreen): the hero band is pinned at
`--rgp-tv-hero-height: 42vh` (~454px), tiles are a fixed 320×440
(`tv.css`), and per-side rail insets (safe-area 5vmin + derived focus
clearance ≈ 116px) leave ~1688px of row width → **~4.8 tiles visible** and a
rails region too short for a full tile → **tiles clipped top and bottom**,
exactly as the user reported.

Contract (all sizes stay token-driven in `src/theme/tv.css`; the
token-adoption guard applies; `rails.ts` windowing is count-based so no JS
mirror changes):

1. **Cut the banner down.** `--rgp-tv-hero-height` drops to **~26vh**
   (agent tunes ±2vh for copy fit). Hero copy (title/subtitle/chips/play)
   must still fit the shorter band without clipping — step hero paddings or
   the hero-title token down if needed, tokens only.
2. **Tiles are never chopped.** The focused rail's tiles render **fully** —
   frame + caption + focus ring/glow unclipped against every edge (the W262
   clearance system must keep working at the new sizes).
3. **≥5 tiles fully visible per rail** at 1920×1080 (and verify at the dev
   machine's own fullscreen viewport). Make tile size **responsive**
   (viewport-derived `min(320px, calc(...))`-style width with height via the
   existing 320:440 aspect), not a new hardcoded pair. ⚠ Circularity trap:
   `--rgp-tv-focus-clearance` derives from tile height; if tile width derives
   from clearance you get a var cycle — derive the clearance from the 320×440
   **cap** (a documented conservative constant) or restructure, but no
   circular `var()` chains.
4. **Overlap is allowed.** The user explicitly authorized drawing tiles on
   top of the banner: the rails region may overlap the hero's lower band
   (hero as backdrop), which is how the vertical budget closes at 1080p.
5. Desktop surfaces untouched; reduced-motion and guard suites stay green.

**Acceptance:** at 1920×1080 the TV home shows the shorter hero, ≥5 fully
visible unchopped tiles on the focused rail (incl. focused scale+ring+glow),
`recipe.py smoke` green with the `tv-home` visual-inspect screenshot
reflecting the new layout; guards (token-adoption, motion, aura-wiring)
green. — **Branch:** `feat/w277-tv-shelf-aesthetics`

### W278 — TV system menu (Select / PS touchpad) + every page reachable in TV mode

**Trigger.** The `quit` semantic action is bound to Select (button 8) and
consumed nowhere today (`glyphs.ts` label only) — it becomes the **system
menu** action in TV mode. PlayStation-family pads additionally trigger it
with the **touchpad click (standard-mapping button 17)** — add a named
`STANDARD_BUTTON.touchpad` and a per-family aux-binding seam in `actions.ts`
(unit-tested; `risingActions` honors it). Persisted rebind overrides keyed
`"quit"` must keep working (keep the action name, or migrate the stored
rows — no silent orphaning). The trigger is a **raw-poll rising-edge hook**
mirroring `useLongPress` (same resolved bindings + overrides), so it works
regardless of who holds the exclusive claim, gated on: TV mode active,
**no gameplay claim** (`gameplayClaimActive` — "outside of games", per the
user), no takeover surface mounted (`launched === null`, so the external
surface keeps sole ownership), and window focused.

**Menu.** A 10-foot overlay panel (new `TvSystemMenu` component +
`--rgp-tv-*` tokens) listing: **TV Home · Consoles · Search · Cores ·
Settings · Exit TV mode**. While open it claims `"ui"` on the exclusive
stack (above TvHome's claim): `nav_up`/`nav_down` move, `confirm`
activates, `back`/Select-again close. Opening the menu cancels an armed
exit-confirm and suppresses/tears down the W273 attract dwell + preview
(same gating family as `exitConfirm.confirming`). Pointer parity: a visible
**☰ Menu** button in the TvShell header (like the existing exit button).
HintBar/glyph surfaces gain the Select/touchpad hint where hints render.

**Every page in TV mode.** Choosing a destination renders the existing
desktop screen **inside the TvShell outlet** (TV mode stays active,
fullscreen): the outlet swaps `TvHome` ↔ an embedded screen region driven by
the real router (`HARMONY_ROUTES` — deep links like `/console/:key` and
`/game/:id` must work from within, so Consoles → detail → play all function).
Desktop screens are already fully controller-navigable via the base spatial
engine; `TvHome`'s unmount releases its exclusive claim automatically, so
the embedded screen's focus registry just works. Apply a **uniform 10-foot
scale-up** to the embedded region (CSS `zoom` token or rem-scale wrapper —
one knob, not per-screen restyling). `back` at an embedded screen's top
level (and the menu's TV Home entry) returns to the TV home. The W260 exit
snapshot contract is preserved: exiting TV mode still restores the
**pre-enter** desktop route; in-TV navigation must not corrupt it.

**Known-honest v1 edges (record, don't solve):** embedded game-detail play
uses the desktop-style in-page player inside the outlet (with sound — the
auto-boot contract holds) rather than the TV takeover; routing embedded
launches through the takeover is a recorded follow-up. Per-screen 10-foot
restyling beyond the uniform scale-up is a recorded follow-up.

**Acceptance:** in TV home, Select (any family) and touchpad (PS) open the
menu; in-game they do nothing; every `HARMONY_ROUTES` destination is
reachable, controller-navigable, and legible at the scale-up; back returns
to TV home; exit-TV still restores the pre-enter desktop route; all gates +
`recipe.py smoke` green (add the menu to visual-inspect if feasible);
`tv-mode-design.md` + `controller-input-design.md` updated. —
**Branch:** `feat/w278-tv-system-menu`

---

## 3. Parallel Implementation Strategy

Sequential passes — both items touch `tv.css` and TvHome-adjacent files:

### Pass 1

`feat/w277-tv-shelf-aesthetics` — CSS/token-heavy, lands the new geometry first.

### Pass 2

`feat/w278-tv-system-menu` — builds on the settled shelf layout.

---

## 4. Out of Scope for v0.28

- TV-native redesigns of desktop screens (uniform scale-up only; per-screen
  10-foot polish is follow-up).
- Routing embedded-screen game launches through the TV takeover (follow-up).
- Keyboard accessibility completion (#29, v0.29 Craft) — the menu gets the
  pointer button for non-controller users; a dedicated key is not required.
- Controller remap UI changes beyond keeping `quit` overrides working.

---

## 5. Status Ledger

### Pass 1

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.28 |
|---|---|---|---|---|
| `feat/w277-tv-shelf-aesthetics` (W277) | ☐ | ☐ | ☐ | ☐ |

### Pass 2

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.28 |
|---|---|---|---|---|
| `feat/w278-tv-system-menu` (W278) | ☐ | ☐ | ☐ | ☐ |

### Follow-ups discovered during implementation

- None yet.
