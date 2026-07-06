// CollectionPicker — the detail-page "Add to collection" affordance beside
// the favorite heart (v0.37 W373; docs/design/collections-design.md §UI).
//
// A toggle button opens a small dropdown panel listing every collection as a
// checkbox row (checked = the current game is a member); toggling a row adds
// or removes membership immediately (optimistic, mirroring
// GameDetailPage's favorite toggle). An inline "New collection…" row lets the
// user create-and-add in one step without leaving the picker.

import { useCallback, useEffect, useState } from "react";
import { AuraButton, AuraField } from "@aura/react";
import {
  addGameToCollection,
  createCollection,
  listCollectionIdsForGame,
  listCollections,
  removeGameFromCollection,
  type CollectionWithCount,
} from "../../ipc/collections";
import { isValidNewCollectionName, sortCollectionsForPicker } from "./collectionPickerLogic";
import { swallow } from "../../ipc/swallow";

interface CollectionPickerProps {
  gameId: number;
}

/** The detail-page collection-membership picker for `gameId`. */
export function CollectionPicker({ gameId }: CollectionPickerProps) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionWithCount[]>([]);
  const [memberIds, setMemberIds] = useState<ReadonlySet<number>>(() => new Set());
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    Promise.all([listCollections(), listCollectionIdsForGame(gameId)])
      .then(([all, ids]) => {
        if (cancelled) return;
        setCollections(all);
        setMemberIds(new Set(ids));
        setLoaded(true);
      })
      .catch((err: unknown) => swallow(err, "CollectionPicker.load"));
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // Load once the picker is first opened, not on every mount — the detail
  // page's picker is a small affordance most sessions never click.
  useEffect(() => {
    if (open && !loaded) return load();
  }, [open, loaded, load]);

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

  const sorted = sortCollectionsForPicker(collections);

  return (
    <div className="rgp-collection-picker">
      <button
        type="button"
        className="rgp-collection-picker__toggle"
        aria-expanded={open}
        aria-label="Add to collection"
        onClick={() => setOpen((v) => !v)}
      >
        ＋ Collection
      </button>

      {open && (
        <div className="rgp-collection-picker__panel" role="menu">
          {sorted.length === 0 && loaded && (
            <p className="rgp-collection-picker__empty">No collections yet.</p>
          )}
          {sorted.map((c) => {
            const member = memberIds.has(c.id);
            return (
              <label key={c.id} className="rgp-collection-picker__row">
                <input
                  type="checkbox"
                  checked={member}
                  onChange={() => onToggleMember(c.id, member)}
                />
                <span className="rgp-collection-picker__name">{c.name}</span>
                <span className="rgp-collection-picker__count">{c.gameCount}</span>
              </label>
            );
          })}

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
    </div>
  );
}
