// ConsoleDetailPage — the per-console detail screen at "/console/:key" (v0.12).
//
// Loads the console via `get_console` (which fetches + caches its Wikipedia photo
// + description on first visit), shows the user's owned games for it, and embeds
// the full bundled title catalog browser. Back returns to the console grid.

import { AuraButton, AuraCard } from "@aura/react";
import { openUrl } from "../../ipc/opener";
import { motion } from "framer-motion";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getConsole, listGames } from "../../ipc/commands";
import type { ConsoleInfo, Game } from "../../ipc/commands";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { SPRING } from "../../lib/motion";
import { artUrl } from "../library/art";
import { GameTile } from "../library/GameTile";
import { CatalogBrowser } from "./CatalogBrowser";
import { LoadingState } from "../../components/LoadingState";
import { ErrorNotice } from "../../components/ErrorNotice";

export function ConsoleDetailPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<ConsoleInfo | null>(null);
  const [owned, setOwned] = useState<Game[]>([]);
  const [error, setError] = useState<string | null>(null);

  useCancellableEffect(
    (isCancelled) => {
      if (!key) return;
      setInfo(null);
      setError(null);
      getConsole(key)
        .then((c) => {
          if (!isCancelled()) setInfo(c);
        })
        .catch((err: unknown) => {
          if (!isCancelled()) setError(err instanceof Error ? err.message : String(err));
        });
      listGames(key)
        .then((rows) => {
          if (!isCancelled()) setOwned(rows);
        })
        .catch(() => undefined);
    },
    [key],
  );

  if (error) {
    return (
      <div className="harmony-console-detail">
        <AuraButton class="harmony-detail__back" onClick={() => navigate(-1)}>
          ◀ Back
        </AuraButton>
        <ErrorNotice>Could not load console: {error}</ErrorNotice>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="harmony-console-detail">
        <LoadingState>Loading…</LoadingState>
      </div>
    );
  }

  const img = artUrl(info.imagePath);

  return (
    <motion.div
      className="harmony-console-detail"
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={SPRING.gentle}
    >
      <AuraButton class="harmony-detail__back" onClick={() => navigate("/consoles")}>
        ◀ All consoles
      </AuraButton>

      <header className="harmony-console-detail__hero">
        <AuraCard class="harmony-console-detail__photo">
          {img ? (
            <img src={img} alt="" className="harmony-console-detail__photo-img" />
          ) : (
            <span className="harmony-console-detail__photo-ph">{info.abbreviation}</span>
          )}
        </AuraCard>
        <div className="harmony-console-detail__info">
          <h1 className="harmony-console-detail__name">{info.name}</h1>
          <p className="harmony-console-detail__facts">
            {info.manufacturer} · Generation {info.generation} · {info.year}
          </p>
          <p className="harmony-console-detail__counts">
            {info.ownedCount.toLocaleString()} in your library ·{" "}
            {info.catalogCount.toLocaleString()} known titles
          </p>
          {info.description && (
            <p className="harmony-console-detail__desc">{info.description}</p>
          )}
          {info.wikipediaUrl && (
            <button
              type="button"
              className="harmony-detail__wiki"
              onClick={() => void openUrl(info.wikipediaUrl!).catch(() => undefined)}
            >
              Read more on Wikipedia ↗
            </button>
          )}
        </div>
      </header>

      <section className="harmony-console-detail__section">
        <h2 className="harmony-console-detail__h2">Hardware</h2>
        <table className="harmony-specs">
          <tbody>
            <tr>
              <th scope="row">CPU</th>
              <td>{info.cpu}</td>
            </tr>
            <tr>
              <th scope="row">GPU</th>
              <td>{info.gpu}</td>
            </tr>
            <tr>
              <th scope="row">RAM</th>
              <td>{info.ram}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {owned.length > 0 && (
        <section className="harmony-console-detail__section">
          <h2 className="harmony-console-detail__h2">Your {info.abbreviation} games</h2>
          <div className="harmony-grid">
            {owned.map((g) => (
              <GameTile
                key={g.id}
                game={g}
                onFocusGame={() => undefined}
                onOpen={(game) => navigate(`/game/${game.id}`)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="harmony-console-detail__section">
        <h2 className="harmony-console-detail__h2">All {info.name} games</h2>
        <p className="harmony-muted" style={{ marginTop: 0 }}>
          The full known catalog. Pick a title to find downloads — Harmony opens
          links in your browser and never downloads anything for you.
        </p>
        <CatalogBrowser system={info.key} />
      </section>
    </motion.div>
  );
}
