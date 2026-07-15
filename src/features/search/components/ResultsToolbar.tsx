/** Results browse toolbar: live filter, sort, group-by, the opt-in liveness
 *  probe toggle, hide-weak, provider-view expand/collapse-all, and the
 *  running summary line (W362, extracted from SearchPage). Shown once there
 *  are any links to browse. */
import { AuraField } from "@aura/react";
import { isSortKey, SORT_KEYS, SORT_LABELS } from "../resultSort";
import type { SortKey } from "../resultSort";
import type { GroupBy } from "../SearchPage";
import { FocusableSearchField, FocusableAction } from "./FocusableControls";

/** A plain-text toolbar link button (Expand all / Collapse all), styled as an
 *  inline action rather than a full AuraButton. */
function ToolbarLinkButton({
  toolbarRef,
  onClick,
  disabled,
  children,
}: {
  toolbarRef: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={toolbarRef}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: 0,
        fontSize: 11,
        color: disabled ? "var(--aura-on-surface-muted)" : "var(--aura-primary)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function ResultsToolbar({
  filter,
  onFilterChange,
  sortKey,
  onSortChange,
  groupBy,
  onGroupByChange,
  checkLinks,
  onCheckLinksChange,
  probing,
  hideWeak,
  onHideWeakChange,
  showExpandCollapse,
  collapsedCount,
  totalGroups,
  onExpandAll,
  onCollapseAll,
  summary,
  canGetBestMatch,
  onGetBestMatch,
}: {
  filter: string;
  onFilterChange: (value: string) => void;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  checkLinks: boolean;
  onCheckLinksChange: (value: boolean) => void;
  probing: boolean;
  hideWeak: boolean;
  onHideWeakChange: (value: boolean) => void;
  /** Whether the provider-view expand/collapse-all controls apply (only in
   *  "by provider" grouping with more than one group). */
  showExpandCollapse: boolean;
  collapsedCount: number;
  totalGroups: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  canGetBestMatch?: boolean;
  onGetBestMatch?: () => void;
  /** The precomputed "N of M …" / "N links across M providers" summary line. */
  summary: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderBottom: "1px solid var(--aura-outline-subtle, transparent)",
      }}
    >
      <AuraField style={{ flex: 1, minWidth: 160 }}>
        <FocusableSearchField
          focusId="search:result-filter"
          name="result-filter"
          className="rgp-input"
          type="search"
          value={filter}
          placeholder="Filter results…"
          onChange={(e) => onFilterChange(e.target.value)}
        />
      </AuraField>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--aura-on-surface-muted)",
        }}
      >
        Sort
        <select
          name="result-sort"
          className="rgp-input"
          value={sortKey}
          onChange={(e) => isSortKey(e.target.value) && onSortChange(e.target.value)}
          style={{ fontSize: 12, padding: "4px 6px" }}
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {/* Group-by (v0.19): provider-first (default) vs game-first merged rows
          ("available from N providers"). */}
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--aura-on-surface-muted)",
        }}
      >
        Group
        <select
          name="result-groupby"
          className="rgp-input"
          value={groupBy}
          onChange={(e) => onGroupByChange(e.target.value === "game" ? "game" : "provider")}
          style={{ fontSize: 12, padding: "4px 6px" }}
        >
          <option value="provider">By provider</option>
          <option value="game">By game</option>
        </select>
      </label>
      {/* Liveness (v0.19): opt-in HEAD probe of each link. Off by default;
          never blocks browsing. */}
      <FocusableAction
        focusId="search:check-links"
        onActivate={() => onCheckLinksChange(!checkLinks)}
        render={({ ref, onClick }) => (
          <label
            ref={ref as React.Ref<HTMLLabelElement>}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--aura-on-surface-muted)",
              cursor: "pointer",
            }}
            title="Probe each link with a HEAD request and mark it alive / dead / unknown. Off by default."
          >
            <input
              name="result-check-links"
              type="checkbox"
              checked={checkLinks}
              onChange={(e) => {
                onCheckLinksChange(e.target.checked);
                onClick();
              }}
            />
            {probing ? "Checking links…" : "Check links"}
          </label>
        )}
      />
      {/* Hide-weak (v0.18): off by default; weak matches are otherwise demoted
          to the bottom, never hidden silently. */}
      <FocusableAction
        focusId="search:hide-weak"
        onActivate={() => onHideWeakChange(!hideWeak)}
        render={({ ref, onClick }) => (
          <label
            ref={ref as React.Ref<HTMLLabelElement>}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--aura-on-surface-muted)",
              cursor: "pointer",
            }}
            title="Hide rows that don't match your search (kept, just hidden)"
          >
            <input
              name="result-hide-weak"
              type="checkbox"
              checked={hideWeak}
              onChange={(e) => {
                onHideWeakChange(e.target.checked);
                onClick();
              }}
            />
            Hide unlikely matches
          </label>
        )}
      />
      {showExpandCollapse && (
        <>
          <FocusableAction
            focusId="search:expand-all"
            onActivate={onExpandAll}
            disabled={collapsedCount === 0}
            render={({ ref, onClick, disabled }) => (
              <ToolbarLinkButton
                toolbarRef={ref as React.Ref<HTMLButtonElement>}
                onClick={() => {
                  onClick();
                  onExpandAll();
                }}
                disabled={disabled}
              >
                Expand all
              </ToolbarLinkButton>
            )}
          />
          <span style={{ color: "var(--aura-on-surface-muted)", fontSize: 11 }}>·</span>
          <FocusableAction
            focusId="search:collapse-all"
            onActivate={onCollapseAll}
            disabled={collapsedCount === totalGroups}
            render={({ ref, onClick, disabled }) => (
              <ToolbarLinkButton
                toolbarRef={ref as React.Ref<HTMLButtonElement>}
                onClick={() => {
                  onClick();
                  onCollapseAll();
                }}
                disabled={disabled}
              >
                Collapse all
              </ToolbarLinkButton>
            )}
          />
        </>
      )}
      <span
        style={{
          flex: "1 1 100%",
          fontSize: 12,
          color: "var(--aura-on-surface-muted)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span>{summary}</span>
        {canGetBestMatch && onGetBestMatch && (
          <FocusableAction
            focusId="search:get-best"
            onActivate={onGetBestMatch}
            render={({ ref, onClick }) => (
              <ToolbarLinkButton
                toolbarRef={ref as React.Ref<HTMLButtonElement>}
                onClick={() => {
                  onClick();
                  onGetBestMatch();
                }}
              >
                ⬇ Get best match
              </ToolbarLinkButton>
            )}
          />
        )}
      </span>
    </div>
  );
}
