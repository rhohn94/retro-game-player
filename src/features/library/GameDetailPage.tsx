// GameDetailPage — the per-game detail screen at "/game/:id" (W13;
// harmony-ux-design.md §2).
//
// Archetype: Detail / Focus. Loads the game via `get_game`, renders its cover +
// metadata over the same pre-blurred HeroBackdrop, and exposes a primary Launch
// action wired to `launch_game` plus a secondary "Get art" (fetch_boxart). The
// Back control returns to the grid. Buttons and metadata rows are focusable with
// a visible focus ring so the screen is controller-navigation-ready (gamepad
// polling is W14). Panel uses --aura-panel-alpha so vibrancy reads through.

import { AuraButton, AuraCard } from "@aura/react";
import { openUrl } from "../../ipc/opener";
import { motion } from "framer-motion";
import { SPRING } from "../../lib/motion";
import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { enrichGameMetadata, fetchBoxart, getGame, launchGame } from "../../ipc/commands";
import type { Game } from "../../ipc/commands";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { artUrl } from "./art";
import { HeroBackdrop } from "./HeroBackdrop";
import { useBoxart } from "./useBoxart";
import { PlaySwitch } from "../play";

/** Human-readable byte size. */
function formatSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

/** One labelled metadata row in the detail panel. */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="harmony-detail__row" tabIndex={0}>
      <span className="harmony-detail__row-label">{label}</span>
      <span className="harmony-detail__row-value">{value}</span>
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

  const onLaunch = useCallback(() => {
    if (!game) return;
    setLaunchError(null);
    void launchGame(game.id).catch((err: unknown) => {
      setLaunchError(err instanceof Error ? err.message : String(err));
    });
  }, [game]);

  const onGetArt = useCallback(() => {
    if (!game) return;
    void fetchBoxart(game.id)
      .then((path) => {
        if (path) setArtOverride(artUrl(path));
      })
      .catch(() => undefined);
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
      .catch(() => undefined)
      .finally(() => setEnriching(false));
  }, [game, enriching]);

  if (error) {
    return (
      <div className="harmony-detail">
        <AuraButton class="harmony-detail__back" onClick={() => navigate(-1)}>
          ◀ Back
        </AuraButton>
        <AuraCard class="harmony-notice">Could not load game: {error}</AuraCard>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="harmony-detail">
        <p className="harmony-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="harmony-detail">
      <HeroBackdrop game={game} />

      <motion.div
        className="harmony-detail__content"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING.gentle}
      >
        <AuraButton class="harmony-detail__back" onClick={() => navigate(-1)}>
          ◀ Back
        </AuraButton>

        <PlaySwitch gameId={game.id} system={game.system} gameName={game.cleanName} />

        <div className="harmony-detail__body">
          <AuraCard class="harmony-detail__cover">
            {art ? (
              <img src={art} alt="" className="harmony-detail__cover-img" />
            ) : (
              <span className="harmony-detail__cover-ph">{game.system}</span>
            )}
          </AuraCard>

          <div className="harmony-detail__info">
            <h1 className="harmony-detail__title">{game.cleanName}</h1>
            <p className="harmony-detail__subtitle">
              {game.system}
              {game.datMatched ? " · DAT-matched ✓" : ""} · {formatSize(game.sizeBytes)}
            </p>
            {game.coreHint && (
              <p className="harmony-detail__core">Core: {game.coreHint}</p>
            )}

            <div className="harmony-detail__actions">
              <AuraButton class="harmony-detail__play" onClick={onLaunch}>
                ▶ Play
              </AuraButton>
              <AuraButton
                class="harmony-detail__secondary"
                onClick={onRefreshMetadata}
                disabled={enriching}
              >
                {enriching ? "Fetching metadata…" : "Refresh metadata"}
              </AuraButton>
              <AuraButton class="harmony-detail__secondary" onClick={onGetArt}>
                Get art
              </AuraButton>
              <AuraButton
                class="harmony-detail__secondary"
                onClick={() =>
                  navigate("/search", { state: { query: game.cleanName } })
                }
              >
                Find downloads
              </AuraButton>
            </div>

            {launchError && (
              <AuraCard class="harmony-notice">Launch failed: {launchError}</AuraCard>
            )}

            {game.description && (
              <div className="harmony-detail__about">
                <p className="harmony-detail__desc">{game.description}</p>
                {game.wikipediaUrl && (
                  <button
                    type="button"
                    className="harmony-detail__wiki"
                    onClick={() => void openUrl(game.wikipediaUrl!).catch(() => undefined)}
                  >
                    Read more on Wikipedia ↗
                  </button>
                )}
              </div>
            )}

            <div className="harmony-detail__meta">
              <MetaRow label="Path" value={game.path} />
              <MetaRow label="System" value={game.system} />
              <MetaRow label="CRC32" value={game.crc32 ?? "—"} />
              <MetaRow label="MD5" value={game.md5 ?? "—"} />
              <MetaRow label="Size" value={formatSize(game.sizeBytes)} />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
