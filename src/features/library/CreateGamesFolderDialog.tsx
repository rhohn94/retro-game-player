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
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AuraDialog, AuraButton, AuraField } from "@aura/react";
import { dialogPop } from "../../lib/motion";
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

  // Pre-fill the suggested default path each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    suggestGamesDir()
      .then((p) => {
        if (!cancelled) setPath(p);
      })
      .catch(() => {
        /* leave the field empty; the backend falls back to the default */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
      onCreated(created);
      onClose();
    } catch (e: unknown) {
      const detail = isAppError(e) ? e.detail : String(e);
      setError(detail);
    } finally {
      setBusy(false);
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
          if (e.key === "Enter" && !busy) void handleConfirm();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 16, padding: 4 }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>Create a games folder</h3>
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
          Harmony will create this folder (if it doesn’t exist) and start watching
          it for games. Existing files are never touched.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
            Location
          </label>
          <AuraField
            name="games-dir-path"
            type="text"
            value={path}
            placeholder="~/Games"
            events={{
              "aura-field:input": (e) =>
                setPath((e as CustomEvent<{ value: string }>).detail.value),
            }}
          />
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-error)" }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <AuraButton variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </AuraButton>
          <AuraButton variant="primary" disabled={busy} onClick={() => void handleConfirm()}>
            {busy ? "Creating…" : "Create folder"}
          </AuraButton>
        </div>
      </motion.div>
    </AuraDialog>
  );
}
