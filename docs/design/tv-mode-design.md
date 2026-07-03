# TV mode (10-foot leanback experience)

> **Up:** [↑ Design index](README.md)

## Motivation

The north star is the couch: pick up a controller, browse a beautiful
art-forward library from ten feet away, and be playing seconds later. Today the
app is a desktop-density GUI — small type, mouse-first sidebar, 132px tiles.
TV mode closes epic [#8](https://github.com/rhohn94/harmony/issues/8)
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
  tile 320×440, safe-area insets, rail gap) inside the existing cascade
  layers; components consume tokens only (token-adoption guard applies).
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

- [ ] TV mode can be entered and exited via sidebar button, `Cmd+T`, and
      controller `menu` long-press; enter goes fullscreen, exit restores the
      prior desktop route and window state.
- [ ] With `auto_tv_mode: true`, a fresh launch lands directly in TV home
      (verified via mock-IPC visual inspection).
- [ ] TV home shows hero + ≥3 rails (Continue playing, Favorites, Recently
      added) populated from fixtures; per-console rails appear for systems
      with games.
- [ ] All TV surfaces are fully controller-navigable (rail traversal, hero
      focus, game launch, back-out) with no pointer required.
- [ ] Focus treatment legible at distance: focused tile scales ≥1.08 with a
      high-contrast ring; rails snap the focused tile fully into view.
- [ ] Launching from a tile plays the takeover animation and boots the game
      with sound (no manual play gate); exiting returns to the same rail +
      tile position.
- [ ] Type/spacing/margins come from `*-tv` tokens; token-adoption and motion
      guards stay green; `prefers-reduced-motion` disables the flourishes.
- [ ] `recipe.py smoke` passes with TV routes included in visual inspection.

## Open questions

- Per-console rail cap (all 20 systems would be noisy) — start with "systems
  that have ≥1 game", ordered by recency.
- Whether hero uses snap/title art when boxart-only exists — yes, fall back
  boxart → blurred boxart backdrop.

## Follow-ups

- CRT display filters over gameplay (#23, v0.29).
- Attract-mode idle screensaver (rolling game art) in TV home.
- Collections rail once full #21 lands.
