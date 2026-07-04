import { describe, expect, it } from "vitest";
import { buildPreviewFrame, PREVIEW_HEIGHT, PREVIEW_WIDTH } from "./crtPreviewPattern";

describe("buildPreviewFrame", () => {
  it("returns a buffer sized for the requested dimensions (RGBA8888)", () => {
    const frame = buildPreviewFrame(16, 8);
    expect(frame.length).toBe(16 * 8 * 4);
  });

  it("defaults to the module's exported preview dimensions", () => {
    const frame = buildPreviewFrame();
    expect(frame.length).toBe(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4);
  });

  it("every pixel is fully opaque", () => {
    const frame = buildPreviewFrame(16, 8);
    for (let i = 3; i < frame.length; i += 4) {
      expect(frame[i]).toBe(255);
    }
  });

  it("varies color across the x axis (vertical bars, not a solid fill)", () => {
    const frame = buildPreviewFrame(64, 4);
    const leftPixel = [frame[0], frame[1], frame[2]];
    const rightIndex = (64 - 1) * 4;
    const rightPixel = [frame[rightIndex], frame[rightIndex + 1], frame[rightIndex + 2]];
    expect(leftPixel).not.toEqual(rightPixel);
  });

  it("is deterministic across calls", () => {
    expect(buildPreviewFrame(32, 16)).toEqual(buildPreviewFrame(32, 16));
  });
});
