// Typed wrappers for the `collections` domain (v0.37 W373; see
// docs/design/collections-design.md). Each function calls `invoke` with the
// command name + camelCase args and resolves a typed return or throws a typed
// AppError. One wrapper per Rust command, mirroring `commands/collections.rs`
// 1:1 (per the one-wrapper-per-command header convention).

import { invoke } from "./invoke";
import type { Game } from "./library";

/** A user-created library collection (mirrors Rust `CollectionDto`). */
export interface Collection {
  id: number;
  name: string;
  createdAt: number;
  sort: number;
}

/** A collection paired with its member count (mirrors Rust
 * `CollectionWithCountDto`), for the library filter chip row and the
 * detail-page picker. */
export interface CollectionWithCount extends Collection {
  gameCount: number;
}

/** Create a collection; returns the persisted row. Throws a `"conflict"`
 * AppError if `name` is already taken. */
export function createCollection(name: string): Promise<Collection> {
  return invoke<Collection>("create_collection", { name });
}

/** Rename a collection. Throws `"not_found"` if absent, `"conflict"` if the
 * new name collides with another collection. */
export function renameCollection(id: number, name: string): Promise<void> {
  return invoke<void>("rename_collection", { id, name });
}

/** Delete a collection (cascades to its memberships only — member games are
 * never deleted). Throws `"not_found"` if absent. */
export function deleteCollection(id: number): Promise<void> {
  return invoke<void>("delete_collection", { id });
}

/** List every collection with its member count. */
export function listCollections(): Promise<CollectionWithCount[]> {
  return invoke<CollectionWithCount[]>("list_collections");
}

/** Add a game to a collection. Throws `"conflict"` on a double-add. */
export function addGameToCollection(collectionId: number, gameId: number): Promise<void> {
  return invoke<void>("add_game_to_collection", { collectionId, gameId });
}

/** Remove a game from a collection. Throws `"not_found"` if it was not a
 * member. */
export function removeGameFromCollection(collectionId: number, gameId: number): Promise<void> {
  return invoke<void>("remove_game_from_collection", { collectionId, gameId });
}

/** List every game in a collection, most-recently-added first. Throws
 * `"not_found"` if the collection doesn't exist. */
export function listGamesByCollection(collectionId: number): Promise<Game[]> {
  return invoke<Game[]>("list_games_by_collection", { collectionId });
}

/** List the ids of every collection a game belongs to — seeds the
 * detail-page picker's checked state. */
export function listCollectionIdsForGame(gameId: number): Promise<number[]> {
  return invoke<number[]>("list_collection_ids_for_game", { gameId });
}
