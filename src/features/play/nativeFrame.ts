// Pure helpers for decoding the native-play IPC frame payload (v0.21
// "Bedrock" W214) — kept framework-free so they're unit-testable without a
// DOM, unlike the canvas painting itself (NativePlayer.tsx).

/**
 * Decodes a base64 RGBA8888 payload into raw bytes, ready for `ImageData`.
 * Typed `Uint8ClampedArray<ArrayBuffer>` (not the bare/`ArrayBufferLike`
 * default) because `ImageData`'s constructor specifically rejects a
 * `SharedArrayBuffer`-backed array — `new Uint8ClampedArray(length)` always
 * allocates a plain `ArrayBuffer` at runtime, this just makes that visible
 * to the type checker.
 */
export function decodeRgba(base64: string): Uint8ClampedArray<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * True when `bytes` is exactly `width * height * 4` long — a mismatch means
 * a truncated or corrupt IPC payload that must not be handed to `ImageData`
 * (it throws on a length that doesn't match `width * height * 4`).
 */
export function isWellFormedRgba(
  frame: { width: number; height: number },
  bytes: Uint8ClampedArray<ArrayBuffer>,
): boolean {
  return bytes.length === frame.width * frame.height * 4;
}
