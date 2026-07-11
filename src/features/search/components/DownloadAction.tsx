/** The per-row ⬇ Download action for a direct_download-enabled provider
 * (v0.24 W244, #30): idle button → inline determinate progress + Cancel →
 * "✓ In library — Play" (deep link to the detail page), with failures and
 * the unrecognized-file resolution (Reveal / Discard) rendered in-row —
 * never a modal. */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  cancelDownload,
  discardStagedDownload,
  onDownloadEvents,
  startDownload,
} from "../../../ipc/downloads";
import { revealItemInDir } from "../../../ipc/opener";
import { swallow } from "../../../ipc/swallow";

type DownloadState =
  | { kind: "idle" }
  | { kind: "downloading"; id: number; pct: number | null }
  | { kind: "done"; gameId: number; alreadyPresent: boolean }
  | { kind: "unrecognized"; stagedPath: string }
  | { kind: "error"; message: string };

const label = { fontSize: 11, flexShrink: 0 } as const;

/** Error messages are truncated in the row so a long IPC failure never blows
 *  out the layout; the full text stays available in the `title` tooltip. */
const ERROR_MESSAGE_TRUNCATE_LEN = 60;

/** Normalize a caught value into a displayable message (shared by every
 *  catch site below so the extraction logic never drifts between them). */
function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function DownloadAction({ providerId, url }: { providerId: number; url: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<DownloadState>({ kind: "idle" });
  const idRef = useRef<number | null>(null);

  // One event subscription per row while a download is in flight.
  useEffect(() => {
    if (state.kind !== "downloading") return;
    let unsub: (() => void) | undefined;
    let disposed = false;
    void onDownloadEvents({
      progress: (e) => {
        if (e.id !== idRef.current) return;
        setState((s) =>
          s.kind === "downloading"
            ? { ...s, pct: e.total ? Math.round((e.received / e.total) * 100) : null }
            : s,
        );
      },
      done: (e) => {
        if (e.id !== idRef.current) return;
        if (e.error) setState({ kind: "error", message: e.error });
        else if (typeof e.gameId === "number") {
          setState({ kind: "done", gameId: e.gameId, alreadyPresent: e.alreadyPresent ?? false });
        } else if (e.stagedPath) setState({ kind: "unrecognized", stagedPath: e.stagedPath });
        else setState({ kind: "error", message: "download ended without a result" });
      },
    }).then((u) => {
      if (disposed) u();
      else unsub = u;
    });
    return () => {
      disposed = true;
      unsub?.();
    };
  }, [state.kind]);

  const begin = () => {
    startDownload(providerId, url)
      .then((id) => {
        idRef.current = id;
        setState({ kind: "downloading", id, pct: null });
      })
      .catch((err: unknown) => {
        setState({ kind: "error", message: toErrorMessage(err) });
      });
  };

  if (state.kind === "idle") {
    return (
      <button
        type="button"
        onClick={begin}
        title="Download this file into your library"
        style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-primary)" }}
      >
        ⬇ download
      </button>
    );
  }
  if (state.kind === "downloading") {
    return (
      <span style={{ ...label, color: "var(--aura-on-surface-muted)", display: "inline-flex", gap: 6 }}>
        {state.pct === null ? "downloading…" : `${state.pct}%`}
        <button
          type="button"
          onClick={() =>
            void cancelDownload(state.id).catch((err: unknown) =>
              setState({ kind: "error", message: toErrorMessage(err) }),
            )
          }
          style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-error)" }}
        >
          cancel
        </button>
      </span>
    );
  }
  if (state.kind === "done") {
    return (
      <button
        type="button"
        onClick={() => navigate(`/game/${state.gameId}`)}
        title={state.alreadyPresent ? "Already in your library" : "Imported into your library"}
        style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-primary)" }}
      >
        ✓ In library — Play
      </button>
    );
  }
  if (state.kind === "unrecognized") {
    return (
      <span style={{ ...label, color: "var(--aura-on-surface-muted)", display: "inline-flex", gap: 6 }}>
        not a recognized ROM
        <button
          type="button"
          onClick={() =>
            void revealItemInDir(state.stagedPath).catch((err: unknown) =>
              swallow(err, "DownloadAction.reveal"),
            )
          }
          style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-primary)" }}
        >
          reveal
        </button>
        <button
          type="button"
          onClick={() =>
            void discardStagedDownload(state.stagedPath)
              .then(() => setState({ kind: "idle" }))
              .catch((err: unknown) => setState({ kind: "error", message: toErrorMessage(err) }))
          }
          style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-error)" }}
        >
          discard
        </button>
      </span>
    );
  }
  return (
    <span style={{ ...label, color: "var(--aura-error)" }} title={state.message}>
      ⚠{" "}
      {state.message.length > ERROR_MESSAGE_TRUNCATE_LEN
        ? `${state.message.slice(0, ERROR_MESSAGE_TRUNCATE_LEN)}…`
        : state.message}
    </span>
  );
}
