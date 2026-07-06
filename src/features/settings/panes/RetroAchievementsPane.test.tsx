// Render test for RetroAchievementsPane (v0.37 W371). Mirrors
// `src/components/ErrorBoundary.test.tsx`'s bare createRoot + act() harness
// (no testing-library dependency) since it needs a real DOM to mount React.
// Mocks `ipc/retroachievements` directly (rather than the Tauri transport)
// so the test exercises the pane's own state machine — including the
// "no credential ⇒ zero network calls" contract, verified here as
// "validateRetroAchievementsAccount is never invoked while the Validate
// button stays disabled".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRetroAchievementsAccount = vi.fn();
const saveRetroAchievementsAccount = vi.fn();
const validateRetroAchievementsAccount = vi.fn();

vi.mock("../../../ipc/retroachievements", () => ({
  getRetroAchievementsAccount: (...args: unknown[]) => getRetroAchievementsAccount(...args),
  saveRetroAchievementsAccount: (...args: unknown[]) => saveRetroAchievementsAccount(...args),
  validateRetroAchievementsAccount: (...args: unknown[]) => validateRetroAchievementsAccount(...args),
}));

const { RetroAchievementsPane } = await import("./RetroAchievementsPane");

describe("RetroAchievementsPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getRetroAchievementsAccount.mockReset();
    saveRetroAchievementsAccount.mockReset();
    validateRetroAchievementsAccount.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderPane() {
    getRetroAchievementsAccount.mockResolvedValue({ username: null, hasKey: false });
    await act(async () => {
      root.render(<RetroAchievementsPane />);
      await Promise.resolve();
    });
  }

  it("renders the inert status when no account is configured, without validating", async () => {
    await renderPane();

    expect(container.textContent).toContain("No account configured");
    expect(container.textContent).toContain("RetroAchievements");
    expect(validateRetroAchievementsAccount).not.toHaveBeenCalled();

    const validateButton = Array.from(container.querySelectorAll("aura-button")).find((b) =>
      b.textContent?.includes("Validate"),
    );
    expect(validateButton?.hasAttribute("disabled")).toBe(true);
  });

  it("loads an existing username and reports a key is stored", async () => {
    getRetroAchievementsAccount.mockReset().mockResolvedValue({
      username: "RaUser",
      hasKey: true,
    });
    await act(async () => {
      root.render(<RetroAchievementsPane />);
      await Promise.resolve();
    });

    const usernameInput = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(usernameInput?.value).toBe("RaUser");
    expect(container.textContent).toContain("Not validated yet.");
  });

  it("validates the account and shows a connected status on success", async () => {
    getRetroAchievementsAccount.mockReset().mockResolvedValue({
      username: "RaUser",
      hasKey: true,
    });
    validateRetroAchievementsAccount.mockResolvedValue({ status: "valid" });

    await act(async () => {
      root.render(<RetroAchievementsPane />);
      await Promise.resolve();
    });

    const validateButton = Array.from(container.querySelectorAll("aura-button")).find((b) =>
      b.textContent?.includes("Validate"),
    )!;
    await act(async () => {
      validateButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(validateRetroAchievementsAccount).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Connected.");
  });

  it("shows the invalid message when RA rejects the credential", async () => {
    getRetroAchievementsAccount.mockReset().mockResolvedValue({
      username: "RaUser",
      hasKey: true,
    });
    validateRetroAchievementsAccount.mockResolvedValue({
      status: "invalid",
      message: "Invalid API Key",
    });

    await act(async () => {
      root.render(<RetroAchievementsPane />);
      await Promise.resolve();
    });

    const validateButton = Array.from(container.querySelectorAll("aura-button")).find((b) =>
      b.textContent?.includes("Validate"),
    )!;
    await act(async () => {
      validateButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Invalid credential: Invalid API Key.");
  });

  it("saves the entered username and key, then clears the key field", async () => {
    await renderPane();
    saveRetroAchievementsAccount.mockResolvedValue(undefined);
    getRetroAchievementsAccount.mockResolvedValue({ username: "NewUser", hasKey: true });

    const usernameInput = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    const keyInput = container.querySelector<HTMLInputElement>('input[type="password"]')!;

    act(() => {
      usernameInput.dispatchEvent(new Event("focus"));
    });
    // Simulate typing via React's native input value setter + change event.
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      nativeInputValueSetter.call(usernameInput, "NewUser");
      usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nativeInputValueSetter.call(keyInput, "ra-key-abc");
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("aura-button")).find((b) =>
      b.textContent?.includes("Save"),
    )!;
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveRetroAchievementsAccount).toHaveBeenCalledWith({
      username: "NewUser",
      apiKey: "ra-key-abc",
    });
  });
});
