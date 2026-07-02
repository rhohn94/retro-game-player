import { describe, expect, it } from "vitest";
import { FRAME_HEADER_BYTES, parseFrameBuffer } from "./nativeFrame";

/** Builds a wire-format buffer the way the Rust encoder does. */
function encodeFrame(seq: number, width: number, height: number, pixels: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_HEADER_BYTES + pixels.length);
  const view = new DataView(buf);
  view.setBigUint64(0, BigInt(seq), true);
  view.setUint32(8, width, true);
  view.setUint32(12, height, true);
  new Uint8Array(buf, FRAME_HEADER_BYTES).set(pixels);
  return buf;
}

describe("parseFrameBuffer", () => {
  it("parses header and pixels from a well-formed payload", () => {
    const buf = encodeFrame(7, 2, 1, [255, 0, 0, 255, 0, 255, 0, 255]);
    const frame = parseFrameBuffer(buf);
    expect(frame).not.toBeNull();
    expect(frame?.seq).toBe(7);
    expect(frame?.width).toBe(2);
    expect(frame?.height).toBe(1);
    expect(Array.from(frame?.bytes ?? [])).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("returns a zero-copy view into the transferred buffer", () => {
    const buf = encodeFrame(1, 1, 1, [9, 9, 9, 255]);
    const frame = parseFrameBuffer(buf);
    expect(frame?.bytes.buffer).toBe(buf);
    expect(frame?.bytes.byteOffset).toBe(FRAME_HEADER_BYTES);
  });

  it("returns null for an empty body (no session / unchanged frame)", () => {
    expect(parseFrameBuffer(new ArrayBuffer(0))).toBeNull();
  });

  it("returns null for a null/undefined response", () => {
    expect(parseFrameBuffer(null)).toBeNull();
    expect(parseFrameBuffer(undefined)).toBeNull();
  });

  it("returns null for a header with no pixels", () => {
    const buf = encodeFrame(3, 0, 0, []);
    expect(parseFrameBuffer(buf)).toBeNull();
  });

  it("returns null when the payload length does not match the declared size", () => {
    const short = encodeFrame(5, 2, 2, [1, 2, 3, 4]); // claims 2x2 (16 bytes) but ships 4
    expect(parseFrameBuffer(short)).toBeNull();
  });
});
