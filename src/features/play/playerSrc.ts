// playerSrc — builds the `player.html` iframe URL InPagePlayer embeds (v0.15).
// A pure, unit-tested module so the query-string shape (and the v0.37 W376
// `preview` flag save-bridge purity depends on) can't drift from what
// vendor/player.html's own `URLSearchParams(location.search)` parse actually
// expects, without needing a DOM to verify it.

/** Inputs needed to address one game's session on the loopback play origin. */
export interface PlayerSrcOptions {
  origin: string;
  ejsSystem: string;
  gameId: number;
  gameName: string;
  /** W376: when true, appends `&preview=1` — vendor/player.html's save
   * bridge gates every SRAM/save-state read+write on this exact flag (the
   * byte-identical-saves purity guarantee for the TV hover-attract preview,
   * tv-mode-design.md §v0.37 → W376). Omitted (or false) for every other
   * mount, matching pre-W376 URLs exactly. */
  preview?: boolean;
}

/** Builds the `<origin>/player.html?...` URL embedded as the iframe `src`. */
export function buildPlayerSrc({
  origin,
  ejsSystem,
  gameId,
  gameName,
  preview = false,
}: PlayerSrcOptions): string {
  const params = new URLSearchParams({
    core: ejsSystem,
    game: String(gameId),
    name: gameName,
  });
  if (preview) params.set("preview", "1");
  return `${origin}/player.html?${params.toString()}`;
}
