// CoreRow — a single core entry in the detail list for a selected system (W16).
// Shows the core id, installed version, active/installed status badge, and
// inline Install / Update / Set Active action buttons. Long actions display a
// spinner spinner via CSS animation; arch-rejection surfaces as an inline error.
// Controller-navigable: each button is focusable; the row itself is not a tab
// stop (buttons carry focus per design §4).

import { motion } from "framer-motion";
import { AuraButton, AuraCard } from "@aura/react";
import type { Core } from "../../ipc/commands";
import type { CoreAction, CoreError } from "./useCores";

interface CoreRowProps {
  core: Core;
  action: CoreAction;
  error: CoreError | null;
  onInstall: () => void;
  onUpdate: () => void;
  onActivate: () => void;
}

/** Animated status badge: ● active, ○ installed-not-active, dashed = available. */
function StatusBadge({ core }: { core: Core }) {
  if (core.active) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          color: "var(--aura-secondary)",
          fontWeight: 600,
        }}
        aria-label="Active core"
      >
        ●&nbsp;active
      </span>
    );
  }
  if (core.installedPath) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          color: "var(--aura-on-surface-muted, var(--aura-primary-300))",
        }}
        aria-label="Installed"
      >
        ○&nbsp;installed
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        color: "var(--aura-on-surface-muted, var(--aura-primary-300))",
        opacity: 0.6,
      }}
      aria-label="Available to install"
    >
      –&nbsp;available
    </span>
  );
}

/** Inline spinner for long-running install/update/activate. */
function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid var(--aura-primary-a40)",
        borderTopColor: "var(--aura-primary)",
        borderRadius: "50%",
        animation: "cores-spin 0.7s linear infinite",
        verticalAlign: "middle",
        marginLeft: 6,
      }}
    />
  );
}

/**
 * One row in the cores detail list. Renders the core name, version, status
 * badge, action buttons, and any inline error. The status badge springs on
 * change; the row fades in as part of the list stagger.
 */
export function CoreRow({
  core,
  action,
  error,
  onInstall,
  onUpdate,
  onActivate,
}: CoreRowProps) {
  const isInstalled = Boolean(core.installedPath);
  const isBusy = action !== null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
    >
      <AuraCard
        class="cores-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          marginBottom: 6,
          background: "var(--aura-surface-2)",
          borderRadius: 10,
          border: core.active
            ? "1px solid var(--aura-secondary)"
            : "1px solid var(--aura-surface-stroke)",
        }}
      >
        {/* Core identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "var(--aura-on-surface)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {core.coreId}
          </div>
          {core.version && (
            <div
              style={{
                fontSize: 11,
                color: "var(--aura-on-surface-muted, var(--aura-primary-300))",
                marginTop: 2,
              }}
            >
              v{core.version}
            </div>
          )}
        </div>

        {/* Status badge — springs on change via layout animation */}
        <motion.div layout="position" style={{ flexShrink: 0 }}>
          <StatusBadge core={core} />
        </motion.div>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexShrink: 0,
            alignItems: "center",
          }}
        >
          {!isInstalled && (
            <AuraButton
              disabled={isBusy || undefined}
              aria-label={`Install ${core.coreId}`}
              style={{ fontSize: 12 }}
              onClick={!isBusy ? onInstall : undefined}
            >
              Install
              {action === "installing" && <Spinner />}
            </AuraButton>
          )}

          {isInstalled && !core.active && (
            <AuraButton
              disabled={isBusy || undefined}
              aria-label={`Set ${core.coreId} as active`}
              style={{ fontSize: 12 }}
              onClick={!isBusy ? onActivate : undefined}
            >
              Set active
              {action === "activating" && <Spinner />}
            </AuraButton>
          )}

          {isInstalled && (
            <AuraButton
              disabled={isBusy || undefined}
              aria-label={`Update ${core.coreId}`}
              class="secondary"
              style={{ fontSize: 12 }}
              onClick={!isBusy ? onUpdate : undefined}
            >
              Update
              {action === "updating" && <Spinner />}
            </AuraButton>
          )}
        </div>
      </AuraCard>

      {/* Inline error notice — arch-rejection or network failures */}
      {error && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 340, damping: 26 }}
          role="alert"
          style={{
            marginBottom: 8,
            padding: "8px 12px",
            borderRadius: 8,
            background: "var(--aura-primary-a15)",
            border: "1px solid var(--aura-primary-a40)",
            fontSize: 12,
            color: "var(--aura-on-surface)",
          }}
        >
          <strong>Error</strong>: {error.message}
        </motion.div>
      )}
    </motion.div>
  );
}
