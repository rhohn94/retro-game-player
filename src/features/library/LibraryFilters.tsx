// LibraryFilters (v0.6 "Lens") — the multi-facet filter bar above the gallery.
//
// Console is a pill tablist (the original filter, kept); a text box searches the
// title + aliases; year / developer / publisher are selects that ONLY render
// when the loaded games carry values for them, so the bar degrades gracefully
// before any metadata enrichment exists. Pure presentation: all state lives in
// the parent via `criteria` + `onChange`. Filtering logic is in ./filter.

import { AuraButton } from "@aura/react";
import {
  ALL_SYSTEMS,
  EMPTY_CRITERIA,
  hasActiveFilters,
  type Facets,
  type FilterCriteria,
} from "./filter";

interface LibraryFiltersProps {
  facets: Facets;
  criteria: FilterCriteria;
  onChange: (next: FilterCriteria) => void;
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
    <label className="harmony-facet">
      <span className="harmony-facet__label">{label}</span>
      <select
        className="harmony-facet__select"
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

export function LibraryFilters({ facets, criteria, onChange }: LibraryFiltersProps) {
  const set = (patch: Partial<FilterCriteria>) => onChange({ ...criteria, ...patch });
  const systems = [ALL_SYSTEMS, ...facets.systems];

  return (
    <div className="harmony-filters">
      {/* Console pill tabs */}
      <div className="harmony-tabs" role="tablist" aria-label="System filter">
        {systems.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === criteria.system}
            className={s === criteria.system ? "harmony-tab harmony-tab--active" : "harmony-tab"}
            onClick={() => set({ system: s })}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Text search + metadata facets */}
      <div className="harmony-filters__row">
        <input
          type="search"
          className="harmony-filters__search"
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
            events={{ "aura-click": () => onChange({ ...EMPTY_CRITERIA }) }}
          >
            Clear
          </AuraButton>
        )}
      </div>
    </div>
  );
}
