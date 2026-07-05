/**
 * Unit test for the single IPC chokepoint (W367 test depth, v0.36): every
 * frontend call funnels through invoke(), which must pass a successful
 * result straight through and normalize any thrown value into a typed
 * AppError via decodeAppError. Mocks `@tauri-apps/api/core`'s `invoke` so
 * this runs without a real Tauri backend.
 */
import { describe, expect, it, vi } from "vitest";

const tauriInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => tauriInvoke(...args),
}));

const { invoke } = await import("./invoke");

describe("invoke", () => {
  it("passes the command name and args through to the underlying tauri invoke", async () => {
    tauriInvoke.mockReset().mockResolvedValue({ id: 7 });
    const result = await invoke<{ id: number }>("get_game", { id: 7 });
    expect(result).toEqual({ id: 7 });
    expect(tauriInvoke).toHaveBeenCalledWith("get_game", { id: 7 });
  });

  it("passes a well-formed AppError through unchanged, as a typed throw", async () => {
    tauriInvoke.mockReset().mockRejectedValue({ kind: "not_found", detail: "game 7" });
    const result = invoke("get_game", { id: 7 });
    await expect(result).rejects.toEqual({
      kind: "not_found",
      detail: "game 7",
    });
  });

  it("normalizes a bare transport error into an internal AppError", async () => {
    tauriInvoke.mockReset().mockRejectedValue(new Error("transport down"));
    const result = invoke("get_game", { id: 7 });
    await expect(result).rejects.toEqual({
      kind: "internal",
      detail: "transport down",
    });
  });
});
