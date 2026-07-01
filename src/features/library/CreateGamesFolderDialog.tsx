/**
 * CreateGamesFolderDialog — the confirm-first "create a games folder" flow (W52).
 *
 * Shown from an empty Library or an empty Settings → Folders pane. On open it
 * fetches the suggested default path (`~/Games`) and pre-fills an editable field
 * so the user ALWAYS confirms (and may change) the location before anything is
 * written — there are no silent filesystem writes. On confirm it chains
 * createGamesFolder → addContentFolder → rescan so the new directory is
 * immediately a scannable content folder, then calls `onCreated`.
 *
 * Reused by both empty states; each caller refreshes its own view in `onCreated`.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { revealItemInDir } from "../../ipc/opener";
import { AuraDialog, AuraButton, AuraField } from "@aura/react";
import { dialogPop } from "../../lib/motion";
import { useCancellableEffect } from "../../hooks/useCancellableEffect";
import {
  addContentFolder,
  createGamesFolder,
  rescan,
  suggestGamesDir,
} from "../../ipc/library";
import { isAppError } from "../../ipc/commands";

interface CreateGamesFolderDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fires after the folder is created + registered; receives the absolute path. */
  onCreated: (path: string) => void;
}

export function CreateGamesFolderDialog({
  open,
  onClose,
  onCreated,
}: CreateGamesFolderDialogProps) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The absolute path once creation succeeds — drives the success confirmation.
  const [createdPath, setCreatedPath] = useState<string | null>(null);

  // Pre-fill the suggested default path each time the dialog opens, and reset
  // any prior success/error state so a reopen starts on the form.
  useCancellableEffect(
    (isCancelled) => {
      if (!open) return;
      setError(null);
      setCreatedPath(null);
      suggestGamesDir()
        .then((p) => {
          if (!isCancelled()) setPath(p);
        })
        .catch(() => {
          /* leave the field empty; the backend falls back to the default */
        });
    },
    [open],
  );

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const created = await createGamesFolder(path.trim() || undefined);
      // Register it as a content folder so it scans. A repeat run hits the
      // UNIQUE(path) constraint → "conflict"; that is fine (already added).
      try {
        await addContentFolder(created);
      } catch (e: unknown) {
        if (!(isAppError(e) && e.kind === "conflict")) throw e;
      }
      await rescan();
      onCreated(created); // refresh the caller's view (library / settings)
      // Stay open and confirm success instead of closing silently — a fresh
      // folder is empty, so without this it looks like nothing happened.
      setCreatedPath(created);
    } catch (e: unknown) {
      const detail = isAppError(e) ? e.detail : String(e);
      setError(detail);
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    if (!createdPath) return;
    try {
      await revealItemInDir(createdPath);
    } catch {
      /* best-effort; non-fatal if the reveal fails */
    }
  }

  if (!open) return null;

  return (
    <AuraDialog
      class="harmony-games-dialog"
      open
      style={{ "--aura-dialog-width": "460px" } as React.CSSProperties}
    >
      <motion.div
        initial={dialogPop.initial}
        animate={dialogPop.animate}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && createdPath) onClose();
          else if (e.key === "Enter" && !busy) void handleConfirm();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 16, padding: 4 }}
      >
        {createdPath ? (
          // ── Success: confirm the folder was created + offer to reveal it ──
          <>
            <h3 style={{ margin: 0, fontSize: 16 }}>✓ Games folder ready</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
              Created and now watching this folder for games. It’s empty for now —
              drop ROMs in and rescan, or reveal it in Finder to add some.
            </p>
            <code
              style={{
                fontFamily: "monospace",
                fontSize: 13,
                background: "var(--aura-surface-raised)",
                padding: "var(--aura-space-2) var(--harmony-space-2-5)",
                borderRadius: "var(--aura-radius-sm)",
                wordBreak: "break-all",
                color: "var(--aura-on-surface)",
              }}
            >
              {createdPath}
            </code>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <AuraButton variant="secondary" onClick={() => void handleReveal()}>
                Reveal in Finder
              </AuraButton>
              <AuraButton variant="primary" onClick={onClose}>
                Done
              </AuraButton>
            </div>
          </>
        ) : (
          // ── Form: confirm/edit the location before any write ──
          <>
            <h3 style={{ margin: 0, fontSize: 16 }}>Create a games folder</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
              Harmony will create this folder (if it doesn’t exist) and start
              watching it for games. Existing files are never touched.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                htmlFor="games-dir-path"
                style={{ fontSize: 12, color: "var(--aura-on-surface-muted)" }}
              >
                Location
              </label>
              <AuraField>
                <input
                  id="games-dir-path"
                  name="games-dir-path"
                  className="harmony-input"
                  type="text"
                  value={path}
                  placeholder="~/Games"
                  onChange={(e) => setPath(e.target.value)}
                />
              </AuraField>
            </div>

            {error && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--aura-error)" }}>{error}</p>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <AuraButton variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </AuraButton>
              <AuraButton
                variant="primary"
                disabled={busy}
                onClick={() => void handleConfirm()}
              >
                {busy ? "Creating…" : "Create folder"}
              </AuraButton>
            </div>
          </>
        )}
      </motion.div>
    </AuraDialog>
  );
}
