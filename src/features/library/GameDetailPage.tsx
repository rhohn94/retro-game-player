// GameDetailPage — the per-game detail screen at "/game/:id" (W13;
// harmony-ux-design.md §2; v0.31 W315 non-retro detail treatment).
//
// Archetype: Detail / Focus. Loads the game via `get_game`, renders its cover +
// metadata over the same pre-blurred HeroBackdrop, and exposes a primary Launch
// action wired to `launch_game` plus a secondary "Get art" (fetch_boxart). The
// Back control returns to the grid. Buttons and metadata rows are focusable with
// a visible focus ring so the screen is controller-navigation-ready (gamepad
// polling is W14). Panel uses --aura-panel-alpha so vibrancy reads through.
//
// A non-retro row (Steam/App/Manual, v0.31 W310) has no ROM/core/emulator to
// speak of: `<PlaySwitch>` (in-page play), "Refresh metadata"/"Get art"
// (ROM-hash-driven enrichment), "Find downloads", and the CRC32/MD5/core
// metadata rows all assume a ROM identity, so they are hidden for it
// (non-retro-library-design.md §UI: "detail page hides emulator-specific
// affordances … and shows 'Launches via Steam / macOS'"). The Play button
// itself is NOT hidden — `launch_game` already dispatches on the game's
// launch descriptor (v0.31 W311), so the same button launches externally.

import { AuraButton, AuraCard } from "@aura/react";
import { openUrl } from "../../ipc/opener";
import { motion } from "framer-motion";
import { SPRING } from "../../lib/motion";
import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { enrichGameMetadata, fetchBoxart, getGame, launchGame, setFavorite } from "../../ipc/commands";
import type { Game } from "../../ipc/commands";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { LoadingState } from "../../components/LoadingState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { artUrl } from "./art";
import { CollectionPicker } from "./CollectionPicker";
import { HeroBackdrop } from "./HeroBackdrop";
import { isNonRetro, launchesViaLabel, sourceBadgeLabel } from "./sourceBadge";
import { useBoxart } from "./useBoxart";
import { PlaySwitch } from "../play";
import { useAttractPresentation } from "../play/useAttractPresentation";
import { swallow } from "../../ipc/swallow";

/** Human-readable byte size. */
function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

/** One labelled metadata row in the detail panel. */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rgp-detail__row" tabIndex={0}>
      <span className="rgp-detail__row-label">{label}</span>
      <span className="rgp-detail__row-value">{value}</span>
    </div>
  );
}

