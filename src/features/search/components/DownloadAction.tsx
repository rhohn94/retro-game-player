/** The per-row ⬇ Download action for a direct_download-enabled provider
 * (v0.24 W244, #30): idle button → inline determinate progress + Cancel →
 * "✓ In library — Play" + Reveal file (v0.45), with failures and
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

type DownloadState =
  | { kind: "idle" }
  | { kind: "downloading"; id: number; pct: number | null }
  | { kind: "done"; gameId: number; alreadyPresent: boolean; filePath?: string }
  | { kind: "unrecognized"; stagedPath: string; reason?: string }
  | { kind: "error"; message: string };

const label = { fontSize: 11, flexShrink: 0 } as const;

export function DownloadAction({
  providerId,
  url,
  title,
}: {
  providerId: number;
  url: string;
  /** Result title — helps hop-2 pick the matching file on HTML detail pages. */
  title?: string;
}) {
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
          setState({
            kind: "done",
            gameId: e.gameId,
            alreadyPresent: e.alreadyPresent ?? false,
            filePath: e.filePath,
          });
        } else if (e.stagedPath)
          setState({
            kind: "unrecognized",
            stagedPath: e.stagedPath,
            reason: e.reason,
          });
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
    startDownload(providerId, url, title)
      .then((id) => {
        idRef.current = id;
        setState({ kind: "downloading", id, pct: null });
      })
      .catch((err: unknown) => {
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
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
          onClick={() => void cancelDownload(state.id)}
          style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-error)" }}
        >
          cancel
        </button>
      </span>
    );
  }
  if (state.kind === "done") {
    return (
      <span style={{ ...label, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => navigate(`/game/${state.gameId}`)}
          title={state.alreadyPresent ? "Already in your library" : "Imported into your library"}
          style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-primary)" }}
        >
          ✓ In library — Play
        </button>
        {state.filePath && (
          <button
            type="button"
            onClick={() => void revealItemInDir(state.filePath!)}
            title={state.filePath}
            style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-on-surface-muted)" }}
          >
            reveal file
          </button>
        )}
      </span>
    );
  }
  if (state.kind === "unrecognized") {
    const msg = state.reason?.trim() || "not a recognized ROM";
    const short = msg.length > 72 ? `${msg.slice(0, 72)}…` : msg;
    return (
      <span
        style={{
          ...label,
          color: "var(--aura-on-surface-muted)",
          display: "inline-flex",
          gap: 6,
          alignItems: "center",
          flexWrap: "wrap",
          maxWidth: 420,
        }}
        title={msg}
      >
        <span style={{ lineHeight: 1.25 }}>{short}</span>
        <button
          type="button"
          onClick={() => void revealItemInDir(state.stagedPath)}
          style={{ ...label, background: "none", border: "none", cursor: "pointer", color: "var(--aura-primary)" }}
        >
          reveal
        </button>
        <button
          type="button"
          onClick={() =>
            void discardStagedDownload(state.stagedPath).then(() => setState({ kind: "idle" }))
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
      ⚠ {state.message.length > 60 ? `${state.message.slice(0, 60)}…` : state.message}
    </span>
  );
}
