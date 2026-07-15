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
import { launchGame, listGames, listCatalogTitles, listConsoles } from "../../ipc/commands";
import type { Game, CatalogTitle, ConsoleInfo } from "../../ipc/commands";
import { listCollections, listGamesByCollection, type CollectionWithCount } from "../../ipc/collections";
import { listContainer, riseIn } from "../../lib/motion";
import { LoadingState } from "../../components/LoadingState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { EmptyState } from "../../components/EmptyState";
import { CreateGamesFolderDialog } from "./CreateGamesFolderDialog";
import { HeroBackdrop } from "./HeroBackdrop";
import { GameTile } from "./GameTile";
import { CatalogGameTile } from "./CatalogGameTile";
import { useBoxart } from "./useBoxart";
import { LibraryFilters } from "./LibraryFilters";
import { pickRomFiles, runImport, summarizeImport } from "./import";
import { EMPTY_CRITERIA, facetValues, filterGames, type FilterCriteria } from "./filter";
import { swallow } from "../../ipc/swallow";
import {
  loadCatalogMode,
  saveCatalogMode,
  loadGlobalConsoleKey,
  saveGlobalConsoleKey,
  type CatalogMode,
} from "./catalogMode";

const GLOBAL_PAGE_SIZE = 48;

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
      <AuraCard class="rgp-hero">
        <div className="rgp-hero__cover">
          {art ? (
            <img src={art} alt="" className="rgp-hero__cover-img" />
          ) : (
            <span className="rgp-hero__cover-ph">{game.system}</span>
          )}
        </div>
        <div className="rgp-hero__meta">
          <h2 className="rgp-hero__title">{game.cleanName}</h2>
          <p className="rgp-hero__system">{game.system}</p>
          <AuraButton
            class="rgp-hero__play"
            onClick={() =>
              void launchGame(game.id).catch((err: unknown) =>
                swallow(err, "LibraryPage.HeroTeaser.launch"),
              )
            }
          >
            ▶ Play
          </AuraButton>
        </div>
      </AuraCard>
    </motion.div>
  );
}

