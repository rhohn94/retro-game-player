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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { launchGame, listGames } from "../../ipc/commands";
import type { Game } from "../../ipc/commands";
import { listContainer, riseIn } from "../../lib/motion";
import { CreateGamesFolderDialog } from "./CreateGamesFolderDialog";
import { HeroBackdrop } from "./HeroBackdrop";
import { GameTile } from "./GameTile";
import { useBoxart } from "./useBoxart";
import { LibraryFilters } from "./LibraryFilters";
import { EMPTY_CRITERIA, facetValues, filterGames, type FilterCriteria } from "./filter";

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
  const [criteria, setCriteria] = useState<FilterCriteria>(EMPTY_CRITERIA);
  const [focused, setFocused] = useState<Game | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadGames = useCallback(() => {
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

  useEffect(() => loadGames(), [loadGames]);

  const facets = useMemo(() => facetValues(games), [games]);
  const visible = useMemo(() => filterGames(games, criteria), [games, criteria]);

  return (
    <div className="harmony-library">
      <HeroBackdrop game={focused} />

      <div className="harmony-library__content">
        <HeroTeaser game={focused} />

        <LibraryFilters facets={facets} criteria={criteria} onChange={setCriteria} />

        {loading && <p className="harmony-muted">Loading library…</p>}
        {error && (
          <AuraCard class="harmony-notice">Could not load games: {error}</AuraCard>
        )}
        {!loading && !error && games.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <p className="harmony-muted" style={{ margin: 0 }}>
              No games yet — create a games folder, or add an existing content
              folder in Settings to scan your library.
            </p>
            <AuraButton
              variant="primary"
              events={{ "aura-click": () => setShowCreate(true) }}
            >
              Create a games folder for me
            </AuraButton>
          </div>
        )}
        {!loading && !error && games.length > 0 && visible.length === 0 && (
          <p className="harmony-muted">No games match your filters.</p>
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

      <CreateGamesFolderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => loadGames()}
      />
    </div>
  );
}
