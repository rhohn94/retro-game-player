/** The Search page's title/intro copy plus the query + structured-filter
 *  (console/region) row and the run button (W362, extracted from SearchPage).
 *  Native <select> elements are already keyboard/controller-operable via the
 *  platform's own select UI, so they're left unwrapped (v0.18). */
import type { CSSProperties } from "react";
import { AuraButton, AuraField } from "@aura/react";
import type { ConsoleInfo } from "../../../ipc/console";
import { consoleDropdownLabel } from "../consoleSearch";
import { SEARCH_REGIONS } from "../resultRanking";
import { FocusableSearchField, FocusableAction } from "./FocusableControls";

export function SearchHeader() {
  return (
    <>
      <h1 style={{ margin: 0, fontSize: 22 }}>Search</h1>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Find games and info across your providers. Retro Game Player{" "}
        <strong>previews what each provider found</strong> and opens your chosen
        link in your browser — or, for providers you've enabled direct download
        for, downloads your chosen file straight into your library.{" "}
        <span aria-hidden>⬇</span> marks download sources. Retro Game Player
        never fetches content on its own initiative; providers vary in what
        they host, and you're responsible for how you use any link you open or
        file you download.
      </p>
    </>
  );
}

const toggleLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "var(--aura-on-surface-muted)",
  cursor: "pointer",
  userSelect: "none",
};

export function SearchQueryBar({
  query,
  onQueryChange,
  onQueryKeyDown,
  queryRef,
  consoleKey,
  onConsoleChange,
  consoles,
  region,
  onRegionChange,
  appendRom,
  onAppendRomChange,
  appendZip,
  onAppendZipChange,
  excludeNoise,
  onExcludeNoiseChange,
  quoteTitle,
  onQuoteTitleChange,
  softSkippedCount,
  onResumeAllSoftSkipped,
  onSearch,
  searchDisabled,
  running,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onQueryKeyDown: (e: React.KeyboardEvent) => void;
  queryRef?: React.Ref<HTMLInputElement>;
  consoleKey: string;
  onConsoleChange: (value: string) => void;
  consoles: ConsoleInfo[];
  region: string;
  onRegionChange: (value: string) => void;
  /** Append a `rom` token for meta-search / download providers (Phase 2). */
  appendRom?: boolean;
  onAppendRomChange?: (value: boolean) => void;
  /** Append a `zip` token (Phase 4). */
  appendZip?: boolean;
  onAppendZipChange?: (value: boolean) => void;
  /** Meta noise negatives (Phase 4). */
  excludeNoise?: boolean;
  onExcludeNoiseChange?: (value: boolean) => void;
  /** Quote multi-word titles on meta (Phase 4). */
  quoteTitle?: boolean;
  onQuoteTitleChange?: (value: boolean) => void;
  /** Count of providers soft-skipped by health memory. */
  softSkippedCount?: number;
  onResumeAllSoftSkipped?: () => void;
  onSearch: () => void;
  searchDisabled: boolean;
  running: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <AuraField style={{ flex: 1, minWidth: 200 }}>
          <FocusableSearchField
            focusId="search:query"
            inputRef={queryRef}
            name="search-query"
            className="rgp-input"
            type="search"
            value={query}
            placeholder="Game name…"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onQueryKeyDown}
          />
        </AuraField>
        {/* Structured filters (v0.18): always feed relevance ranking; appended
            to a provider's query only when it has compose-filters enabled. */}
        <select
          name="search-console"
          className="rgp-input"
          aria-label="Console"
          value={consoleKey}
          onChange={(e) => onConsoleChange(e.target.value)}
          title="Filters compose-enabled providers; dual-region systems match all common names (e.g. Genesis and Mega Drive)"
          style={{ fontSize: 13, padding: "6px 8px", maxWidth: 280, minWidth: 140 }}
        >
          <option value="">Any console</option>
          {consoles.map((c) => (
            <option key={c.key} value={c.key} title={c.name}>
              {consoleDropdownLabel(c)}
            </option>
          ))}
        </select>
        <select
          name="search-region"
          className="rgp-input"
          aria-label="Region"
          value={region}
          onChange={(e) => onRegionChange(e.target.value)}
          style={{ fontSize: 13, padding: "6px 8px", maxWidth: 150 }}
        >
          <option value="">Any region</option>
          {SEARCH_REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <FocusableAction
          focusId="search:run"
          onActivate={onSearch}
          disabled={searchDisabled}
          render={({ ref, onClick, disabled }) => (
            <AuraButton
              ref={ref}
              variant="primary"
              onClick={() => {
                // `onClick` alone only claims controller focus (FocusableAction's
                // render-prop contract) — a contained-less AuraButton has no other
                // native onChange/onClick to own the real action (unlike the
                // checkbox toggles above), so a real mouse click or keyboard
                // Enter/Space must also invoke it here directly (matches
                // ResultsToolbar's Expand/Collapse-all precedent). Without this,
                // clicking Search (or Tab+Enter to it) silently did nothing —
                // only a gamepad confirm actually ran the search.
                onClick();
                onSearch();
              }}
              disabled={disabled}
            >
              {running ? "Searching…" : "Search"}
            </AuraButton>
          )}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        {onAppendRomChange !== undefined && (
          <label
            style={toggleLabelStyle}
            title="Appends “rom” to web/meta and download-provider queries so SERPs rank downloadable hits higher"
          >
            <input
              type="checkbox"
              name="search-append-rom"
              checked={!!appendRom}
              onChange={(e) => onAppendRomChange(e.target.checked)}
            />
            +rom
          </label>
        )}
        {onAppendZipChange !== undefined && (
          <label
            style={toggleLabelStyle}
            title="Appends “zip” so web search prefers archive downloads (Phase 4)"
          >
            <input
              type="checkbox"
              name="search-append-zip"
              checked={!!appendZip}
              onChange={(e) => onAppendZipChange(e.target.checked)}
            />
            +zip
          </label>
        )}
        {onExcludeNoiseChange !== undefined && (
          <label
            style={toggleLabelStyle}
            title="On meta search, exclude emulator/wiki/YouTube-style noise (−emulator −wiki −youtube…)"
          >
            <input
              type="checkbox"
              name="search-exclude-noise"
              checked={!!excludeNoise}
              onChange={(e) => onExcludeNoiseChange(e.target.checked)}
            />
            −noise
          </label>
        )}
        {onQuoteTitleChange !== undefined && (
          <label
            style={toggleLabelStyle}
            title='Quote multi-word titles on meta search ("Sonic the Hedgehog") for tighter matches'
          >
            <input
              type="checkbox"
              name="search-quote-title"
              checked={!!quoteTitle}
              onChange={(e) => onQuoteTitleChange(e.target.checked)}
            />
            “title”
          </label>
        )}
        {(softSkippedCount ?? 0) > 0 && onResumeAllSoftSkipped && (
          <button
            type="button"
            className="rgp-input"
            onClick={onResumeAllSoftSkipped}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              cursor: "pointer",
              color: "var(--aura-on-surface-muted)",
            }}
            title="These providers failed several times in a row (captcha/error) and were skipped. Click to try them again."
          >
            Resume {softSkippedCount} skipped source{softSkippedCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}
