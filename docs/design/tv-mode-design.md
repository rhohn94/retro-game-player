# TV mode (10-foot leanback experience)

> **Up:** [↑ Design index](README.md)

## Motivation

The north star is the couch: pick up a controller, browse a beautiful
art-forward library from ten feet away, and be playing seconds later. Today the
app is a desktop-density GUI — small type, mouse-first sidebar, 132px tiles.
TV mode closes epic [#8](https://github.com/rhohn94/retro-game-player/issues/8)
(#9–#13) in one release: a dedicated leanback presentation layer that is
distance-legible, controller-first, art-forward, and seamless in and out of
games. It is the identity feature of a *retro game player* — without it the
product is a library manager, not a living-room console.

## Scope

**In scope**

- A first-class **TV mode** the user enters/exits explicitly (sidebar button,
  `Cmd+T`, controller long-press on `menu`) or automatically at startup
  (`auto_tv_mode` AppConfig flag, off by default, toggle in Settings →
  Appearance). Entering TV mode also enters OS fullscreen; exiting restores.
- **Leanback shell** (`src/features/tv/`): sidebar hidden; TV-safe margins
  (5% overscan inset); a 10-foot type/spacing token scale (`*-tv` tokens
  layered over the existing theme in the `harmony-theme` cascade layer);
  content on full-bleed art backdrops.
- **Home shelves**: horizontally-scrolling cover-art rails — *Continue
  playing*, *Favorites*, *Recently added*, and per-console rails — beneath a
  **key-art hero** region that crossfades to the focused game's full-bleed art
  (title, system, play affordance). Data from the library-life foundation
  ([library-life-design.md](library-life-design.md)).
- **Distance-legible focus + snap navigation**: enlarged focus treatment
  (scale + ring + glow readable at 3m), scroll-snap rails, focused tile always
  fully on-screen; built on the existing spatial engine
  ([controller-input-design.md](controller-input-design.md)).
- **Seamless game entry/exit**: confirm on a tile animates the tile into a
  full-screen takeover while the in-page player boots (boot screen + sound
  intact — auto-boot with sound is the retro vibe, never a muted or gated
  boot); exit returns to the same shelf position with the reverse transition.
  Native and external paths get the same takeover chrome.
- **Retro-but-Aura aesthetic**: CRT-adjacent flourishes (subtle scanline
  texture on the hero, phosphor-glow focus accent, chunky pixel-font accents
  for section labels) expressed **through Aura tokens** (colors, motion
  durations/easings from `src/lib/motion.ts` / `src/theme/motion.css`), never
  hardcoded literals; honors `prefers-reduced-motion` centrally.

**Non-goals**

- CRT/scanline *display filters over gameplay* (#23, v0.29 Craft).
- Keyboard-accessibility completion (#29).
- Collections management UI (rest of #21).
- A separate windowed "TV preview" — TV mode is fullscreen.

## Design

- **Mode model**: `TvModeProvider` (`src/features/tv/TvModeContext.tsx`)
  owning `{ active, enter(), exit() }`; persisted last-state is *not* kept —
  only `auto_tv_mode` governs startup. Mounted in `App.tsx`; when active, the
  shell renders `<TvShell/>` (own router outlet: TV home, TV game detail)
  instead of the desktop sidebar+routes tree. Desktop state is untouched
  behind it; exit restores the previous route.
  - **Implementation note (W260):** rather than keeping the desktop route
    tree mounted-behind while TV mode is active, `App.tsx`'s `Root` component
    conditionally renders `<TvShell/>` OR `<Shell/>` (never both) based on
    `tvMode.active`, inside a single `<AnimatePresence mode="wait">`. The
    desktop tree fully unmounts on enter (stopping its gamepad-focus
    registrations, IPC polls, etc. from running invisibly under the TV
    surface) and remounts fresh on exit. `TvModeProvider` snapshots the exact
    route (`pathname + search`) and the fullscreen state at `enter()` time and
    restores both on `exit()`, so nothing is lost despite the unmount — the
    user returns to the same screen they left. A single shared `useFullscreen()`
    instance (hoisted in `App`) is passed to both `Shell` and
    `TvModeProvider` so the desktop fullscreen button and TV mode's own
    enter/exit stay in sync.
- **Tokens**: `src/theme/tv.css` defines the `*-tv` scale (type ramp ×1.6–2.0,
  tile 320×440 CAP with a responsive live width since v0.28 W277 (below),
  safe-area insets, rail gap) inside the existing cascade layers; components
  consume tokens only (token-adoption guard applies).
- **Shelves**: `TvHome.tsx` composes `<TvHero/>` + `<TvRail/>` list. Rails are
  virtualized-light (windowed rendering ≥50 items). Rail rows register with
  the spatial-focus registry; left/right moves within a rail, up/down across
  rails, with per-rail focus memory. `TvRail` sources: `list_recent`,
  `list_favorites`, recently-added (existing `added_at`), per-system queries.
  - **Implementation note (W261):** the rail model + traversal are split into
    pure, unit-tested helpers — `rails.ts` (`buildRails` ordering/hiding +
    `railWindow` windowing math), `railNav.ts` (`resolveRailNav` row/column
    traversal with the hero as the top row + `rememberFocus` per-rail memory),
    and `systems.ts` (console labels + recency ordering). The base spatial
    engine (`controller/spatial.ts`) is a geometric nearest-neighbour with no
    notion of "rail" or "remembered column", so `TvHome` **installs an
    exclusive controller handler** (`ControllerProvider.setExclusiveHandler`)
    for its lifetime and drives focus through `resolveRailNav` instead — the
    only way to honour per-rail focus memory and treat the hero as a
    first-class row. `confirm` on a tile (or the hero) routes through one
    `tvMode.launch(gameId)` seam (added to `TvModeContext`): it navigates to
    `/game/:id` and leaves TV mode so the desktop router mounts the auto-booting
    detail page — W265 replaces that seam's body with the shared-layout takeover
    without touching any TV-home component. First mount seeds focus onto the
    first tile of the first populated rail (the hero's play button otherwise
    claims initial focus, since it registers first).
  - **Implementation note (W262 — distance-legible focus + snap):** the W261
    handoff flagged the focused tile's ring/glow clipping at the rail
    viewport's top edge. Root cause: `.rgp-tv-rail__row`'s vertical padding
    (`--rgp-tv-rail-row-pad`) was sized for the label + row rhythm, not for
    the focus scale-up + glow, and the row's horizontal padding reused
    `--rgp-tv-safe-area` (as small as ~5vmin), which can fall short of the
    scale+glow footprint on a compact viewport — clipping the first/last tile
    horizontally too. Fix: a new derived token, `--rgp-tv-focus-clearance`
    (`theme/tv.css`) — half the tile's scale-up growth plus the glow radius
    plus the ring width — added on top of BOTH the row's existing padding
    (vertical) and the safe-area inset (horizontal), and mirrored into
    `.rgp-tv-tile`'s `scroll-margin-block`/`scroll-margin-inline` so native
    scroll-into-view (the mirrored-DOM-focus mechanism `TvTile` already uses)
    leaves the same breathing room on every edge, first/last tile included.
    Also added: unfocused tiles dim to `--rgp-tv-focus-dim-opacity` (0.72) so
    the focused one visually leads; the focused caption switches from
    single-line ellipsis to full wrapped text (the scaled-up tile has the
    width/weight to carry it). D-pad **hold-to-repeat** was added to
    `useGamepadPoll` (a pure `navRepeatDue(heldMs, msSinceLastFire)` scheduler,
    unit-tested like `longPressElapsed`): a held nav button re-fires after
    `NAV_REPEAT_DELAY_MS` (400ms) then every `NAV_REPEAT_INTERVAL_MS` (150ms),
    scoped to the four `nav_*` actions only (confirm/back/menu/quit stay
    single-fire). Keyboard-arrow rail navigation was **not** added — TV mode's
    non-goals already scope full keyboard accessibility to #29, and no
    keyboard→SemanticAction bridge exists anywhere in the controller layer
    today, so "native key-repeat" for keyboard applies only to the desktop's
    existing native `<button>`/`tabIndex` elements (a browser built-in,
    nothing to implement).
- **Hero**: focused-game key art via the high-res tier
  ([metadata-art-design.md](metadata-art-design.md)); crossfade ≤300ms on
  focus settle (debounced ~150ms), gradient scrim for legibility.
  - **Implementation note (W261):** `TvHero` resolves its own art URL via
    `useGameArt(game, "snap", { surface: "hero", allowFetch: true })` and
    renders the crossfading full-bleed layer itself (AnimatePresence keyed on
    the URL, `DUR.base` fade), rather than delegating to `HeroBackdrop`'s
    local-only lookup — so the hero's one-shot network fetch actually paints
    (only the single featured hero fetches; the tiles stay local-only). The
    featured game is the LAST **tile**-focused game, held even while focus sits
    on the hero's own Play button, so moving up to Play never blanks the hero.
    The hero art breaks out of the shell's 5% safe-area padding (negative
    margins) so it bleeds to the frame edge while the copy stays title-safe;
    retro-but-Aura flourishes (static scanline overlay + a breathing phosphor
    glow) are token-driven (`tv.css`) and neutralised centrally under
    reduced-motion.
- **Transitions**: Framer Motion shared-layout takeover from tile →
  fullscreen player surface; player boot happens *under* the expanding tile
  art so the swap is invisible; exit reverses to the originating tile
  (scroll restored first). All durations/easings from the motion source.
  - **Implementation note (W265):** the takeover is an OVERLAY, not a route or
    mode swap. `TvModeContext.launch(game, originRect)` sets a `launched`
    `{ game, originRect }` (replacing W261's navigate-to-`/game/:id` seam);
    `App.tsx`'s `Root` then renders `<TvGameSurface/>` on top of the *still-
    mounted* `<TvHome/>` inside `TvShell`. Keeping the home mounted is what
    makes exit land exactly where the user left — its per-rail focus memory and
    scroll position are component-local state that would be lost by an unmount,
    so an overlay is the only design that restores focus for free (no explicit
    scroll/focus save-and-restore needed).
  - **Reveal contract (the honest part):** the sequencing is a pure, unit-tested
    state machine (`tvTakeover.ts`): `idle → expanding → revealed`, with `exit`
    going `→ collapsing → idle`. `beginTakeover` captures the originating tile
    rect; the cover-art layer (boxart-first via the SAME `useGameArt` resolver
    the tile used, so no swap flash) animates that rect → full-viewport while
    `PlaySwitch` mounts and boots UNDERNEATH — boot screen + sound intact, never
    gated, never muted. `revealPlayer` fires on the next animation frame (the
    player surface EXISTS by then), crossfading the cover OUT: the reveal is
    driven by the surface existing, *not* a fixed timer, so the EmulatorJS boot
    screen (part of the retro vibe) is never held under the cover artificially
    long. `beginCollapse` reverses (cover fades back in over the running game and
    shrinks to the tile), then `onExited` drops the overlay. `revealPlayer` and
    `beginCollapse` are idempotent so their triggers can fire more than once
    safely. Reduced motion makes `beginTakeover` jump straight to `revealed` (no
    expand) — a plain crossfade, degrading to an instant swap once the app's
    central reduced-motion policy zeroes the durations.
  - **Controller ownership:** the exclusive-handler slot is single-owner. While a
    game runs, the in-page/native player owns it (so `PlayerOverlay`'s
    menu/back → Resume/Save/Load/Exit works unchanged); the external surface —
    which has no player — installs its own back/menu → Return handler. `TvHome`
    gates its own exclusive-handler install on `!launched`, releasing on launch
    and re-asserting it when the surface unmounts, so the home never fights the
    running game for the controller.
  - **Exit seam:** the players take an optional `onExit` (threaded through
    `PlaySwitch`); the TV surface passes one that begins the collapse, while the
    desktop detail route leaves it undefined and the players fall back to
    `navigate(-1)`. Session cleanup is identical to the desktop path —
    `usePlaySession` (W264) is mounted inside each player, so it brackets the
    TV-mounted player's lifetime too.
  - **Three play paths share the chrome:** in-page + native mount `PlaySwitch`
    under the expanding art (native's canvas boots under the cover just like the
    iframe); external RetroArch-only systems (`!canPlayInPage`) land on
    `TvExternalSurface` — a branded "Running in RetroArch" panel that fires the
    external `launch_game` itself and offers a 10-foot Return control, matching
    the desktop path's honesty about external play.
- **Auto-enter**: `AppConfig.auto_tv_mode: bool` (Rust `config/mod.rs`,
  default `false`) + `get_config`/`set_config` IPC already present; on mount,
  `App.tsx` reads config and calls `enter()` once when set.
- **Controller**: TV mode raises no new input layer — it registers ordinary
  focus targets; `back` at TV home exits TV mode (with confirm), `menu`
  long-press toggles TV mode anywhere outside gameplay.
  - **Implementation note (W260):** `useGamepadPoll` only emits rising-edge
    semantic actions (one fire per press — the right behavior for
    confirm/back/nav) and has no notion of held-duration, so the long-press
    detector is a small, independent hook
    (`src/features/controller/useLongPress.ts`) rather than an extension of
    the shared poll. It reads the same raw Gamepad API and the same pure
    `resolveBindings`/`detectFamily` helpers, tracks one action's
    continuously-held duration via its own rAF loop, and fires once at the
    `LONG_PRESS_MS` (600ms) threshold — mirrored as the
    `--rgp-tv-long-press-ms` token in `theme/tv.css` for any CSS-side
    consumer. `useTvModeControllerToggle` (in `src/features/tv/`) wires it to
    `menu`; "outside gameplay" holds by construction because the in-page/
    native player installs an exclusive controller handler
    (`ControllerProvider.setExclusiveHandler`) while a game is running, which
    makes every other action source — including this poll — a no-op until
    released.

## Acceptance

_Checked off by W26A (v0.26 Pass 6, the final quality gate). Evidence noted per
bullet: test name / screenshot path / measured value._

- [x] TV mode can be entered and exited via sidebar button, `Cmd+T`, and
      controller `menu` long-press; enter goes fullscreen, exit restores the
      prior desktop route and window state.
      — Wired in `App.tsx`: sidebar `📺 TV mode` button (`FocusableTvModeButton`),
      `useTvModeAccelerator` (`Cmd/Ctrl+T` → `enter()`/`exit()`),
      `useTvModeControllerToggle` (`menu` long-press). Enter couples
      `fullscreen.setFullscreen(true)`; `TvModeProvider.exit()` restores the
      snapshotted route + fullscreen state (`TvModeContext.tsx`).
- [x] With `auto_tv_mode: true`, a fresh launch lands directly in TV home
      (verified via mock-IPC visual inspection).
      — visual-inspect `tv-home` route (mockOverride `get_auto_tv_mode: true`)
      renders the TV shell + "CONTINUE PLAYING"; screenshot
      `artifacts/visual-inspection/tv-home.png`.
- [x] TV home shows hero + ≥3 rails (Continue playing, Favorites, Recently
      added) populated from fixtures; per-console rails appear for systems
      with games.
      — Measured: hero present + 7 rails: `Continue playing, Favorites, Recently
      added, NES, SNES, Genesis, Nintendo 64` (per-console rails for every
      system with games). `tv-home.png` shows the hero + populated first rail.
- [x] All TV surfaces are fully controller-navigable (rail traversal, hero
      focus, game launch, back-out) with no pointer required.
      — `TvHome` installs an exclusive controller handler driving
      `resolveRailNav` (unit-tested: `railNav.test.ts`); hero is the top focus
      row (`HERO_FOCUS_ID`); `confirm` launches via the one `tvMode.launch` seam;
      `back` runs the two-press exit-confirm. Tiles/hero/external-Return all
      register `useFocusable`.
- [x] Focus treatment legible at distance: focused tile scales ≥1.08 with a
      high-contrast ring; rails snap the focused tile fully into view.
      — Measured: focused tile `transform: matrix(1.12…)` (≥1.08), ring
      box-shadow present, unfocused tiles dim to opacity `0.72`; the last tile
      after focus is fully within the rail row bounds (native scroll-into-view +
      `scroll-margin` clearance, W262).
- [x] Launching from a tile plays the takeover animation and boots the game
      with sound (no manual play gate); exiting returns to the same rail +
      tile position.
      — `tvTakeover.ts` state machine (unit-tested `tvTakeover.test.ts`); the
      cover expands tile→fullscreen — screenshot
      `artifacts/visual-inspection/tv-takeover.png` (cover mid-expand). Boots with
      sound (no gate): `PlaySwitch` mounts under the cover, iframe `allow="autoplay"`,
      default `volume: 1` (never muted). Exit keeps `TvHome` mounted behind the
      overlay, so the originating tile stays focused (measured: same tile focused
      after launch; the overlay design restores focus + scroll for free).
- [x] Type/spacing/margins come from `*-tv` tokens; token-adoption and motion
      guards stay green; `prefers-reduced-motion` disables the flourishes.
      — `token-adoption.test.mjs` + `motion.test.mjs` + `aura-wiring.test.mjs`
      green; `pnpm lint` clean. Measured under reduced motion: the hero phosphor
      breathe `animation-duration` collapses to `0.01ms` via the single central
      `theme/motion.css` rule (no per-component media query).
- [x] `recipe.py smoke` passes with TV routes included in visual inspection.
      — `recipe.py smoke` exits 0; visual-inspect walks `tv-home` + `tv-takeover`
      (+ the desktop `game-detail` route), is rebuild-aware (fails loudly on a
      stale `dist/`), and reports zero console/page errors on all TV surfaces.

## v0.27 "Immersion" (W272/W273/W275) — takeover play experience, hover-attract, gap audit

First real couch sessions on v0.26.x surfaced two takeover defects and one
missing beat (all user-reported 2026-07-03), plus a standing request to
re-audit the whole feature.

### W272 — Takeover play experience (fullscreen + input ownership)

**Defect 1 — the porthole.** `TvGameSurface` correctly fills the viewport,
but the player inside still wears its desktop detail-page styling:
`.rgp-player__frame` caps at `max-width: 760px` / `aspect-ratio: 4/3`
(library.css) — a desktop card floating in a TV-sized black field.

**Defect 2 — leaked controller input.** `InPagePlayer` claims the
controller's exclusive slot while mounted; **`NativePlayer` never does** (the
comment in TvGameSurface asserting otherwise is wrong). TvHome correctly
releases its handler on launch, so with a native game running the BASE
spatial engine is live over the still-mounted home: PS ✕ = `confirm` =
"launch the focused tile" — pressing ✕ in-game swapped the running game.

Fix contract:

- **Fill presentation.** `PlaySwitch` (and both players) accept the takeover
  surface's presentation: the player fills its container edge-to-edge
  (`max-width: none`, no aspect box, canvas/iframe letterboxed by
  `object-fit: contain` on black), TV-scale chrome only — the desktop
  chip bar (`.rgp-player__bar`) is hidden on the TV surface; the overlay
  (menu/Escape/controller ☰) is the sole in-game menu, styled at the
  `--rgp-tv-*` scale when in TV mode.
- **Input ownership.** Extract InPagePlayer's exclusive-handler pattern into
  one shared hook (`src/features/play/`), adopted by BOTH players: while a
  player is mounted foreground, it owns the exclusive slot — overlay closed:
  `menu` opens the overlay, every other semantic action is swallowed (game
  input reaches the core via the raw gamepad poll, not semantic actions);
  overlay open: `nav_up`/`nav_down` move the selection, `confirm` activates,
  `back`/`menu` close. Backgrounded/attract presentations do NOT hold the
  slot (the page owns the controller). This also gives the native path
  controller-driven overlay menus (previously keyboard-only).
- The stale TvGameSurface comment is corrected to describe the real
  contract.

Acceptance: launching from a TV shelf fills the frame edge-to-edge on both
player paths; with a native game running, every controller button either
reaches the game or the overlay — none reaches the home underneath; the
overlay is fully controller-drivable on the native path; desktop detail-page
play is visually unchanged.

### W273 — Hover-attract (5 s dwell boots a live preview)

Dwelling on a shelf tile for 5 s (`--rgp-tv-attract-dwell-ms: 5000` — one
constant, keyboard-focus and pointer-hover alike) boots that game as a
**live full-bleed preview** behind the home: the hero backdrop layer hands
off to real gameplay, dimmed under the existing scrim so rails stay legible,
audio ducked to the W235 attract gain (0.3 × user volume — the boot sound is
part of the vibe, quietly). Input never attaches: the preview is a spectator
surface; the controller keeps navigating the home.

- **Purity (hard requirement):** a preview must not leave a trace — no
  library-life play-session record (no play count / recency / play-time), no
  SRAM writes, no exit auto-save-state. The native session starts in a
  preview mode that omits save wiring end-to-end (frontend skips
  `usePlaySession`; the start command's preview flag passes `saves: None`).
- **Scope v1: native-capable games only** (the purity guarantee is
  structural there). EmulatorJS-only systems keep today's static art;
  extending previews to the EJS path (needs save-suppression through the
  iframe glue) is a recorded follow-up.
- **Lifecycle:** the dwell timer resets whenever the focused/hovered tile
  changes; moving away, launching anything, opening the exit-confirm, or
  leaving the home tears the preview down (short crossfade, central
  reduced-motion policy). At most one preview session ever exists; a real
  launch always boots fresh (the boot screen is the retro beat, and the
  preview session's core is torn down first).

Acceptance: dwell 5 s on a native-capable tile → live gameplay fades in
behind the home with ducked audio; play counts / Continue-playing / saves
are byte-identical before and after a preview; input never leaks; moving
focus tears it down within a frame's crossfade; external/EJS tiles never
attempt a preview.

### W275 — Gap audit (re-evaluate the whole feature)

After W272/W273 land: a dedicated audit pass walks every §Acceptance bullet
in this document plus the v0.27 contracts above against the real code, and
exercises the interplay seams: exit-confirm vs takeover, pause-on-blur
during TV play, W235 detail-page attract vs W273 TV attract, auto-TV-mode
boot straight into takeover, focus restoration after exit, external-path
controller handling, reduced-motion variants, keyboard-only parity. Small
gaps are fixed in the audit branch; anything structural is recorded in §5
follow-ups with a design note.

### W275 audit — findings

Every contract and seam below was verified against the code on
`fix/w275-tv-gap-audit` (Pass 3), not against this document. Verdicts:
**OK** (holds as specified), **fixed** (gap closed in this branch),
**follow-up** (structural — recorded in §Follow-ups, not started).

| # | Contract / seam | Verdict | Notes |
|---|---|---|---|
| 1 | v0.26 acceptance: enter/exit affordances + fullscreen restore | fixed | Entry/exit + route/fullscreen snapshot hold (`TvModeContext`), but `InPagePlayer` forced window-fullscreen OFF on every exit/unmount — exiting an EJS game inside the takeover dropped TV mode (and desktop F11) out of fullscreen. Now gated on the player's own immersive mode. |
| 2 | v0.26 acceptance: `auto_tv_mode` boot → TV home | OK | `useAutoTvModeOnStartup` (one-shot read, silent degrade); smoke `tv-home` route covers it. Boot-seeded focus starts the W273 dwell — intended. |
| 3 | v0.26 acceptance: hero + ≥3 rails + per-console rails | OK | `useTvLibrary` + pure `buildRails`. |
| 4 | v0.26 acceptance: fully controller-navigable, no pointer | OK | `railNav` exclusive routing; hero top row; single launch seam. |
| 5 | v0.26 acceptance: distance-legible focus + snap | OK | 1.12 scale / ring / glow / dim + `scroll-margin` clearance tokens (W262). |
| 6 | v0.26 acceptance: takeover boots with sound; exit returns to the same tile | fixed | Sound/reveal contract holds (`tvTakeover`); controller focus survives by the overlay design — but native DOM focus did not (see #16). |
| 7 | v0.26 acceptance: `*-tv` tokens + central reduced motion | OK | Guards green; new W272/W273 motion rides `DUR`/`EASE` + `MotionConfig reducedMotion="user"`; takeover has an explicit reduced-motion path (`beginTakeover` → `revealed`) + collapse safety net. |
| 8 | W272: edge-to-edge fill on both players; desktop unchanged | OK | `.rgp-player--takeover` scoped rules; chip bar hidden; overlay at TV scale. |
| 9 | W272: no controller action reaches the home under a running game | fixed | Held for a healthy player, but the single-ref exclusive slot left NO-OWNER windows (in-page origin resolution, native→EJS failure swap, GetCorePanel which claims nothing) where the base engine ran over the hidden home — the W272 defect resurfacing on degraded paths. Replaced with a layered claim stack (`exclusiveStack.ts`, unit-tested) + a surface-level swallow-all fallback claim on `TvGameSurface` for every path. |
| 10 | W272: overlay controller-drivable on the native path | OK | `routeScopedAction` (unit-tested) via the shared scope. |
| 11 | W273: 5 s dwell, one constant, hover + keyboard focus alike | OK | `TV_ATTRACT_DWELL_MS` ⇄ `--rgp-tv-attract-dwell-ms`; pointer hover folds into controller focus (one dwell key). |
| 12 | W273: purity (no play record / saves / perf log) | OK | `presentationRecordsPlaySession` (frontend) + `session_side_effects` (backend), both unit-tested; preview renders bare canvas, skips even the Continue read. |
| 13 | W273: input never attaches; teardown rules; one session max | OK | Spectator gates keyboard + poll + claim; dwell hook clears on any key/eligibility/gate change; backend `NativeSession` is a replacing singleton, and the preview unmount-cleanup dispatches before the takeover's mount start (same commit). |
| 14 | Seam: exit-confirm vs takeover | fixed | The armed confirm survived a launch — a quick play-and-return inside its 3 s window let a SINGLE `back` silently exit TV mode. `launch()` now disarms it (`useTvExitConfirm.cancel`). While a takeover runs, `back` never reaches the home (claim stack), so the two can no longer fight. |
| 15 | Seam: pause-on-blur (W243) in TV mode | fixed | Takeover players share the desktop blur/focus handlers — sane. But the dwell kept counting behind a Cmd+Tab and booted an AUDIBLE preview in a backgrounded app, which pause-on-blur cannot catch (the blur predates the session mount). Dwell + fired preview now gate on window focus (`useWindowFocus`). |
| 16 | Seam: focus restoration on exiting a game (incl. after a preview) | fixed | Controller focus was already exact (overlay design). DOM focus wasn't: the origin tile kept it under the running game (stray Enter re-fired its launch; Tab reached hidden home controls), and nothing restored it for keyboard users on exit. The home is now `inert` while launched and `focusElement` re-asserts DOM focus on the focused tile at takeover end. A preview never moves focus — nothing to restore. |
| 17 | Seam: external/RetroArch path inside TV | OK | One-shot launch guard, honest state line, Return as the single focus target; ownership covered by the surface fallback (confirm/back/menu → Return). |
| 18 | Seam: reduced motion on every W272/W273 animation | OK | All Framer-driven off the central motion source under `MotionConfig reducedMotion="user"`; CSS side neutralised by the one `theme/motion.css` rule. |
| 19 | Seam: keyboard parity | fixed | Tab/Enter navigation, Cmd+T, Escape-overlay all held — but an EJS game in the takeover was UNPLAYABLE by keyboard (the iframe only receives keys when DOM-focused; nothing focused it without a pointer). The in-page player now focuses its iframe in the takeover presentation. |
| 20 | Seam: `menu` long-press "outside gameplay" | fixed | The W260 comment claimed the exclusive slot gates the long-press poll — false: `useLongPress` reads the raw pad itself, so holding Start ≥600 ms mid-game toggled TV mode (desktop: unmounted the running game). Now gated on the provider's `gameplayClaimActive` (set by the shared player scope) and threaded the persisted `menu` rebind overrides (W267 parity). |
| 21 | W273 race: dwell fires as the user presses confirm | OK | Same-commit ordering (preview unmount cleanup → takeover mount) + the backend's replacing session singleton; a batched dwell+launch never mounts the preview at all. |
| 22 | W273: native-play disabled / ROM missing / core absent mid-dwell | OK | `startNativePlay` rejects → `onStartFailed` → the game is silently marked failed for the mount (no visible error, never retried). Cosmetic residue → follow-up (hero-art handoff below). |
| 23 | W272 follow-up: PlayNotice/GetCorePanel desktop-scaled in takeover | fixed | Scoped `--rgp-tv-*`-scale rules under `.rgp-tv-game-surface`; the notice also stacked BESIDE the fallback player at half width (row flex) — now a banner above it. |
| 24 | W272 follow-up: redundant "Full screen" overlay item in takeover | fixed | `presentationAllowsImmersive` (unit-tested) — the item only exists on the desktop foreground player. |
| 25 | W272 follow-up: native one-frame Start race | fixed | The overlay-open flag is now mirrored into the poll ref eagerly, so the same-frame input poll can't re-send the Start bit and stomp the release-to-zero. |

**Ownership model change (audit fix #9, load-bearing):** the controller's
exclusive slot is now a *claim stack* (`controller/exclusiveStack.ts`), not a
single nullable ref. Owners call `claimExclusive(handler, kind)` and release
by identity; the top claim receives actions, and a release uncovers the claim
beneath. Kinds: `"ui"` (TV home, takeover fallback) vs `"gameplay"` (a mounted
player via `useExclusiveControllerScope`) — `gameplayClaimActive` is the
app-level "a game owns the pad" signal (gates the `menu` long-press toggle).
Ordering: the takeover surface claims its fallback in a **layout** effect so a
player's **passive**-effect claim always lands above it. Earlier §Design notes
describing `setExclusiveHandler` reflect the pre-W275 single-slot API.

## v0.28 "Living Room" (W277) — smaller banner, unchopped tiles, ≥5 visible

User directive (2026-07-03, verbatim): *"The banner is too big. Let's cut it
down. Game thumbnails are chopped top and bottom. Game thumbnails should never
be chopped. It is okay to draw them on top of the banner. Shrink them so that
at least 5 games are visible at a time."*

**Root cause.** At 1920×1080 the old fixed geometry (`--rgp-tv-hero-height:
42vh`, fixed 320×440 tiles) left only ~1687px of row width after safe-area +
focus-clearance insets on both sides — **~4.8 tiles visible**, and the rails
region (leftover height below a 42vh hero) was shorter than one full tile, so
the visible tile's bottom (and, depending on scroll position, top) was clipped
by the rail row's own overflow box.

**Geometry, tuned against 1920×1080 (and sanity-checked at a 1512×982 laptop
fullscreen viewport):**

- **Hero cut from 42vh to 26vh.** Measured against the hero copy stack
  (title 56px/1.05 + subtitle 24px + a chip row + the play button, `aura-space`
  gaps between): at 1920×1080 the stack is ≈247px including its own bottom
  padding, so 26vh (280.8px) clears it with a comfortable margin. The hero's
  `--rgp-tv-hero-content-pad` was also stepped from 4vmin to 3vmin (buys back
  headroom under the shorter band). At 1512×982 (26vh = 255.3px) the margin is
  tighter (font sizes are px, not vh-scaled, so they don't shrink with the
  viewport) but still positive.
- **Tile width made responsive; 320×440 becomes a CAP, not a fixed pair.**
  New tokens `--rgp-tv-tile-width-cap: 320px` / `--rgp-tv-tile-height-cap:
  440px` hold the original size. The live `--rgp-tv-tile-width` is redeclared
  per rail row (`tv-home.css` `.rgp-tv-rail__row`, since the formula needs
  `100vw`, which only makes sense scoped there):
  ```
  min(320px, calc((100vw - 2*(safe-area + focus-clearance) - 4*rail-gap) / 5))
  ```
  i.e. the smaller of the original cap and the width that fits exactly 5 tiles
  + 4 gaps across the row's available content width. Below the cap this closes
  an exact 5-tiles-visible budget **by construction** (`5×width + 4×gap ==
  available width`), so a 6th tile sits fully outside the visible row rather
  than being fractionally clipped in. Tile height tracks width via `aspect-
  ratio: 320 / 440` on `.rgp-tv-tile__frame` (not a second live-height token),
  keeping the 320:440 "box" proportion at every size.
  - **Computed at 1920×1080:** tile ≈ 311.8×428.8px, **5.0 tiles visible**
    (up from ~4.8).
  - **Computed at 1512×982:** tile ≈ 232.2×319.3px, **5.0 tiles visible**.
  - **Gotcha (caught by measuring the rendered tile in a real browser, not
    by reading the CSS): `aspect-ratio` needs a bare `<ratio>` — unitless
    numbers like `320 / 440`.** Feeding it the existing `<length>` cap
    tokens (`320px / 440px`) is invalid CSS; it silently resolves to `auto`
    with no console warning, and the frame's height then falls out of
    unrelated flex/content sizing instead of the intended aspect (measured
    ≈467px instead of ≈429px before the fix). Fixed with a second, unitless
    token pair (`--rgp-tv-tile-aspect-w: 320` / `--rgp-tv-tile-aspect-h:
    440`) that mirrors the px caps for this one consumer — CSS has no
    unit-stripping function, so the two pairs are kept in sync by hand if
    the cap is ever re-tuned.
- **Circularity trap, resolved per the release-plan warning.**
  `--rgp-tv-focus-clearance` (the padding/scroll-margin reserved for the
  focused tile's scale-up + ring + glow) used to derive from the live
  `--rgp-tv-tile-height`. Once tile width became viewport-derived (and height
  derives from width via `aspect-ratio`), and the row's available width
  formula subtracts focus-clearance from `100vw`, deriving clearance from a
  live tile height would close a `var()` cycle: width → height → clearance →
  width. **Resolution:** `--rgp-tv-focus-clearance` now derives from the fixed
  `--rgp-tv-tile-height-cap` (440px) instead of the live tile height — a
  documented conservative constant. This slightly over-reserves clearance once
  a tile shrinks below the cap (a smaller focused tile needs less real
  clearance than the cap-derived value provides), which is the safe direction
  to be wrong in: tiles stay unclipped, never tight.
- **Tiles never chopped.** With the shorter hero and the responsive tile
  height, the rails region's visible height at 1920×1080 (≈566px) already
  exceeds the responsive tile's own height (≈429px) with **zero** hero/rail
  overlap — the bare tile was never at risk of clipping once the hero shrank
  and the tile followed suit. The W262 clearance system (`scroll-margin-block`
  / `scroll-margin-inline` mirroring the row's padding) is unchanged in shape,
  just fed by the now-cap-derived `--rgp-tv-focus-clearance` — the focused
  tile's scale/ring/glow stay unclipped at the new sizes exactly as before.
- **Rails overlap the hero (user-authorized).** A new `--rgp-tv-rail-overlap:
  2rem` token pulls `.rgp-tv-home__rails` up over the hero's lower band
  (negative `margin-top`); paint order (DOM order, both elements `position:
  relative` at the default z-index) puts the rails above the hero without a
  z-index. This is a deliberately conservative value — tuned so it only ever
  draws over the hero's ART/scrim in the dead band below the copy, never over
  the copy itself (the hero content's existing bottom padding already clears
  more than 2rem above the hero's true bottom edge at 26vh). It is **not**
  load-bearing for "unchopped" (the bare tile already fits with zero overlap,
  above) — it is the authorized visual move that visually reunites the
  shortened hero with the first shelf instead of leaving a gap between them.
- **Desktop untouched; reduced-motion unaffected.** Every change here is
  confined to `--rgp-tv-*` tokens and `src/features/tv/` — no desktop surface
  or motion/reduced-motion rule was touched.

**Files:** `src/theme/tv.css` (tokens), `src/features/tv/tv-home.css`
(responsive row formula, aspect-ratio tile frame, hero/rail overlap).
`src/features/tv/rails.ts` windowing is unchanged (count-based, no width
knowledge — the responsive width is purely a CSS-layer concern).

## v0.28 "Living Room" (W278) — TV system menu + every page in TV mode

User directive (2026-07-03, verbatim): *"Support hitting 'Select' (outside of
games) or Playstation Touchpad to open a menu for navigating to other screens
in the app, such as the Console database and Settings page. All pages and
features should be accessible in TV mode."*

Before this, TV mode was a closed loop: home → hero/rails → game takeover →
back to home. Every other screen (Consoles, Search, Cores, Settings) was
unreachable without exiting TV mode entirely — the couch experience covered
browsing + playing, but nothing else.

### Trigger — Select / PlayStation touchpad, outside gameplay

The `quit` semantic action was bound to Select (`STANDARD_BUTTON.select`,
button 8) on every family but consumed nowhere in the app (only labeled in
`glyphs.ts`) — the natural, already-present trigger to repurpose as "open the
TV system menu." PlayStation pads additionally trigger it with the touchpad
click (`STANDARD_BUTTON.touchpad`, button 17) via a new, small **aux-binding**
table in `actions.ts` (`defaultAuxBinding(family, action)`) rather than
widening `BindingMap` to multiple buttons per action — full mechanism in
controller-input-design.md §2.4. This keeps `quit`'s existing single-binding
contract (persisted rebind overrides, `nativeInput.ts`'s mapping, the main
`useGamepadPoll`/`risingActions` dispatch) completely undisturbed.

The trigger itself is a **raw-poll rising-edge hook**
(`src/features/controller/useMenuTrigger.ts`), mirroring `useLongPress`'s
shape (own small rAF loop reading `navigator.getGamepads()` directly + the
same `resolveBindings`/`detectFamily` helpers) rather than routing through
`ControllerProvider`'s exclusive-claim dispatch — so it fires regardless of
who currently holds the exclusive slot (the TV home's own claim must not
block it). Unlike `useLongPress` this is rising-edge, not hold-to-fire: the
spec calls for an immediate open on a single press, not a long hold. The pure
per-tick check (`isMenuTriggerPressed`) is unit-tested without hardware.

A TV-feature-level policy hook, `useTvSystemMenuTrigger` (mirroring
`useTvModeControllerToggle`'s split of "controller feature owns the
mechanism, TV feature owns the policy"), gates the raw trigger on ALL of:

- TV mode active (`tvMode.active`);
- the menu not already open (`!tvMode.menuOpen` — a second Select/touchpad
  press while the panel is open is handled entirely by `TvSystemMenu`'s own
  exclusive-claim `back`/`quit` handling, a completely independent dispatch
  path from this raw poll; re-arming this trigger too would race the two
  "did Select just close it" signals against each other for no benefit);
- outside gameplay (`!gameplayClaimActive` — the exclusive-claim-stack signal
  `useTvModeControllerToggle` already reads for the same reason);
- no takeover surface mounted (`tvMode.launched === null` — a running game
  keeps sole ownership of every input source, matching the takeover's own
  swallow-all fallback claim);
- the window focused (`useWindowFocus`, the same gate W275 added to the
  hover-attract dwell).

### Menu — `TvSystemMenu`

A 10-foot overlay panel (`src/features/tv/TvSystemMenu.tsx` +
`src/features/tv/systemMenu.ts` for the pure list/nav model) listing, in
order: **TV Home · Consoles · Search · Cores · Settings · Exit TV mode**
(`TV_MENU_ITEMS`, systemMenu.ts) — the same "primary destinations" set the
desktop sidebar shows (`HARMONY_ROUTES` entries with a `navLabel`), plus the
menu's own TV Home / Exit TV mode rows. Console detail / game detail stay
deep-link-only, matching the sidebar's own gated list.

While open, `TvSystemMenu` claims `"ui"` on the controller's exclusive stack
(`claimExclusive`, `ControllerProvider`) — ABOVE whatever `TvHome` or an
embedded screen already holds, so:

- `nav_up`/`nav_down` move the selected row (`nextMenuIndex`, no
  wraparound — an end-stop, mirroring `railNav`'s left/right end-stops);
- `confirm` activates the selected row;
- `back` **or** `quit` (Select-again) close the panel without navigating.

Selection is tracked via the same `focusedId`/`setFocus` primitives every
other TV surface uses (not `useFocusable`'s `register()`, since the panel is
driven by its own exclusive claim rather than the base spatial engine — the
same reasoning `TvHome`'s rail navigation already applies). Pointer hover
funnels into the same focus id, matching the tile/hero convention.

Opening the menu also:
- **cancels an armed exit-confirm** (`TvHome`'s `exitConfirm.cancel()`) —
  mirrors the W275 fix where `launch()` already disarms a stale confirm so a
  `back` pressed just before doesn't leave TV mode one press from silently
  exiting under the overlay;
- **suppresses the W273 attract dwell + preview** — `tvMode.menuOpen` is
  threaded into `useAttractDwell`'s `enabled` alongside `launched === null`
  and `!exitConfirm.confirming` (the same "something more important is
  showing" gating family), so a running/building preview tears down the
  instant the menu opens rather than continuing (audibly) behind it.

**Pointer parity:** a visible **☰ Menu** button sits in `TvShell`'s header,
in the same `.rgp-tv-shell__chrome-buttons` group as the existing exit
button (same styling family, positioned as a flex row rather than two
independently-absolute-positioned elements, so their relative placement
comes from a themeable gap token instead of a hand-measured offset — see
tv-shell.css). It calls `tvMode.openMenu()` directly, the same seam the
controller trigger calls.

New `--rgp-tv-*` tokens (`theme/tv.css`): `--rgp-tv-menu-panel-width`
(reuses the W272 overlay-panel floor), `--rgp-tv-menu-item-gap`, and
`--rgp-tv-embed-scale` (below).

### Every page in TV mode — the embedded-screen outlet

Choosing a non-home, non-exit destination renders the **real desktop screen**
inside the TvShell outlet, in place of `TvHome` — TV mode and OS fullscreen
stay active throughout. This is a full swap, not an overlay: unlike the game
takeover (which keeps `TvHome` mounted behind it so focus memory survives),
picking a destination actually **unmounts** `TvHome`, which automatically
releases its exclusive claim (`exclusiveStack`'s release-by-identity
contract) — the embedded screen's own base-spatial-nav (`useFocusable`)
registrations then just work, exactly as they do on the desktop.

`TvModeContext` gained two pieces of state for this (`embeddedPath`,
`menuOpen`) plus three transitions:

- **`enterEmbedded(path)`** — navigates the REAL router to `path` (so
  `HARMONY_ROUTES`' real elements + params resolve exactly as they do on the
  desktop: `/console/:key`, `/game/:id` deep links, and any in-screen
  navigation like "Consoles → a console's own detail link" just work with no
  bespoke handling) and sets `embeddedPath` so `Root` (App.tsx) swaps the
  outlet content.
- **`returnToHome()`** — hides the embedded region (`embeddedPath = null`).
  Does NOT navigate: `TvHome` reads no router location state, so nothing
  needs to change there; the next `enterEmbedded` call navigates fresh.
- **`TvEmbeddedScreen`** (`src/features/tv/TvEmbeddedScreen.tsx`) — reuses
  the SAME `HARMONY_ROUTES` table + `<Routes>`/`<Route>` resolution
  `RoutedOutlet` (App.tsx) uses on the desktop, driven by the real router
  location. Registers `back → returnToHome` as the screen-level action
  handler (`setActionHandlers`) — the same seam `ShellControllerBindings`
  uses for the desktop's own global `back → navigate(-1)` binding. `back` at
  the embedded region always returns to TV home (it does not first
  "un-nest" one level within an embedded screen's own history) — a screen's
  OWN "back to parent list" affordance (e.g. `ConsoleDetailPage`'s own back
  button, already a real on-screen `<button>`) is a separate control, not
  this semantic action. Wrapped in a **uniform 10-foot scale-up**
  (`.rgp-tv-embed`, CSS `zoom: var(--rgp-tv-embed-scale)` — one knob, not
  per-screen restyling, per the release-plan contract): `zoom` (unlike
  `transform: scale`) keeps layout math — `getBoundingClientRect` reads the
  base spatial engine depends on, native scroll-into-view, hit-testing — in
  scaled coordinates, so nothing needed to change in the embedded screens
  themselves.

**The exit-snapshot contract (the trickiest seam, W260's original design)**
is preserved by construction: `TvModeContext`'s `priorRouteRef` — the ref
`exit()` reads to restore the pre-enter desktop route — is written in
EXACTLY one place, inside `enter()`'s `!wasActive` branch. `enterEmbedded`
and `returnToHome` never touch it, no matter how many in-TV navigations run
between `enter()` and `exit()`. So `exit()`'s `navigate(priorRouteRef.current)`
always lands on the route that was active before TV mode was entered — never
on whatever embedded screen the menu last showed. Verified against a real
running instance (not just read from the code): `scripts/visual-inspect.mjs`'s
`tv-embedded-screen` route opens the menu, navigates to Consoles, then exits
TV mode and asserts the hash is back at `#/` (the pre-enter Library route),
failing loudly if it were ever `#/consoles` instead.

`exit()` also resets `menuOpen`/`embeddedPath` to their initial values, so a
later `enter()` always starts fresh on the TV home rather than resuming
wherever in-TV navigation left off.

### Known-honest v1 edges (recorded, not solved)

- **Embedded game-detail play uses the desktop-style in-page player** inside
  the outlet (with sound — the auto-boot contract holds), not the TV
  takeover (`TvGameSurface`). Routing an embedded launch through the takeover
  chrome is a follow-up.
- **Per-screen 10-foot restyling beyond the uniform scale-up** is a
  follow-up — the embedded region gets ONE `zoom` knob, not bespoke TV
  layouts for Consoles/Search/Cores/Settings.
- **`back` at an embedded screen always returns to TV home**, rather than
  first un-nesting one level of the embedded screen's own navigation history
  (e.g. console detail → consoles list) — screens already expose that as
  their own on-screen back affordance (a real, controller-focusable button),
  so this is a deliberate v1 simplification rather than a gap, but is worth
  revisiting if user feedback wants `back` to feel more "layered."
- **No dedicated TV-mode `HintBar`.** TV mode has never rendered a hint bar
  (the desktop `HintBar` in `App.tsx`'s `Shell` is desktop-only); the
  Select/touchpad system-menu gesture's sole on-screen discoverability today
  is the visible ☰ Menu button, not a controller-glyph hint. Adding a
  TV-scaled hint bar is out of scope for this item (pre-existing gap, not
  introduced here) — tracked as a follow-up alongside the CRT-filter /
  attract-mode-screensaver items below.

**Files:** `src/features/controller/actions.ts` (touchpad button + aux-binding
table), `src/features/controller/useMenuTrigger.ts` (+ `.test.ts`),
`src/features/tv/systemMenu.ts` (+ `.test.ts`), `src/features/tv/TvSystemMenu.tsx`,
`src/features/tv/tv-system-menu.css`, `src/features/tv/TvEmbeddedScreen.tsx`,
`src/features/tv/useTvSystemMenuTrigger.ts`, `src/features/tv/TvModeContext.tsx`
(menu/embedded state), `src/features/tv/TvShell.tsx` (☰ Menu button + menu
mount), `src/App.tsx` (`Root`'s outlet swap), `src/theme/tv.css` (new tokens).

## Open questions

- Per-console rail cap (all 20 systems would be noisy) — start with "systems
  that have ≥1 game", ordered by recency.
- Whether hero uses snap/title art when boxart-only exists — yes, fall back
  boxart → blurred boxart backdrop.

## v0.29 "Craft" (W280) — CRT filter renders unchanged inside the takeover

The CRT filter (crt-filter-design.md) needed no takeover-specific code: both
`NativePlayer` (WebGL2 shader) and `InPagePlayer` (CSS approximation) apply
it internally to their own paint/render step, and the takeover surface
(`TvGameSurface`/`TvEmbeddedScreen`) mounts those same components unchanged
— it only ever varied the `presentation` prop, never how they paint. So the
filter renders identically in the desktop foreground player and the TV
takeover, at whatever intensity Settings → CRT Filter has configured, with
no new takeover-scoped styling. The takeover's own dim/scale/attract
treatments (e.g. `--harmony-attract-dim` on the native canvas,
`.rgp-player--attract`'s `filter: brightness()/saturate()`) compose with the
CRT shader/overlay rather than replacing it — both are just further
transforms of the same painted frame.

## v0.37 "Trophies" (W375) — banner over hero art (issue #38)

**Complaint (#38).** `TvShell`'s section-label header (`.rgp-tv-shell__header`,
"RETRO GAME PLAYER") reserved its own flex row above the outlet — a full row
height plus `--rgp-tv-rail-row-gap` of dead space above the hero, on every TV
screen, for one small label. That's the same shape of problem v0.28 W277 fixed
for the hero/rail seam (a fixed chrome reservation eating into the couch's
vertical budget) and the same fix family applies: stop reserving space for
chrome that can legibly sit *over* full-bleed art instead.

**Fix.** `.rgp-tv-shell__header` no longer gets its own flex row (or even its
own absolute rule) — it's grouped with the existing pointer exit/menu buttons
into ONE absolutely-positioned column, `.rgp-tv-shell__top-chrome`, anchored to
the frame's top-RIGHT corner (the frame already insets by
`--rgp-tv-safe-area`, so no extra offset is needed). The group layers on top of
the hero via stacking order rather than DOM order: the hero (`.rgp-tv-hero`) is
`isolation: isolate`, so its internal z-index stack never leaks past its own
boundary, and the group's `z-index: 2` inside the shared `.rgp-tv-shell__frame`
stacking context wins over the hero's (and the W273 attract-preview layer's)
implicit `z-index: 0` — the same level the exit/menu buttons already used
pre-W375. `.rgp-tv-shell__frame`'s `gap` (only ever spanning the header/outlet
pair) is removed as dead weight now that the frame has a single flex child.

**Top-right, not top-left (a real bug caught by measuring, not by reading the
CSS).** The first pass anchored the header alone to the top-LEFT corner (the
label's original position, just lifted out of flow) — this LOOKED right in a
narrow viewport screenshot, but a real-browser measurement at the two
acceptance viewports (a small Playwright probe reading
`getBoundingClientRect()` for the header vs. the hero's title/meta blocks,
mirroring the W277 aspect-ratio gotcha's own "measure it, don't just read the
CSS" method) showed the header's box directly overlapping the hero title text
at BOTH 1920×1080 and 1512×982: the hero copy (`.rgp-tv-hero__content`) is
left-aligned, and at the tuned 26vh hero height its title/subtitle/chip stack
can reach close to the hero's own top edge on that same left side (v0.28 W277
already measured this margin as tight, not generous). Moving the whole group
to the top-RIGHT corner — clear of the left-aligned copy at every viewport this
hero geometry is tuned for, and already an established chrome corner (the
exit/menu buttons) — resolved the overlap with zero measured collision at
either viewport.

**Legibility.** The hero's own gradient scrim is anchored bottom/left for the
copy band and doesn't reach the top-right corner, so the label needed its own
small wash rather than relying on the hero's: a new `--rgp-tv-banner-scrim`
token (tv.css, the same `color-mix(in oklch, var(--aura-bg) …, transparent)`
recipe as the hero scrim and the W273 preview scrim) is applied as the header's
own background, scoped tightly to the label's own padded box — never a
full-width/height gradient — so it reads over bright key art without dimming
the cinematic frame the way a second full scrim would.

**Gotcha carried forward from W277 (documented, not hit here):** CSS
`aspect-ratio` needs a bare `<ratio>` (`320 / 440`), never `<length>`s
(`320px / 440px` silently resolves to `auto`) — irrelevant to this change (no
aspect-ratio box involved) but worth re-flagging since this item shares the
overlap technique family with W277, and its own top-left/top-right lesson
above is the same genre of "verify against a real render" mistake.

**Verified (measured, both acceptance viewports — 1920×1080, 1512×982):** more
rail content is visible immediately below the hero (no header-row band to
scroll past); the hero copy band (title/subtitle/chips/play) is unaffected —
it was never under the header's old row, and the relocated top-right group has
zero measured bounding-box overlap with the hero's title or meta blocks at
either viewport; controller nav is unaffected (the header was never a focus
target, and the exit/menu buttons keep their same relative order/spacing,
just regrouped under the shared column).

**Files:** `src/features/tv/tv-shell.css` (header + chrome buttons regrouped
into `.rgp-tv-shell__top-chrome`, off the flex flow and onto the hero's
top-right corner), `src/features/tv/TvShell.tsx` (markup regrouped to match),
`src/theme/tv.css` (`--rgp-tv-banner-scrim` token).

## v0.37 "Trophies" (W377) — drop the chrome header + scrims, drop-shadow legibility

User directive (verbatim, 2026-07-06): *"Revise aesthetics of TV mode: Remove
Retro Game Player header and the dark background overlay. Instead, give text
a drop shadow to aid with legibility."* Landed immediately after W375/W376 in
the same release; three parts.

**1 — the "Retro Game Player" label is gone.** W375 (above) had already pulled
the section-label header out of the layout flow and grouped it with the
Menu/Exit buttons into one top-right column (`.rgp-tv-shell__top-chrome`) so
it no longer reserved its own row — W377 goes further and removes the label
itself entirely: `<header className="rgp-tv-shell__header">` and its
`<span className="rgp-tv-shell__label">Retro Game Player</span>` are deleted
from `TvShell.tsx`, along with the `.rgp-tv-shell__header` / `.rgp-tv-shell__label`
rules (tv-shell.css). The top-chrome column now holds only the Menu/Exit
buttons — no chrome row reserves space for the label, and nothing replaces it
(no new banner, no icon). The buttons keep their existing top-right position
and relative order.

**2 — both dark background overlays are gone.** Two scrim layers are deleted
outright, not merely dimmed:

- `.rgp-tv-hero__scrim` (tv-home.css) — the bottom/left gradient wash under
  the hero copy — and its markup (`<div className="rgp-tv-hero__scrim" aria-hidden />`
  in `TvHero.tsx`).
- `.rgp-tv-home__preview-scrim` (tv-home.css) — the `color-mix(... 45% ...)`
  dark wash over the W273 live attract preview — and its markup
  (`<div className="rgp-tv-home__preview-scrim" />` in `TvHome.tsx`).

Backdrop key art and attract previews now render un-dimmed, full-brightness,
exactly as sourced — nothing between the art and the viewer.

**3 — every TV text surface over art gets a drop shadow instead.** Rather than
each surface re-deriving its own shadow recipe, one token,
`--rgp-tv-text-shadow` (theme/tv.css), generalizes the recipe the hero title
already used pre-W377 (`0 2px 1rem color-mix(in oklch, var(--aura-bg) 80%,
transparent)` — a soft shadow lifted from the same bg-token color-mix the
removed scrims used, just applied to the glyph instead of a background rect).
Applied to:

- hero title (already had this exact shadow inline; now reads the shared
  token instead of its own literal), subtitle, and play-time/last-played chips
  (`.rgp-tv-hero__title` / `__subtitle` / `__chip`, tv-home.css);
- rail titles (`.rgp-tv-rail__label`) — these sit in the rail-overlap band
  directly over the hero's lower art band (v0.28 W277), which is now unwashed;
- tile captions (`.rgp-tv-tile__caption`) — sit immediately under each tile's
  cover art with no background of their own;
- the shell's Menu/Exit chrome buttons (`.rgp-tv-shell__menu`,
  `.rgp-tv-shell__exit`, tv-shell.css) — their semi-transparent
  `--aura-shelf-alpha` fill alone can wash out over bright hero art now that
  the header's own scrim (which used to sit right beside them) is gone.

The hero's play button (`.rgp-tv-hero__play`) is intentionally left off this
list — it sits on a solid `--aura-primary` pill background, not directly on
art, so it was never scrim-dependent and a text-shadow there would look odd
against its own opaque fill. The focus treatments (tile/hero scale, ring,
glow, dim-opacity) and controller-nav behavior are untouched — this item only
removed background layers and added foreground shadows, no focus-model
change.

**Not touched (owned by W376, concurrently in flight):** the attract-preview
*wiring* (`useAttractDwell.ts`, `TvHome`'s dwell/session logic, the
`NativePlayer` mount) — only the CSS/markup that painted the scrim OVER the
preview was removed here, nothing that mounts or drives it.

**Verified (screenshots, both acceptance viewports — 1920×1080, 1512×982):**
`recipe.py smoke`'s `tv-home` / `tv-takeover` / `tv-system-menu` /
`tv-embedded-screen` visual-inspection routes render with no "Retro Game
Player" label, no chrome row reserved for it, un-dimmed backdrop art, and
legible text (title/subtitle/chips/rail-labels/tile-captions/Menu/Exit) via
drop shadow alone.

**Files:** `src/features/tv/TvShell.tsx` (label markup removed), `src/features/tv/tv-shell.css`
(`.rgp-tv-shell__header`/`__label` rules removed; text-shadow added to
Menu/Exit buttons), `src/features/tv/TvHero.tsx` (scrim div removed),
`src/features/tv/TvHome.tsx` (preview-scrim div removed), `src/features/tv/tv-home.css`
(`.rgp-tv-hero__scrim` / `.rgp-tv-home__preview-scrim` rules removed;
text-shadow added to hero title/subtitle/chips, rail label, tile caption),
`src/theme/tv.css` (`--rgp-tv-banner-scrim` token removed; new
`--rgp-tv-text-shadow` token added).

## Follow-ups

- CRT display filters over gameplay (#23, v0.29) — **implemented, W280** (see
  above; full design in crt-filter-design.md).
- Attract-mode idle screensaver (rolling game art) in TV home.
- Collections rail once full #21 lands.
- EmulatorJS-path attract previews (save-suppression through the iframe glue)
  — W273's recorded v1 scope cut.
- **Controller-drivable GetCorePanel in the takeover (W275 audit #23):** the
  panel's "Get core" button is pointer/keyboard-only; the takeover's fallback
  claim deliberately swallows `confirm` (only `back` exits). A 10-foot
  affordance would register the button as a focus target and route confirm to
  it — needs a small focus wiring pass in `GetCorePanel`, not just CSS.
- **Gate the hero-art→preview handoff on the first painted frame (W275 audit
  #22):** `TvHome` flips `artHandedOff` the instant the preview layer mounts,
  so the hero art crossfades out over a still-black canvas for the boot beat —
  and flashes black briefly when a preview's start FAILS before the silent
  fallback unmounts it. Threading a "first frame painted" signal out of
  `NativePlayer`'s frame loop would make the handoff seamless and make a
  failed preview visually invisible.
- **Route embedded game-detail play through the TV takeover (W278):** an
  embedded `/game/:id` currently boots the desktop-style in-page player inside
  the outlet rather than `TvGameSurface`'s fullscreen takeover chrome.
- **Per-screen 10-foot restyling of embedded desktop screens (W278):** the
  embedded region gets one uniform `zoom` scale-up knob; bespoke TV layouts
  for Consoles/Search/Cores/Settings are out of scope for now.
- **A TV-scaled `HintBar` (W278):** TV mode has never rendered a hint bar: the
  Select/touchpad system-menu gesture's only on-screen discoverability today
  is the visible ☰ Menu button, not a controller-glyph hint.
