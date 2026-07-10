// CollectionPicker — the detail-page "Add to collection" affordance beside
// the favorite heart (v0.37 W373; docs/design/collections-design.md §UI).
//
// A toggle button opens a small dropdown panel listing every collection as a
// checkbox row (checked = the current game is a member); toggling a row adds
// or removes membership immediately (optimistic, mirroring
// GameDetailPage's favorite toggle). An inline "New collection…" row lets the
// user create-and-add in one step without leaving the picker.
//
// v0.38 W385 (docs/design/collections-design.md §Management UX) adds: a
// loading state while the initial fetch is in flight, a visible error state
// if it fails (both previously silently swallowed), and per-row rename
// (inline edit, reusing the inline-create input pattern) + delete (behind
// DeleteCollectionDialog's confirmation) affordances.

import { useCallback, useEffect, useRef, useState } from "react";
import { AuraButton, AuraField } from "@aura/react";
import {
  addGameToCollection,
  createCollection,
  listCollectionIdsForGame,
  listCollections,
  removeGameFromCollection,
  renameCollection,
  type CollectionWithCount,
} from "../../ipc/collections";
import { isAppError } from "../../ipc/commands";
import { isValidNewCollectionName, sortCollectionsForPicker } from "./collectionPickerLogic";
import { swallow } from "../../ipc/swallow";
import { LoadingState } from "../../components/LoadingState";
import { ErrorNotice } from "../../components/ErrorNotice";
import { DeleteCollectionDialog } from "./DeleteCollectionDialog";
import { useController } from "../controller";

interface CollectionPickerProps {
  gameId: number;
}

