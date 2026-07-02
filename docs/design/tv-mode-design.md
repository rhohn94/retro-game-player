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
- **Tokens**: `src/theme/tv.css` defines the `*-tv` scale (type ramp ×1.6–2.0,
  tile 320×440, safe-area insets, rail gap) inside the existing cascade
  layers; components consume tokens only (token-adoption guard applies).
- **Shelves**: `TvHome.tsx` composes `<TvHero/>` + `<TvRail/>` list. Rails are
  virtualized-light (windowed rendering ≥50 items). Rail rows register with
  the spatial-focus registry; left/right moves within a rail, up/down across
  rails, with per-rail focus memory. `TvRail` sources: `list_recent`,
  `list_favorites`, recently-added (existing `added_at`), per-system queries.
- **Hero**: focused-game key art via the high-res tier
  ([metadata-art-design.md](metadata-art-design.md)); crossfade ≤300ms on
  focus settle (debounced ~150ms), gradient scrim for legibility.
- **Transitions**: Framer Motion shared-layout takeover from tile →
  fullscreen player surface; player boot happens *under* the expanding tile
  art so the swap is invisible; exit reverses to the originating tile
  (scroll restored first). All durations/easings from the motion source.
- **Auto-enter**: `AppConfig.auto_tv_mode: bool` (Rust `config/mod.rs`,
  default `false`) + `get_config`/`set_config` IPC already present; on mount,
  `App.tsx` reads config and calls `enter()` once when set.
- **Controller**: TV mode raises no new input layer — it registers ordinary
  focus targets; `back` at TV home exits TV mode (with confirm), `menu`
  long-press toggles TV mode anywhere outside gameplay.

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
