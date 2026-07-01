/** Small provider-group header controls: the count/status pill and the
 *  tri-state select-all checkbox. */
import { useEffect, useRef } from "react";
import type { GroupSelectionState } from "../resultSelection";
import type { ProviderResults } from "../../../ipc/search";

/** A small count/status pill for a provider header: visible link count, or an
 * error marker when the fetch failed. */
export function GroupCountBadge({
  group,
  count,
}: {
  group: ProviderResults;
  count: number;
}) {
  const isError = group.error !== null;
  const label = isError ? "error" : String(count);
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        minWidth: 18,
        textAlign: "center",
        padding: "2px 6px",
        borderRadius: 10,
        background: isError ? "transparent" : "var(--aura-surface-raised)",
        border: isError ? "1px solid var(--aura-error)" : "none",
        color: isError ? "var(--aura-error)" : "var(--aura-on-surface-muted)",
      }}
    >
      {label}
    </span>
  );
}

/** A tri-state "select all in this group" checkbox (checked / indeterminate /
 * empty), driven by the group's {@link GroupSelectionState}. */
export function GroupSelectAll({
  state,
  onToggle,
  label,
}: {
  state: GroupSelectionState;
  onToggle: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "all"}
      onChange={onToggle}
      aria-label={label}
      style={{ marginLeft: 16, flexShrink: 0, cursor: "pointer" }}
    />
  );
}