/** The game detail screen. */
export function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [artOverride, setArtOverride] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);

  const gameId = Number(id);

  // W235 attract mode: scrolling the player slot mostly out of view hands
  // the live native game to the page background (dimmed, input detached,
  // audio ducked); scrolling back reattaches it. Hysteresis lives in the hook.
  const playSlotRef = useRef<HTMLDivElement>(null);
  const presentation = useAttractPresentation(playSlotRef);

  useCancellableEffect(
    (isCancelled) => {
      if (!Number.isFinite(gameId)) {
        setError("Invalid game id");
        return;
      }
      getGame(gameId)
        .then((g) => {
          if (!isCancelled()) {
            setGame(g);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!isCancelled()) setError(err instanceof Error ? err.message : String(err));
        });
    },
    [gameId],
  );

  const resolvedArt = useBoxart(game, true);
  const art = artOverride ?? resolvedArt;
  const nonRetro = game != null && isNonRetro(game);

  const onLaunch = useCallback(() => {
    if (!game) return;
    setLaunchError(null);
    void launchGame(game.id).catch((err: unknown) => {
      setLaunchError(err instanceof Error ? err.message : String(err));
    });
  }, [game]);

  // Favorite toggle (v0.26 "library life", W264): optimistic — flips the
  // local flag immediately, then persists; a failed persist reverts so the
  // displayed state never drifts from the database's.
  const onToggleFavorite = useCallback(() => {
    if (!game) return;
    const next = !game.favorite;
    setGame({ ...game, favorite: next });
    void setFavorite(game.id, next).catch((err: unknown) => {
      setGame((current) =>
        current && current.id === game.id ? { ...current, favorite: !next } : current,
      );
      swallow(err, "GameDetailPage.toggleFavorite");
    });
  }, [game]);

  const onGetArt = useCallback(() => {
    if (!game) return;
    void fetchBoxart(game.id)
      .then((path) => {
        if (path) setArtOverride(artUrl(path));
      })
      .catch((err: unknown) => swallow(err, "GameDetailPage.getArt"));
  }, [game]);

  // Auto-download cover art + a Wikipedia description, then refresh in place.
  const onRefreshMetadata = useCallback(() => {
    if (!game || enriching) return;
    setEnriching(true);
    void enrichGameMetadata(game.id)
      .then((updated) => {
        setGame(updated);
        if (updated.artPath) setArtOverride(artUrl(updated.artPath));
      })
      .catch((err: unknown) => swallow(err, "GameDetailPage.refreshMetadata"))
      .finally(() => setEnriching(false));
  }, [game, enriching]);

  if (error) {
    return (
      <div className="rgp-detail">
        <AuraButton class="rgp-detail__back" onClick={() => navigate(-1)}>
          ◀ Back
        </AuraButton>
        <ErrorNotice>Could not load game: {error}</ErrorNotice>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="rgp-detail">
        <LoadingState>Loading…</LoadingState>
      </div>
    );
  }

  return (
    <div className="rgp-detail">
      <HeroBackdrop game={game} />

      <motion.div
        className="rgp-detail__content"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING.gentle}
      >
        <AuraButton class="rgp-detail__back" onClick={() => navigate(-1)}>
          ◀ Back
        </AuraButton>

        {/* A non-retro row has no in-page/native player to mount — skipping
            the slot entirely avoids reserving its layout space (attract-mode
            ref) for a surface that will never appear, and keeps PlaySwitch's
            external-only notice (which needs a real system key) out of the
            non-retro layout. */}
        {!nonRetro && (
          <div ref={playSlotRef}>
            <PlaySwitch
              gameId={game.id}
              system={game.system ?? ""}
              gameName={game.cleanName}
              presentation={presentation}
            />
          </div>
        )}

        <div className="rgp-detail__body">
          <AuraCard class="rgp-detail__cover">
            {art ? (
              <img src={art} alt="" className="rgp-detail__cover-img" />
            ) : (
              <span className="rgp-detail__cover-ph">
                {nonRetro ? sourceBadgeLabel(game.source) : game.system}
              </span>
            )}
          </AuraCard>

          <div className="rgp-detail__info">
            <div className="rgp-detail__title-row">
              <h1 className="rgp-detail__title">{game.cleanName}</h1>
              {nonRetro && (
                <span className="rgp-detail__source-badge">
                  {sourceBadgeLabel(game.source)}
                </span>
              )}
              <button
                type="button"
                className="rgp-detail__favorite"
                onClick={onToggleFavorite}
                aria-pressed={game.favorite}
                aria-label={game.favorite ? "Remove from favorites" : "Add to favorites"}
              >
                {game.favorite ? "♥" : "♡"}
              </button>
              <CollectionPicker gameId={game.id} />
            </div>
            {nonRetro ? (
              <p className="rgp-detail__subtitle">{launchesViaLabel(game.source)}</p>
            ) : (
              <p className="rgp-detail__subtitle">
                {game.system}
                {game.datMatched ? " · DAT-matched ✓" : ""} · {formatSize(game.sizeBytes)}
              </p>
            )}
            {game.coreHint && !nonRetro && (
              <p className="rgp-detail__core">Core: {game.coreHint}</p>
            )}

            <div className="rgp-detail__actions">
              <AuraButton class="rgp-detail__play" onClick={onLaunch}>
                ▶ Play
              </AuraButton>
              {/* Refresh metadata / Get art / Find downloads are all ROM-hash-
                  driven (enrichment matches on crc32/md5; the search flow looks
                  for a ROM to download) — meaningless for a non-retro row, so
                  they are hidden rather than shown broken (v0.31 W315). */}
              {!nonRetro && (
                <>
                  <AuraButton
                    class="rgp-detail__secondary"
                    onClick={onRefreshMetadata}
                    disabled={enriching}
                  >
                    {enriching ? "Fetching metadata…" : "Refresh metadata"}
                  </AuraButton>
                  <AuraButton class="rgp-detail__secondary" onClick={onGetArt}>
                    Get art
                  </AuraButton>
                  <AuraButton
                    class="rgp-detail__secondary"
                    onClick={() =>
                      navigate("/search", { state: { query: game.cleanName } })
                    }
                  >
                    Find downloads
                  </AuraButton>
                </>
              )}
            </div>

            {launchError && (
              <ErrorNotice>Launch failed: {launchError}</ErrorNotice>
            )}

            {game.description && (
              <div className="rgp-detail__about">
                <p className="rgp-detail__desc">{game.description}</p>
                {game.wikipediaUrl && (
                  <button
                    type="button"
                    className="rgp-detail__wiki"
                    onClick={() =>
                      void openUrl(game.wikipediaUrl!).catch((err: unknown) =>
                        swallow(err, "GameDetailPage.openWikipediaUrl", "info"),
                      )
                    }
                  >
                    Read more on Wikipedia ↗
                  </button>
                )}
              </div>
            )}

            <div className="rgp-detail__meta">
              <MetaRow label="Path" value={game.path ?? "—"} />
              <MetaRow label="System" value={game.system ?? "—"} />
              {/* CRC32/MD5 are ROM-identity fields — always "—" for a non-retro
                  row, so the rows are omitted rather than shown as dead
                  placeholders (v0.31 W315). */}
              {!nonRetro && (
                <>
                  <MetaRow label="CRC32" value={game.crc32 ?? "—"} />
                  <MetaRow label="MD5" value={game.md5 ?? "—"} />
                </>
              )}
              <MetaRow label="Size" value={formatSize(game.sizeBytes)} />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
