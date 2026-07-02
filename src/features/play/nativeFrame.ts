// Pure helpers for parsing the native-play raw-bytes IPC frame payload
// (v0.23.1 W239) — kept framework-free so they're unit-testable without a
// DOM, unlike the canvas painting itself (NativePlayer.tsx).

/** Bytes of header before the RGBA pixels — mirrors the Rust encoder
 * (`commands/native_play.rs`): `[seq: u64 LE][width: u32 LE][height: u32 LE]`. */
export const FRAME_HEADER_BYTES = 16;

/** One parsed frame, with `bytes` viewing the transferred buffer directly
 * (zero-copy — no decode loop, unlike the retired base64 path). */
export interface ParsedFrame {
  /** The backend's frame sequence number; echo it into the next poll so an
   * unchanged frame comes back as an empty body instead of 245 KB. */
  seq: number;
  width: number;
  height: number;
  /** Tightly-packed RGBA8888, exactly `width * height * 4` long — a view
   * into the IPC buffer, ready for `new ImageData(bytes, width, height)`. */
  bytes: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Parses a `get_native_frame` response buffer. Returns `null` for "nothing
 * to paint": an empty/absent body (no session, no frame yet, or the caller
 * already painted this sequence) or a malformed payload whose length doesn't
 * match its declared dimensions (never handed to `ImageData`, which throws).
 */
export function parseFrameBuffer(buf: ArrayBuffer | null | undefined): ParsedFrame | null {
  if (!buf || buf.byteLength <= FRAME_HEADER_BYTES) return null;
  const view = new DataView(buf);
  const seq = Number(view.getBigUint64(0, true));
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  if (buf.byteLength !== FRAME_HEADER_BYTES + width * height * 4) return null;
  return {
    seq,
    width,
    height,
    bytes: new Uint8ClampedArray(buf, FRAME_HEADER_BYTES) as Uint8ClampedArray<ArrayBuffer>,
  };
}