/** The detail-page collection-membership picker for `gameId`. */
export function CollectionPicker({ gameId }: CollectionPickerProps) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionWithCount[]>([]);
  const [memberIds, setMemberIds] = useState<ReadonlySet<number>>(() => new Set());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CollectionWithCount | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoadError(null);
    Promise.all([listCollections(), listCollectionIdsForGame(gameId)])
      .then(([all, ids]) => {
        if (cancelled) return;
        setCollections(all);
        setMemberIds(new Set(ids));
        setLoaded(true);
      })
      .catch((err: unknown) => {
        swallow(err, "CollectionPicker.load");
        if (!cancelled) {
          setLoadError(isAppError(err) ? err.detail : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // Load once the picker is first opened, not on every mount — the detail
  // page's picker is a small affordance most sessions never click.
  useEffect(() => {
    if (open && !loaded && !loadError) return load();
  }, [open, loaded, loadError, load]);

  // Optimistic toggle: flips the local membership set immediately, then
  // persists; a failed persist reverts so the displayed state never drifts
  // from the database's (mirrors GameDetailPage's favorite toggle).
  const onToggleMember = useCallback(
    (collectionId: number, currentlyMember: boolean) => {
      setMemberIds((prev) => {
        const next = new Set(prev);
        if (currentlyMember) next.delete(collectionId);
        else next.add(collectionId);
        return next;
      });
      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId
            ? { ...c, gameCount: c.gameCount + (currentlyMember ? -1 : 1) }
            : c,
        ),
      );
      const revert = () => {
        setMemberIds((prev) => {
          const next = new Set(prev);
          if (currentlyMember) next.add(collectionId);
          else next.delete(collectionId);
          return next;
        });
        setCollections((prev) =>
          prev.map((c) =>
            c.id === collectionId
              ? { ...c, gameCount: c.gameCount + (currentlyMember ? 1 : -1) }
              : c,
          ),
        );
      };
      const op = currentlyMember
        ? removeGameFromCollection(collectionId, gameId)
        : addGameToCollection(collectionId, gameId);
      void op.catch((err: unknown) => {
        revert();
        swallow(err, "CollectionPicker.toggleMember");
      });
    },
    [gameId],
  );

  const onCreate = useCallback(() => {
    if (!isValidNewCollectionName(newName, collections)) return;
    const name = newName.trim();
    setCreating(true);
    setCreateError(null);
    createCollection(name)
      .then((created) => {
        setCollections((prev) => [...prev, { ...created, gameCount: 1 }]);
        setMemberIds((prev) => new Set(prev).add(created.id));
        setNewName("");
        return addGameToCollection(created.id, gameId).catch((err: unknown) =>
          swallow(err, "CollectionPicker.createThenAdd"),
        );
      })
      .catch((err: unknown) => {
        setCreateError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setCreating(false));
  }, [newName, collections, gameId]);

  const startRename = useCallback((c: CollectionWithCount) => {
    setRenamingId(c.id);
    setRenameValue(c.name);
    setRenameError(null);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
    setRenameError(null);
  }, []);

  const isValidRenameValue = useCallback(
    (id: number, value: string) =>
      isValidNewCollectionName(
        value,
        collections.filter((c) => c.id !== id),
      ),
    [collections],
  );

  const confirmRename = useCallback(() => {
    if (renamingId == null || !isValidRenameValue(renamingId, renameValue)) return;
    const id = renamingId;
    const name = renameValue.trim();
    setRenaming(true);
    setRenameError(null);
    renameCollection(id, name)
      .then(() => {
        setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
        setRenamingId(null);
        setRenameValue("");
      })
      .catch((err: unknown) => {
        setRenameError(isAppError(err) ? err.detail : String(err));
      })
      .finally(() => setRenaming(false));
  }, [renamingId, renameValue, isValidRenameValue]);

  const onDeleted = useCallback((collectionId: number) => {
    setCollections((prev) => prev.filter((c) => c.id !== collectionId));
    setMemberIds((prev) => {
      if (!prev.has(collectionId)) return prev;
      const next = new Set(prev);
      next.delete(collectionId);
      return next;
    });
  }, []);

  // Escape must close THIS panel — or, mid-rename, just cancel the rename —
  // rather than falling through to the shell's default `back` handler
  // (`navigate(-1)` in App.tsx), matching the CreateGamesFolderDialog /
  // DeleteCollectionDialog exclusive-claim convention (issue #29 remainder,
  // W394): without this, opening the picker and pressing Escape unexpectedly
  // navigated away from the detail page instead of just closing the picker.
  // Refs mirror the latest renaming/cancel state so the claim effect only
  // re-subscribes when `open` itself changes, not on every rename keystroke.
  const { claimExclusive } = useController();
  const renamingIdRef = useRef(renamingId);
  renamingIdRef.current = renamingId;
  const cancelRenameRef = useRef(cancelRename);
  cancelRenameRef.current = cancelRename;
  useEffect(() => {
    if (!open) return;
    return claimExclusive((action) => {
      if (action !== "back" && action !== "quit") return;
      if (renamingIdRef.current != null) cancelRenameRef.current();
      else setOpen(false);
    }, "ui");
  }, [open, claimExclusive]);

  const sorted = sortCollectionsForPicker(collections);
  const panelId = `collection-picker-panel-${gameId}`;

  return (
    <div className="rgp-collection-picker">
      <button
        type="button"
        className="rgp-collection-picker__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Add to collection"
        onClick={() => setOpen((v) => !v)}
      >
        ＋ Collection
      </button>

      {open && (
        <div
          className="rgp-collection-picker__panel"
          id={panelId}
          role="group"
          aria-label="Collections"
          onKeyDown={(e) => {
            // Local, direct-DOM Escape handling (mirrors every other dialog's
            // onKeyDown convention in this codebase) — `preventDefault` stops
            // the global keyboard bridge from ALSO dispatching a `back`
            // semantic action for this same keypress, so a mid-rename Escape
            // cancels the rename exactly once rather than closing the panel too.
            if (e.key !== "Escape") return;
            e.preventDefault();
            if (renamingId != null) cancelRename();
            else setOpen(false);
          }}
        >
          {!loaded && !loadError && (
            <LoadingState>Loading collections…</LoadingState>
          )}
          {loadError && (
            <ErrorNotice>Could not load collections: {loadError}</ErrorNotice>
          )}
          {loaded && sorted.length === 0 && (
            <p className="rgp-collection-picker__empty">No collections yet.</p>
          )}
          {loaded &&
            sorted.map((c) => {
              const member = memberIds.has(c.id);
              if (renamingId === c.id) {
                return (
                  <div key={c.id} className="rgp-collection-picker__row rgp-collection-picker__row--renaming">
                    <AuraField>
                      <input
                        type="text"
                        className="rgp-input"
                        aria-label={`Rename ${c.name}`}
                        value={renameValue}
                        disabled={renaming}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmRename();
                          if (e.key === "Escape") {
                            // Stop this Escape from also reaching the panel's
                            // own Escape handler above (bubbling) — cancelling
                            // the rename is the complete action; the panel
                            // should stay open for a second Escape to close it.
                            e.stopPropagation();
                            cancelRename();
                          }
                        }}
                      />
                    </AuraField>
                    <AuraButton
                      variant="ghost"
                      disabled={renaming || !isValidRenameValue(c.id, renameValue)}
                      onClick={confirmRename}
                    >
                      Save
                    </AuraButton>
                    <AuraButton variant="ghost" disabled={renaming} onClick={cancelRename}>
                      Cancel
                    </AuraButton>
                  </div>
                );
              }
              return (
                <div key={c.id} className="rgp-collection-picker__row">
                  <label className="rgp-collection-picker__row-label">
                    <input
                      type="checkbox"
                      checked={member}
                      onChange={() => onToggleMember(c.id, member)}
                    />
                    <span className="rgp-collection-picker__name">{c.name}</span>
                    <span className="rgp-collection-picker__count">{c.gameCount}</span>
                  </label>
                  <div className="rgp-collection-picker__row-actions">
                    <button
                      type="button"
                      className="rgp-collection-picker__row-action"
                      aria-label={`Rename ${c.name}`}
                      onClick={() => startRename(c)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="rgp-collection-picker__row-action"
                      aria-label={`Delete ${c.name}`}
                      onClick={() => setDeleteTarget(c)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          {renameError && <p className="rgp-collection-picker__error">{renameError}</p>}

          <div className="rgp-collection-picker__new">
            <AuraField>
              <input
                type="text"
                className="rgp-input"
                placeholder="New collection…"
                aria-label="New collection name"
                value={newName}
                disabled={creating}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCreate();
                }}
              />
            </AuraField>
            <AuraButton
              variant="ghost"
              disabled={creating || !isValidNewCollectionName(newName, collections)}
              onClick={onCreate}
            >
              Add
            </AuraButton>
          </div>
          {createError && <p className="rgp-collection-picker__error">{createError}</p>}
        </div>
      )}

      {deleteTarget && (
        <DeleteCollectionDialog
          open
          collectionId={deleteTarget.id}
          collectionName={deleteTarget.name}
          onClose={() => setDeleteTarget(null)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