/** The library gallery screen mounted at "/". Supports Personal | Global catalog. */
export function LibraryPage() {
  const navigate = useNavigate();
  const [catalogMode, setCatalogModeState] = useState<CatalogMode>(() => loadCatalogMode());
  const setCatalogMode = useCallback((mode: CatalogMode) => {
    setCatalogModeState(mode);
    saveCatalogMode(mode);
  }, []);
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [criteria, setCriteria] = useState<FilterCriteria>(EMPTY_CRITERIA);
  const [focused, setFocused] = useState<Game | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  // Collections (v0.37 W373): every collection (for the filter select) plus
  // the resolved member-id set for whichever collection is currently
  // selected in `criteria.collectionId`.
  const [collections, setCollections] = useState<CollectionWithCount[]>([]);
  const [collectionMemberIds, setCollectionMemberIds] = useState<ReadonlySet<number> | null>(null);

  // Global Catalog (bundled title index — paged, console-scoped).
  const [consoles, setConsoles] = useState<ConsoleInfo[]>([]);
  const [globalSystem, setGlobalSystem] = useState(() => loadGlobalConsoleKey("nes"));
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalOffset, setGlobalOffset] = useState(0);
  const [globalItems, setGlobalItems] = useState<CatalogTitle[]>([]);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [focusedCatalog, setFocusedCatalog] = useState<CatalogTitle | null>(null);

  useEffect(() => {
    let cancelled = false;
    listConsoles()
      .then((rows) => {
        if (cancelled) return;
        setConsoles(rows);
        // Prefer a console that has a catalog if stored key is missing.
        setGlobalSystem((prev) => {
          if (rows.some((c) => c.key === prev)) return prev;
          const withCatalog = rows.find((c) => c.catalogCount > 0);
          const key = withCatalog?.key ?? rows[0]?.key ?? "nes";
          saveGlobalConsoleKey(key);
          return key;
        });
      })
      .catch((err: unknown) => swallow(err, "LibraryPage.listConsoles"));
    return () => {
      cancelled = true;
    };
  }, []);

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

  const loadCollections = useCallback(() => {
    let cancelled = false;
    listCollections()
      .then((rows) => {
        if (!cancelled) setCollections(rows);
      })
      .catch((err: unknown) => swallow(err, "LibraryPage.loadCollections"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadCollections(), [loadCollections]);

  // Resolve the member-id set whenever the selected collection changes. Reset
  // to null (not stale) the instant the selection changes so `filterGames`
  // never briefly shows the PREVIOUS collection's members under the new
  // selection while the fetch is in flight.
  useEffect(() => {
    if (criteria.collectionId == null) {
      setCollectionMemberIds(null);
      return;
    }
    let cancelled = false;
    setCollectionMemberIds(null);
    listGamesByCollection(criteria.collectionId)
      .then((members) => {
        if (!cancelled) setCollectionMemberIds(new Set(members.map((g) => g.id)));
      })
      .catch((err: unknown) => {
        swallow(err, "LibraryPage.loadCollectionMembers");
        if (!cancelled) setCollectionMemberIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [criteria.collectionId]);

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

  // Load Global Catalog page when mode/system/query/offset change.
  useEffect(() => {
    if (catalogMode !== "global" || !globalSystem) return;
    let cancelled = false;
    setGlobalLoading(true);
    const trimmed = globalQuery.trim();
    const handle = window.setTimeout(
      () => {
        listCatalogTitles(globalSystem, trimmed || undefined, globalOffset, GLOBAL_PAGE_SIZE)
          .then((page) => {
            if (cancelled) return;
            setGlobalItems(page.items);
            setGlobalTotal(page.total);
            setGlobalError(null);
            setFocusedCatalog((prev) => prev ?? page.items[0] ?? null);
          })
          .catch((err: unknown) => {
            if (!cancelled) {
              setGlobalItems([]);
              setGlobalTotal(0);
              setGlobalError(err instanceof Error ? err.message : String(err));
            }
          })
          .finally(() => {
            if (!cancelled) setGlobalLoading(false);
          });
      },
      trimmed ? 180 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [catalogMode, globalSystem, globalQuery, globalOffset]);

  // Reset page when console or query changes.
  useEffect(() => {
    setGlobalOffset(0);
  }, [globalSystem, globalQuery]);

  const facets = useMemo(() => facetValues(games), [games]);
  const visible = useMemo(
    () => filterGames(games, criteria, collectionMemberIds),
    [games, criteria, collectionMemberIds],
  );

  const isGlobal = catalogMode === "global";
  const globalHasPrev = globalOffset > 0;
  const globalHasNext = globalOffset + GLOBAL_PAGE_SIZE < globalTotal;

  const openCatalogEntry = useCallback(
    (entry: CatalogTitle) => {
      if (entry.owned && entry.gameId != null) {
        navigate(`/game/${entry.gameId}`);
        return;
      }
      navigate(`/catalog/${encodeURIComponent(entry.system)}/${encodeURIComponent(entry.title)}`);
    },
    [navigate],
  );

  const setGlobalSystemPersist = useCallback((key: string) => {
    setGlobalSystem(key);
    saveGlobalConsoleKey(key);
  }, []);

  // Hero for Global: fake a minimal Game-shaped object for backdrop when focused catalog.
  const globalHeroGame: Game | null = useMemo(() => {
    if (!focusedCatalog) return null;
    if (focusedCatalog.owned && focusedCatalog.gameId != null) {
      return games.find((g) => g.id === focusedCatalog.gameId) ?? null;
    }
    return {
      id: -1,
      path: null,
      system: focusedCatalog.system,
      crc32: null,
      md5: null,
      cleanName: focusedCatalog.title,
      datMatched: false,
      coreHint: null,
      artPath: null,
      sizeBytes: 0,
      addedAt: 0,
      year: null,
      developer: null,
      publisher: null,
      aliases: [],
      description: null,
      wikipediaUrl: null,
      favorite: false,
      lastPlayedAt: null,
      playCount: 0,
      totalPlayTimeMs: 0,
      source: "rom",
      launchDescriptor: null,
      externalId: null,
    };
  }, [focusedCatalog, games]);

  return (
    <div className="rgp-library">
      <HeroBackdrop game={isGlobal ? globalHeroGame : focused} />

      {dragOver && !isGlobal && (
        <div className="rgp-dropzone" aria-hidden>
          <div className="rgp-dropzone__inner">⬇ Drop ROMs to import</div>
        </div>
      )}

      <div className="rgp-library__content">
        {isGlobal ? (
          focusedCatalog && (
            <motion.div
              key={focusedCatalog.catalogId}
              initial={riseIn.initial}
              animate={riseIn.animate}
              transition={riseIn.transition}
            >
              <AuraCard class="rgp-hero">
                <div className="rgp-hero__cover">
                  <span className="rgp-hero__cover-ph">{focusedCatalog.system}</span>
                </div>
                <div className="rgp-hero__meta">
                  <h2 className="rgp-hero__title">{focusedCatalog.title}</h2>
                  <p className="rgp-hero__system">{focusedCatalog.system}</p>
                  {focusedCatalog.owned && focusedCatalog.gameId != null ? (
                    <AuraButton
                      class="rgp-hero__play"
                      onClick={() => navigate(`/game/${focusedCatalog.gameId}`)}
                    >
                      ▶ Play
                    </AuraButton>
                  ) : (
                    <AuraButton
                      class="rgp-hero__play"
                      onClick={() => openCatalogEntry(focusedCatalog)}
                    >
                      Find downloads
                    </AuraButton>
                  )}
                </div>
              </AuraCard>
            </motion.div>
          )
        ) : (
          <HeroTeaser game={focused} />
        )}

        <div className="rgp-library__toolbar" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="rgp-catalog-mode" role="group" aria-label="Catalog mode">
            <button
              type="button"
              className="rgp-catalog-mode__btn"
              aria-pressed={!isGlobal}
              onClick={() => setCatalogMode("personal")}
            >
              Personal catalog
            </button>
            <button
              type="button"
              className="rgp-catalog-mode__btn"
              aria-pressed={isGlobal}
              onClick={() => setCatalogMode("global")}
            >
              Global catalog
            </button>
          </div>
          {!isGlobal && (
            <>
              <AuraButton variant="primary" onClick={onPickImport} disabled={importing}>
                {importing ? "Importing…" : "＋ Import games"}
              </AuraButton>
              <span className="rgp-muted rgp-library__hint">
                …or drag ROM files anywhere onto the window.
              </span>
              {importNote && <span className="rgp-library__note">{importNote}</span>}
            </>
          )}
          {isGlobal && (
            <span className="rgp-muted rgp-library__hint">
              Browse every known title for a console. Open a game you own to Play, or Find
              downloads for titles you do not have yet.
            </span>
          )}
        </div>

        {isGlobal ? (
          <div className="rgp-filters" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <label className="rgp-facet">
              <span className="rgp-facet__label">Console</span>
              <select
                className="rgp-facet__select"
                value={globalSystem}
                onChange={(e) => setGlobalSystemPersist(e.target.value)}
                aria-label="Global catalog console"
              >
                {consoles.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.abbreviation || c.name} ({c.catalogCount.toLocaleString()} titles)
                  </option>
                ))}
              </select>
            </label>
            <label className="rgp-facet" style={{ flex: 1, minWidth: 160 }}>
              <span className="rgp-facet__label">Search</span>
              <input
                className="rgp-input"
                type="search"
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder="Filter titles…"
                aria-label="Filter global catalog titles"
                style={{ width: "100%" }}
              />
            </label>
          </div>
        ) : (
          <LibraryFilters
            facets={facets}
            criteria={criteria}
            onChange={setCriteria}
            collections={collections}
          />
        )}

        {isGlobal ? (
          <>
            {globalLoading && <LoadingState>Loading catalog…</LoadingState>}
            {globalError && <ErrorNotice>Could not load catalog: {globalError}</ErrorNotice>}
            {!globalLoading && !globalError && globalItems.length === 0 && (
              <EmptyState>
                {globalQuery.trim()
                  ? "No titles match your search."
                  : "No catalog titles for this console."}
              </EmptyState>
            )}
            <motion.div
              className="rgp-grid"
              role="list"
              aria-label="Global catalog games"
              variants={listContainer}
              initial="hidden"
              animate="visible"
            >
              {globalItems.map((entry) => (
                <CatalogGameTile
                  key={entry.catalogId}
                  entry={entry}
                  onFocusEntry={setFocusedCatalog}
                  onOpen={openCatalogEntry}
                />
              ))}
            </motion.div>
            {(globalHasPrev || globalHasNext) && (
              <div className="rgp-library__pager">
                <AuraButton
                  variant="ghost"
                  disabled={!globalHasPrev}
                  onClick={() => setGlobalOffset((o) => Math.max(0, o - GLOBAL_PAGE_SIZE))}
                >
                  ◀ Prev
                </AuraButton>
                <span className="rgp-muted">
                  {globalTotal === 0
                    ? "0 titles"
                    : `${globalOffset + 1}–${Math.min(globalOffset + GLOBAL_PAGE_SIZE, globalTotal)} of ${globalTotal.toLocaleString()}`}
                </span>
                <AuraButton
                  variant="ghost"
                  disabled={!globalHasNext}
                  onClick={() => setGlobalOffset((o) => o + GLOBAL_PAGE_SIZE)}
                >
                  Next ▶
                </AuraButton>
              </div>
            )}
          </>
        ) : (
          <>
            {loading && <LoadingState>Loading library…</LoadingState>}
            {error && <ErrorNotice>Could not load games: {error}</ErrorNotice>}
            {!loading && !error && games.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
                <p className="rgp-muted" style={{ margin: 0 }}>
                  No games yet — import a ROM (drag it in or pick a file), create a
                  games folder, switch to Global catalog to discover titles, or add a
                  content folder in Settings.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <AuraButton variant="primary" onClick={onPickImport} disabled={importing}>
                    {importing ? "Importing…" : "＋ Import games"}
                  </AuraButton>
                  <AuraButton variant="ghost" onClick={() => setCatalogMode("global")}>
                    Browse Global catalog
                  </AuraButton>
                  <AuraButton variant="ghost" onClick={() => setShowCreate(true)}>
                    Create a games folder for me
                  </AuraButton>
                </div>
              </div>
            )}
            {!loading && !error && games.length > 0 && visible.length === 0 && criteria.collectionId != null && (
              <EmptyState>This collection is empty.</EmptyState>
            )}
            {!loading && !error && games.length > 0 && visible.length === 0 && criteria.collectionId == null && (
              <EmptyState>No games match your filters.</EmptyState>
            )}

            <motion.div
              className="rgp-grid"
              role="list"
              aria-label="Games"
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
          </>
        )}
      </div>

      <CreateGamesFolderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => loadGames()}
      />
    </div>
  );
}
