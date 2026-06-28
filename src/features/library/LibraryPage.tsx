// LibraryPage — the library gallery: hero teaser + pre-blurred backdrop + a
// system-filtered grid of cover-art tiles (W13; harmony-ux-design.md §1).
//
// Archetype: Gallery / Media-grid. Games come from `list_games` (optionally
// filtered by system). The hero block reflects the currently focused game and
// its pre-blurred backdrop crossfades on selection change (HeroBackdrop). Tiles
// are focusable buttons with a visible focus ring so the screen is already
// controller-navigation-ready (the gamepad polling layer is W14). Translucent
// <aura-card> shelves use --aura-shelf/panel-alpha so native vibrancy reads
// through. No CSS blur anywhere — the soft backdrop is the backend bitmap only.

import { AuraButton, AuraCard } from "@aura/react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { launchGame, listGames } from "../../ipc/commands";
import type { Game } from "../../ipc/commands";
import { listContainer, riseIn } from "../../lib/motion";
import { HeroBackdrop } from "./HeroBackdrop";
import { GameTile } from "./GameTile";
import { useBoxart } from "./useBoxart";

const ALL_SYSTEMS = "All";

/** Distinct systems present in the library, prefixed with the "All" filter. */
function systemsOf(games: Game[]): string[] {
  const set = new Set(games.map((g) => g.system));
  return [ALL_SYSTEMS, ...Array.from(set).sort()];
}

/** The large hero teaser over the backdrop: cover + title + system + Play. */
function HeroTeaser({ game }: { game: Game | null }) {
  const art = useBoxart(game, false);
  if (!game) return null;
  return (
    <motion.div
      key={game.id}
      initial={riseIn.initial}
      animate={riseIn.animate}
      transition={riseIn.transition}
    >
      <AuraCard class="harmony-hero">
        <div className="harmony-hero__cover">
          {art ? (
            <img src={art} alt="" className="harmony-hero__cover-img" />
          ) : (
            <span className="harmony-hero__cover-ph">{game.system}</span>
          )}
        </div>
        <div className="harmony-hero__meta">
          <h2 className="harmony-hero__title">{game.cleanName}</h2>
          <p className="harmony-hero__system">{game.system}</p>
          <AuraButton
            class="harmony-hero__play"
            onClick={() => void launchGame(game.id).catch(() => undefined)}
          >
            ▶ Play
          </AuraButton>
        </div>
      </AuraCard>
    </motion.div>
  );
}

/** The library gallery screen mounted at "/". */
export function LibraryPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<string>(ALL_SYSTEMS);
  const [focused, setFocused] = useState<Game | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listGames()
      .then((rows) => {
        if (cancelled) return;
        setGames(rows);
        setFocused((prev) => prev ?? rows[0] ?? null);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const systems = useMemo(() => systemsOf(games), [games]);
  const visible = useMemo(
    () => (system === ALL_SYSTEMS ? games : games.filter((g) => g.system === system)),
    [games, system],
  );

  return (
    <div className="harmony-library">
      <HeroBackdrop game={focused} />

      <div className="harmony-library__content">
        <HeroTeaser game={focused} />

        <div className="harmony-tabs" role="tablist" aria-label="System filter">
          {systems.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === system}
              className={s === system ? "harmony-tab harmony-tab--active" : "harmony-tab"}
              onClick={() => setSystem(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {loading && <p className="harmony-muted">Loading library…</p>}
        {error && (
          <AuraCard class="harmony-notice">Could not load games: {error}</AuraCard>
        )}
        {!loading && !error && visible.length === 0 && (
          <p className="harmony-muted">
            No games yet — add a content folder in Settings to scan your library.
          </p>
        )}

        <motion.div
          className="harmony-grid"
          variants={listContainer}
          initial="hidden"
          animate="visible"
        >
          {visible.map((game) => (
            <GameTile
              key={game.id}
              game={game}
              onFocusGame={setFocused}
              onOpen={(g) => navigate(`/game/${g.id}`)}
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}
