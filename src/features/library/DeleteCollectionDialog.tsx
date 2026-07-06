// DeleteCollectionDialog — the confirm-first "delete collection" prompt for
// the detail-page CollectionPicker's row menu (v0.38 W385;
// docs/design/collections-design.md §Management UX).
//
// States plainly that games are NOT deleted, only the grouping. While open it
// claims the controller's exclusive "ui" slot (the TvSystemMenu precedent, W278)
// so a controller Back/Escape closes THIS dialog rather than falling through
// to the underlying page/picker; keyboard Escape does the same for
// pointer/keyboard-only sessions.

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AuraDialog, AuraButton } from "@aura/react";
import { dialogPop } from "../../lib/motion";
import { useController } from "../controller";
import { deleteCollection } from "../../ipc/collections";
import { isAppError } from "../../ipc/commands";

interface DeleteCollectionDialogProps {
  open: boolean;
  collectionId: number;
  collectionName: string;
  onClose: () => void;
  /** Fires once the collection is successfully deleted. */
  onDeleted: (collectionId: number) => void;
}

/** Confirmation dialog for deleting a collection. */
export function DeleteCollectionDialog({
  open,
  collectionId,
  collectionName,
  onClose,
  onDeleted,
}: DeleteCollectionDialogProps) {
  const { claimExclusive } = useController();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Claim the exclusive "ui" controller slot for the dialog's mount
  // lifetime, mirroring TvSystemMenu: Back/Escape closes THIS dialog only,
  // never falls through to the page beneath it.
  useEffect(() => {
    if (!open) return;
    return claimExclusive((action) => {
      if (action === "back" || action === "quit") onClose();
    }, "ui");
  }, [open, claimExclusive, onClose]);

  const handleConfirm = useCallback(() => {
    setBusy(true);
    setError(null);
    deleteCollection(collectionId)
      .then(() => {
        onDeleted(collectionId);
        onClose();
      })
      .catch((err: unknown) => {
        setError(isAppError(err) ? err.detail : String(err));
      })
      .finally(() => setBusy(false));
  }, [collectionId, onDeleted, onClose]);

  if (!open) return null;

  return (
    <AuraDialog
      class="rgp-delete-collection-dialog"
      open
      style={{ "--aura-dialog-width": "420px" } as React.CSSProperties}
    >
      <motion.div
        initial={dialogPop.initial}
        animate={dialogPop.animate}
        exit={dialogPop.exit}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 16, padding: 4 }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>Delete “{collectionName}”?</h3>
        <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
          This only removes the collection itself. Games in it are not deleted
          and stay in your library.
        </p>
        {error && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-error)" }} role="alert">
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <AuraButton variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </AuraButton>
          <AuraButton variant="primary" disabled={busy} onClick={handleConfirm}>
            {busy ? "Deleting…" : "Delete collection"}
          </AuraButton>
        </div>
      </motion.div>
    </AuraDialog>
  );
}
