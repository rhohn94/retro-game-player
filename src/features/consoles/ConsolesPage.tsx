// ConsolesPage — the "By Console" browse grid at "/consoles" (v0.12).
//
// Archetype: Gallery / Media-grid. Consoles come from `list_consoles` (static
// facts + any cached Wikipedia media). On mount we lazily call `get_console` for
// any console missing a photo so the cards fill in (and cache for next time).
// A search box filters by name / maker / abbreviation; cards are grouped by
// console generation. Each card is a focusable button that opens the detail view.

import { AuraCard, AuraField } from "@aura/react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getConsole, listConsoles } from "../../ipc/commands";
import type { ConsoleInfo } from "../../ipc/commands";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { listContainer, listItem } from "../../lib/motion";
import { artUrl } from "../library/art";
import { LoadingState } from "../../components/LoadingState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { EmptyState } from "../../components/EmptyState";

/** One focusable console card. */
function ConsoleCard({
  console: c,
  onOpen,
}: {
  console: ConsoleInfo;
  onOpen: (key: string) => void;
}) {
  const img = artUrl(c.imagePath);
  return (
    <motion.button
      variants={listItem}
      type="button"
      className="harmony-console-tile"
      onClick={() => onOpen(c.key)}
      aria-label={`${c.name} (${c.manufacturer}, ${c.year})`}
    >
      <AuraCard class="harmony-console-tile__card">
        <div className="harmony-console-tile__art">
          {img ? (
            <img src={img} alt="" loading="lazy" className="harmony-console-tile__img" />
          ) : (
            <span className="harmony-console-tile__ph">{c.abbreviation}</span>
          )}
        </div>
        <div className="harmony-console-tile__meta">
          <span className="harmony-console-tile__name">{c.name}</span>
          <span className="harmony-console-tile__sub">
            {c.manufacturer} · {c.year}
          </span>
          <span className="harmony-console-tile__counts">
            {c.ownedCount > 0 ? `${c.ownedCount} owned · ` : ""}
            {c.catalogCount.toLocaleString()} titles
          </span>
        </div>
      </AuraCard>
    </motion.button>
  );
}

/** The "By Console" browse screen mounted at "/consoles". */
export function ConsolesPage() {
  const navigate = useNavigate();
  const [consoles, setConsoles] = useState<ConsoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useCancellableEffect((isCancelled) => {
    setLoading(true);
    listConsoles()
      .then((rows) => {
        if (isCancelled()) return;
        setConsoles(rows);
        setError(null);
        // Lazily fetch + cache media for any console without a photo yet.
        for (const c of rows) {
          if (c.imagePath) continue;
          void getConsole(c.key)
            .then((full) => {
              if (isCancelled()) return;
              setConsoles((prev) => prev.map((x) => (x.key === full.key ? full : x)));
            })
            .catch(() => undefined);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled()) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!isCancelled()) setLoading(false);
      });
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return consoles;
    return consoles.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.manufacturer.toLowerCase().includes(q) ||
        c.abbreviation.toLowerCase().includes(q),
    );
  }, [consoles, query]);

  // Group the visible consoles by generation, preserving catalog order.
  const groups = useMemo(() => {
    const byGen = new Map<number, ConsoleInfo[]>();
    for (const c of visible) {
      const list = byGen.get(c.generation) ?? [];
      list.push(c);
      byGen.set(c.generation, list);
    }
    return [...byGen.entries()].sort((a, b) => a[0] - b[0]);
  }, [visible]);

  return (
    <section className="harmony-consoles" aria-label="Browse by console">
      <header className="harmony-consoles__header">
        <h1 className="harmony-consoles__title">Consoles</h1>
        <p className="harmony-muted">
          Browse every console Harmony covers — with its history and full game
          catalog. Click a console to dive in.
        </p>
        <AuraField class="harmony-consoles__search">
          <input
            type="search"
            className="harmony-input"
            placeholder="Search consoles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </AuraField>
      </header>

      {loading && <LoadingState>Loading consoles…</LoadingState>}
      {error && <ErrorNotice>Could not load consoles: {error}</ErrorNotice>}
      {!loading && !error && visible.length === 0 && (
        <EmptyState>No consoles match “{query}”.</EmptyState>
      )}

      {groups.map(([generation, list]) => (
        <div key={generation} className="harmony-consoles__group">
          <h2 className="harmony-consoles__gen">Generation {generation}</h2>
          <motion.div
            className="harmony-console-grid"
            variants={listContainer}
            initial="hidden"
            animate="visible"
          >
            {list.map((c) => (
              <ConsoleCard key={c.key} console={c} onOpen={(k) => navigate(`/console/${k}`)} />
            ))}
          </motion.div>
        </div>
      ))}
    </section>
  );
}
