// CoresPage — the Cores Management screen at /cores (W16, harmony-ux-design §4).
//
// Archetype: Management / Table-master-detail.
// Layout: left column = system list (NES/SNES/N64); right column = core rows for
// the selected system. Controller nav_left/right switches columns; nav_up/down
// moves within the focused list; confirm = Set Active; secondary action = Install
// / Update. Arch-rejection (arm64 only) surfaces as an inline error on the row.
//
// Framer Motion: rows stagger-fade in; status-badge change springs via layout;
// column focus crossfades. No blur filters (architecture §5.2).

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SPRING, listContainer } from "../../lib/motion";
import { SystemList } from "./SystemList";
import { CoreRow } from "./CoreRow";
import { useCores } from "./useCores";
import { filterCores, flattenCores, groupBySystem } from "./coreFilter";
import { LoadingState } from "../../components/LoadingState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { EmptyState } from "../../components/EmptyState";
import "./cores.css";

/**
 * Top-level Cores Management screen. Mounts the two-column master–detail layout
 * and wires focus-column keyboard navigation (ArrowLeft/Right switches column).
 */
export function CoresPage() {
  const {
    coresBySystem,
    systems,
    loading,
    fetchError,
    actionState,
    actionError,
    install,
    update,
    activate,
  } = useCores();

  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  // "master" | "detail" — which column has focus
  const [focusCol, setFocusCol] = useState<"master" | "detail">("master");
  // Browse/search query across the whole catalog. Non-empty → browse-all mode.
  const [query, setQuery] = useState("");

  // The full catalog flattened in system order, and the current search results.
  const allCores = useMemo(
    () => flattenCores(coresBySystem, systems),
    [coresBySystem, systems],
  );
  const searching = query.trim() !== "";
  const matchesBySystem = useMemo(
    () => groupBySystem(filterCores(allCores, query)),
    [allCores, query],
  );

  // Auto-select first system once the list loads.
  useEffect(() => {
    if (!selectedSystem && systems.length > 0) {
      setSelectedSystem(systems[0]);
    }
  }, [selectedSystem, systems]);

  // Top-level keyboard: left/right to switch focused column.
  function handleRootKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" && focusCol === "master") {
      e.preventDefault();
      setFocusCol("detail");
    } else if (e.key === "ArrowLeft" && focusCol === "detail") {
      e.preventDefault();
      setFocusCol("master");
    }
  }

  const cores = selectedSystem ? (coresBySystem[selectedSystem] ?? []) : [];

  return (
    <div
      className="harmony-panel cores-page"
      style={{ padding: 24, borderRadius: 12 }}
      onKeyDown={handleRootKeyDown}
    >
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Cores</h2>

      {/* Browse + search the whole catalog (v0.7). A non-empty query switches
          from the per-system master/detail to a flat, all-systems result list. */}
      {!fetchError && (
        <input
          type="search"
          className="cores-search"
          placeholder="Search all cores by name or system…"
          aria-label="Search cores by name or system"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {/* Global fetch error */}
      {fetchError && <ErrorNotice>Failed to load cores: {fetchError}</ErrorNotice>}

      {loading && <LoadingState>Loading cores…</LoadingState>}

      {/* Browse-all / search results — a flat catalog across every system. */}
      {!loading && !fetchError && searching && (
        <div aria-label="Search results">
          {Object.keys(matchesBySystem).length === 0 ? (
            <EmptyState>No cores match “{query.trim()}”.</EmptyState>
          ) : (
            systems
              .filter((sys) => matchesBySystem[sys]?.length)
              .map((sys) => (
                <motion.div
                  key={sys}
                  variants={listContainer}
                  initial="hidden"
                  animate="visible"
                  style={{ marginBottom: 16 }}
                >
                  <h3
                    style={{
                      margin: "0 0 8px",
                      fontSize: 13,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    {sys}
                  </h3>
                  {matchesBySystem[sys].map((core) => (
                    <CoreRow
                      key={core.coreId}
                      core={core}
                      action={actionState(core.system, core.coreId)}
                      error={actionError(core.system, core.coreId)}
                      onInstall={() => void install(core.system, core.coreId)}
                      onUpdate={() => void update(core)}
                      onActivate={() => void activate(core.system, core.coreId)}
                    />
                  ))}
                </motion.div>
              ))
          )}
        </div>
      )}

      {!loading && !fetchError && !searching && (
        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "flex-start",
          }}
        >
          {/* Master column — system list */}
          <div
            style={{ width: 160, flexShrink: 0 }}
            aria-label="Systems column"
            data-focus-col="master"
            onFocus={() => setFocusCol("master")}
          >
            <SystemList
              systems={systems}
              selectedSystem={selectedSystem}
              onSelect={(sys) => {
                setSelectedSystem(sys);
                setFocusCol("master");
              }}
            />
          </div>

          {/* Detail column — cores for selected system */}
          <div
            style={{ flex: 1, minWidth: 0 }}
            aria-label={
              selectedSystem
                ? `Cores for ${selectedSystem.toUpperCase()}`
                : "Cores"
            }
            data-focus-col="detail"
            onFocus={() => setFocusCol("detail")}
          >
            <AnimatePresence mode="wait">
              {selectedSystem && (
                <motion.div
                  key={selectedSystem}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={SPRING.responsive}
                >
                  {cores.length === 0 ? (
                    <div
                      style={{
                        color:
                          "var(--aura-on-surface-muted, var(--aura-primary-300))",
                        fontSize: 14,
                        padding: "10px 0",
                      }}
                    >
                      No cores available for this system.
                    </div>
                  ) : (
                    cores.map((core) => (
                      <CoreRow
                        key={core.coreId}
                        core={core}
                        action={actionState(core.system, core.coreId)}
                        error={actionError(core.system, core.coreId)}
                        onInstall={() => void install(core.system, core.coreId)}
                        onUpdate={() => void update(core)}
                        onActivate={() =>
                          void activate(core.system, core.coreId)
                        }
                      />
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* HintBar hints (static annotation; W14's HintBar component reads data-hint-* or a context) */}
      <div
        className="cores-hintbar"
        aria-hidden
        style={{
          marginTop: 20,
          paddingTop: 12,
          borderTop: "1px solid var(--aura-surface-stroke)",
          fontSize: 11,
          color: "var(--aura-on-surface-muted, var(--aura-primary-300))",
          display: "flex",
          gap: 16,
        }}
      >
        <span>▲▼ Core</span>
        <span>Ⓐ Set active</span>
        <span>Ⓧ Install / Update</span>
        <span>◀▶ Column</span>
        <span>Ⓑ Back</span>
      </div>
    </div>
  );
}
