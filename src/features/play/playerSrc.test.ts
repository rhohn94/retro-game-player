import { describe, expect, it } from "vitest";
import { buildPlayerSrc } from "./playerSrc";

describe("buildPlayerSrc", () => {
  it("builds the core/game/name query string against the given origin", () => {
    const src = buildPlayerSrc({
      origin: "http://127.0.0.1:4000",
      ejsSystem: "nes",
      gameId: 7,
      gameName: "Some Game",
    });
    expect(src.startsWith("http://127.0.0.1:4000/player.html?")).toBe(true);
    const url = new URL(src);
    expect(url.searchParams.get("core")).toBe("nes");
    expect(url.searchParams.get("game")).toBe("7");
    expect(url.searchParams.get("name")).toBe("Some Game");
    expect(url.searchParams.has("preview")).toBe(false);
  });

  it("omits the preview flag by default (unchanged for every non-preview mount)", () => {
    const src = buildPlayerSrc({ origin: "http://x", ejsSystem: "snes", gameId: 1, gameName: "G" });
    expect(new URL(src).searchParams.has("preview")).toBe(false);
  });

  it("appends preview=1 for a W376 TV hover-attract preview mount", () => {
    const src = buildPlayerSrc({
      origin: "http://x",
      ejsSystem: "snes",
      gameId: 1,
      gameName: "G",
      preview: true,
    });
    expect(new URL(src).searchParams.get("preview")).toBe("1");
  });

  it("percent-encodes a display name with spaces/special characters", () => {
    const src = buildPlayerSrc({
      origin: "http://x",
      ejsSystem: "nes",
      gameId: 1,
      gameName: "Foo & Bar / Baz",
    });
    // Resolves against a real URL/query parser (URLSearchParams), not just a
    // literal string match — the same parse player.html itself performs via
    // `new URLSearchParams(location.search)`.
    expect(new URL(src).searchParams.get("name")).toBe("Foo & Bar / Baz");
  });

  it("resolves to a path a real running play server actually serves", () => {
    // player.html is served at exactly this path (src-tauri/src/play/server.rs
    // matches `path == "/player.html"`, query string stripped before the
    // match) — asserting the pathname (not just the string shape) ties this
    // test to the real served route rather than an assumed one.
    const src = buildPlayerSrc({ origin: "http://127.0.0.1:1", ejsSystem: "nes", gameId: 1, gameName: "G" });
    expect(new URL(src).pathname).toBe("/player.html");
  });
});
