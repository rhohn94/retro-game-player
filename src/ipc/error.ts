// AppError TS union — mirrors src-tauri/src/error.rs. Keep in lock-step with the
// Rust enum: every variant there has a snake_case `kind` here. See the master
// contract architecture-design.md §2 (unified IPC error contract).

/** Discriminant tags mirroring AppError's `#[serde(tag = "kind")]` variants. */
export type AppErrorKind =
  | "not_found"
  | "io"
  | "db"
  | "network"
  | "validation"
  | "unsupported"
  | "dependency"
  | "conflict"
  | "internal";

/** Serialized shape of a Rust AppError crossing the IPC boundary. */
export interface AppError {
  kind: AppErrorKind;
  detail: string;
}

const APP_ERROR_KINDS: ReadonlySet<string> = new Set<AppErrorKind>([
  "not_found",
  "io",
  "db",
  "network",
  "validation",
  "unsupported",
  "dependency",
  "conflict",
  "internal",
]);

/** Type guard: true when `e` is a well-formed AppError (tag check). */
export function isAppError(e: unknown): e is AppError {
  if (typeof e !== "object" || e === null) return false;
  const candidate = e as Record<string, unknown>;
  return (
    typeof candidate.kind === "string" &&
    APP_ERROR_KINDS.has(candidate.kind) &&
    typeof candidate.detail === "string"
  );
}

/**
 * Normalize any raw thrown value into an AppError. A well-formed AppError passes
 * through; anything else (a plain string, a transport error) is wrapped as
 * `internal` so callers always catch a typed AppError.
 */
export function decodeAppError(raw: unknown): AppError {
  if (isAppError(raw)) return raw;
  const detail =
    typeof raw === "string"
      ? raw
      : raw instanceof Error
        ? raw.message
        : JSON.stringify(raw);
  return { kind: "internal", detail };
}
