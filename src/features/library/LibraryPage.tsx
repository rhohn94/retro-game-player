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
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { launchGame, listGames } from "../../ipc/commands";
import type { Game } from "../../ipc/commands";
import { listContainer, riseIn } from "../../lib/motion";
import { LoadingState } from "../../components/LoadingState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { EmptyState } from "../../components/EmptyState";
import { CreateGamesFolderDialog } from "./CreateGamesFolderDialog";
import { HeroBackdrop } from "./HeroBackdrop";
import { GameTile } from "./GameTile";
import { useBoxart } from "./useBoxart";
import { LibraryFilters } from "./LibraryFilters";
import { pickRomFiles, runImport, summarizeImport } from "./import";
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
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

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

  // Import a batch of file paths (from the picker or a drop), then refresh.
  const handleImport = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      setImporting(true);
      setImportNote(null);
      try {
        // Refresh once now (new games appear with placeholders) and again once
        // enrichment settles (cover art + descriptions fill in).
        const results = await runImport(paths, () => loadGames());
        setImportNote(summarizeImport(results));
        loadGames();
      } catch (err) {
        setImportNote(err instanceof Error ? err.message : String(err));
      } finally {
        setImporting(false);
      }
    },
    [loadGames],
  );

  const onPickImport = useCallback(() => {
    void (async () => {
      const paths = await pickRomFiles();
      await handleImport(paths);
    })();
  }, [handleImport]);

  // Drag-and-drop import via Tauri's webview drag-drop events. No-op outside a
  // Tauri webview (tests / headless inspection), where the call throws/rejects.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === "enter" || p.type === "over") setDragOver(true);
          else if (p.type === "leave") setDragOver(false);
          else if (p.type === "drop") {
            setDragOver(false);
            void handleImport(p.paths);
          }
        });
        if (active) unlisten = un;
        else un();
      } catch {
        // Not in a Tauri webview — drag-drop import is unavailable here.
      }
    })();
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [handleImport]);

  const facets = useMemo(() => facetValues(games), [games]);
  const visible = useMemo(() => filterGames(games, criteria), [games, criteria]);

  return (
    <div className="harmony-library">
      <HeroBackdrop game={focused} />

      {dragOver && (
        <div className="harmony-dropzone" aria-hidden>
          <div className="harmony-dropzone__inner">⬇ Drop ROMs to import</div>
        </div>
      )}

      <div className="harmony-library__content">
        <HeroTeaser game={focused} />

        <div className="harmony-library__toolbar">
          <AuraButton variant="primary" onClick={onPickImport} disabled={importing}>
            {importing ? "Importing…" : "＋ Import games"}
          </AuraButton>
          <span className="harmony-muted harmony-library__hint">
            …or drag ROM files anywhere onto the window.
          </span>
          {importNote && <span className="harmony-library__note">{importNote}</span>}
        </div>

        <LibraryFilters facets={facets} criteria={criteria} onChange={setCriteria} />

        {loading && <LoadingState>Loading library…</LoadingState>}
        {error && <ErrorNotice>Could not load games: {error}</ErrorNotice>}
        {!loading && !error && games.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <p className="harmony-muted" style={{ margin: 0 }}>
              No games yet — import a ROM (drag it in or pick a file), create a
              games folder, or add an existing content folder in Settings.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <AuraButton variant="primary" onClick={onPickImport} disabled={importing}>
                {importing ? "Importing…" : "＋ Import games"}
              </AuraButton>
              <AuraButton variant="ghost" onClick={() => setShowCreate(true)}>
                Create a games folder for me
              </AuraButton>
            </div>
          </div>
        )}
        {!loading && !error && games.length > 0 && visible.length === 0 && (
          <EmptyState>No games match your filters.</EmptyState>
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
