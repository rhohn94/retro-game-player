// LibraryFilters (v0.6 "Lens", v0.37 W373 collection filter) — the
// multi-facet filter bar above the gallery.
//
// Console is a pill tablist (the original filter, kept); a text box searches the
// title + aliases; year / developer / publisher are selects that ONLY render
// when the loaded games carry values for them, so the bar degrades gracefully
// before any metadata enrichment exists. A collection select sits beside the
// console tablist (collections-design.md §UI: "a library collection filter
// beside the system filter") and only renders once at least one collection
// exists. Pure presentation: all state lives in the parent via `criteria` +
// `onChange`. Filtering logic is in ./filter.

import { AuraButton } from "@aura/react";
import {
  ALL_SYSTEMS,
  DESKTOP_SYSTEM,
  EMPTY_CRITERIA,
  hasActiveFilters,
  type Facets,
  type FilterCriteria,
} from "./filter";
import type { CollectionWithCount } from "../../ipc/collections";

interface LibraryFiltersProps {
  facets: Facets;
  criteria: FilterCriteria;
  onChange: (next: FilterCriteria) => void;
  /** Every collection with its member count, for the collection select. Empty
   * hides the select entirely (v0.37 W373). */
  collections: readonly CollectionWithCount[];
}

/** A token-styled native select used for the year/developer/publisher facets. */
function FacetSelect({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string | null) => void;
}) {
  return (
    <label className="rgp-facet">
      <span className="rgp-facet__label">{label}</span>
      <select
        className="rgp-facet__select"
        value={value}
        onChange={(e) => onSelect(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LibraryFilters({ facets, criteria, onChange, collections }: LibraryFiltersProps) {
  const set = (patch: Partial<FilterCriteria>) => onChange({ ...criteria, ...patch });
  // The "Desktop" tab (v0.31 W315) only appears once a non-retro row exists,
  // and trails the real consoles so it reads as an addition, not a takeover.
  const systems = [ALL_SYSTEMS, ...facets.systems, ...(facets.hasDesktop ? [DESKTOP_SYSTEM] : [])];

  return (
    <div className="rgp-filters">
      {/* Console pill tabs, plus the collection select beside them (v0.37
          W373 — collections-design.md §UI: "beside the system filter"). */}
      <div className="rgp-filters__system-row">
        <div className="rgp-tabs" role="tablist" aria-label="System filter">
          {systems.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === criteria.system}
              className={s === criteria.system ? "rgp-tab rgp-tab--active" : "rgp-tab"}
              onClick={() => set({ system: s })}
            >
              {s}
            </button>
          ))}
        </div>

        {collections.length > 0 && (
          <label className="rgp-facet">
            <span className="rgp-facet__label">Collection</span>
            <select
              className="rgp-facet__select"
              aria-label="Filter by collection"
              value={criteria.collectionId == null ? "" : String(criteria.collectionId)}
              onChange={(e) =>
                set({ collectionId: e.target.value === "" ? null : Number(e.target.value) })
              }
            >
              <option value="">All</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.gameCount})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Text search + metadata facets */}
      <div className="rgp-filters__row">
        <input
          type="search"
          className="rgp-filters__search"
          placeholder="Search title or alias…"
          aria-label="Search games by title or alias"
          value={criteria.query}
          onChange={(e) => set({ query: e.target.value })}
        />

        {facets.years.length > 0 && (
          <FacetSelect
            label="Year"
            value={criteria.year == null ? "" : String(criteria.year)}
            options={facets.years.map(String)}
            onSelect={(v) => set({ year: v == null ? null : Number(v) })}
          />
        )}
        {facets.developers.length > 0 && (
          <FacetSelect
            label="Developer"
            value={criteria.developer ?? ""}
            options={facets.developers}
            onSelect={(v) => set({ developer: v })}
          />
        )}
        {facets.publishers.length > 0 && (
          <FacetSelect
            label="Publisher"
            value={criteria.publisher ?? ""}
            options={facets.publishers}
            onSelect={(v) => set({ publisher: v })}
          />
        )}

        {hasActiveFilters(criteria) && (
          <AuraButton
            variant="ghost"
            onClick={() => onChange({ ...EMPTY_CRITERIA })}
          >
            Clear
          </AuraButton>
        )}
      </div>
    </div>
  );
}
