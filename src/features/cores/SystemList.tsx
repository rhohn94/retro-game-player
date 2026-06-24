// SystemList — the master "Systems" column in the Cores Management screen (W16).
// Renders a focusable list of system labels (NES / SNES / N64). Controller
// nav_up/down moves selection; the active item is styled with the brand primary.
// Aura events/class contract: uses `class` (not className) for BEM variants.

import { AuraCard } from "@aura/react";

/** Display label for each system id. */
const SYSTEM_LABELS: Record<string, string> = {
  nes: "NES",
  snes: "SNES",
  n64: "N64",
};

interface SystemListProps {
  systems: string[];
  selectedSystem: string | null;
  onSelect: (system: string) => void;
}

/**
 * Left-column master list of systems. Each item is a focusable shelf card.
 * Keyboard: ArrowUp/Down moves focus + selection (controller nav_up/down mirror).
 */
export function SystemList({ systems, selectedSystem, onSelect }: SystemListProps) {
  if (systems.length === 0) return null;

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    idx: number,
  ) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = systems[idx + 1];
      if (next) onSelect(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = systems[idx - 1];
      if (prev) onSelect(prev);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(systems[idx]);
    }
  }

  return (
    <div
      role="listbox"
      aria-label="Systems"
      style={{ display: "flex", flexDirection: "column", gap: 4 }}
    >
      {systems.map((sys, idx) => {
        const isSelected = sys === selectedSystem;
        return (
          <AuraCard
            key={sys}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            class={isSelected ? "active" : undefined}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              cursor: "pointer",
              border: isSelected
                ? "1px solid var(--aura-primary)"
                : "1px solid var(--aura-surface-stroke)",
              background: isSelected
                ? "var(--aura-primary-a15)"
                : "var(--aura-surface-2)",
              color: isSelected
                ? "var(--aura-on-surface)"
                : "var(--aura-on-surface-muted, var(--aura-primary-300))",
              fontWeight: isSelected ? 600 : 400,
              fontSize: 14,
              outline: "none",
              // Focus ring via CSS :focus-visible
            }}
            onClick={() => onSelect(sys)}
            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) =>
              handleKeyDown(e, idx)
            }
          >
            {SYSTEM_LABELS[sys] ?? sys.toUpperCase()}
          </AuraCard>
        );
      })}
    </div>
  );
}
