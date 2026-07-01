// CatalogBrowser — browse a console's full bundled title catalog (v0.12).
//
// The catalog can hold thousands of titles per console, so this searches +
// paginates server-side via `list_catalog_titles` (the backend filters and
// windows the embedded list). Each row shows whether the user already owns the
// title and jumps to the links-only download search for it on click.

import { AuraButton, AuraField } from "@aura/react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listCatalogTitles } from "../../ipc/commands";
import type { CatalogPage } from "../../ipc/commands";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import { listContainer, listItem } from "../../lib/motion";

const PAGE_SIZE = 60;

export function CatalogBrowser({ system }: { system: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A new search starts at the first page.
  useEffect(() => {
    setOffset(0);
  }, [query, system]);

  useCancellableEffect(
    (isCancelled) => {
      setLoading(true);
      const trimmed = query.trim();
      const handle = setTimeout(
        () => {
          listCatalogTitles(system, trimmed || undefined, offset, PAGE_SIZE)
            .then((p) => {
              if (!isCancelled()) {
                setPage(p);
                setError(null);
              }
            })
            .catch((err: unknown) => {
              if (!isCancelled()) {
                setPage(null);
                setError(err instanceof Error ? err.message : String(err));
              }
            })
            .finally(() => {
              if (!isCancelled()) setLoading(false);
            });
        },
        trimmed ? 180 : 0,
      );
      return () => clearTimeout(handle);
    },
    [system, query, offset],
  );

  const total = page?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="harmony-catalog">
      <div className="harmony-catalog__bar">
        <AuraField class="harmony-catalog__search">
          <input
            type="search"
            className="harmony-input"
            placeholder="Search this console's catalog…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </AuraField>
        <span className="harmony-muted harmony-catalog__count">
          {total.toLocaleString()} {total === 1 ? "title" : "titles"}
          {total > 0 ? ` · showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()}` : ""}
        </span>
      </div>

      {loading && !page && !error && <p className="harmony-muted">Loading catalog…</p>}

      {error && (
        <p style={{ color: "var(--aura-error)" }}>Could not load the catalog: {error}</p>
      )}

      {page && page.items.length === 0 && (
        <p className="harmony-muted">No titles match your search.</p>
      )}

      {page && page.items.length > 0 && (
        <motion.ul
          className="harmony-catalog__list"
          variants={listContainer}
          initial="hidden"
          animate="visible"
        >
          {page.items.map((t) => (
            <motion.li key={t.title} variants={listItem} className="harmony-catalog__li">
              <button
                type="button"
                className="harmony-catalog__row"
                onClick={() => navigate("/search", { state: { query: t.title } })}
                title={`Find downloads for ${t.title}`}
              >
                <span className="harmony-catalog__name">{t.title}</span>
                {t.owned && <span className="harmony-catalog__owned">✓ In library</span>}
                <span className="harmony-catalog__find">Find downloads ↗</span>
              </button>
            </motion.li>
          ))}
        </motion.ul>
      )}

      {(hasPrev || hasNext) && (
        <div className="harmony-catalog__pager">
          <AuraButton
            variant="ghost"
            disabled={!hasPrev}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            ◀ Prev
          </AuraButton>
          <AuraButton variant="ghost" disabled={!hasNext} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
            Next ▶
          </AuraButton>
        </div>
      )}
    </div>
  );
}
