// Unowned (or owned) Global Catalog title detail — same shell language as
// GameDetailPage, with Find downloads as the primary CTA when not in library.
import { AuraButton, AuraCard } from "@aura/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listCatalogTitles } from "../../ipc/commands";
import { fetchCatalogTitleMeta } from "../../ipc/metadata";
import { openUrl } from "../../ipc/opener";
import { ErrorNotice } from "../../components/ErrorNotice";
import { LoadingState } from "../../components/LoadingState";
import { swallow } from "../../ipc/swallow";
import { useCatalogBoxart } from "./useCatalogBoxart";

export function CatalogTitleDetailPage() {
  const { system = "", titleEnc = "" } = useParams();
  const title = decodeURIComponent(titleEnc);
  const navigate = useNavigate();
  const art = useCatalogBoxart(system, title, true);
  const [owned, setOwned] = useState(false);
  const [gameId, setGameId] = useState<number | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [wikiUrl, setWikiUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Resolve ownership via a tiny catalog search for this exact title.
    listCatalogTitles(system, title, 0, 20)
      .then((page) => {
        if (cancelled) return;
        const hit =
          page.items.find((i) => i.title === title) ??
          page.items.find((i) => i.title.toLowerCase() === title.toLowerCase());
        if (hit) {
          setOwned(hit.owned);
          setGameId(hit.gameId);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    fetchCatalogTitleMeta(title)
      .then((m) => {
        if (cancelled) return;
        setDescription(m.description);
        setWikiUrl(m.wikipediaUrl);
      })
      .catch((err: unknown) => swallow(err, "CatalogTitleDetail.wiki"));

    return () => {
      cancelled = true;
    };
  }, [system, title]);

  const findDownloads = () => {
    navigate("/search", { state: { query: title, consoleKey: system } });
  };

  return (
    <div className="rgp-detail" style={{ maxWidth: 720, margin: "0 auto", padding: 20 }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          background: "none",
          border: "none",
          color: "var(--aura-on-surface-muted)",
          cursor: "pointer",
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        ← Back
      </button>

      {loading && <LoadingState>Loading…</LoadingState>}
      {error && <ErrorNotice>{error}</ErrorNotice>}

      <AuraCard class="rgp-detail__card">
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div
            style={{
              width: 160,
              height: 220,
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--aura-surface-raised)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {art ? (
              <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span className="rgp-muted">{system}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>{title}</h1>
            <p className="rgp-muted" style={{ margin: "0 0 16px" }}>
              {system}
              {owned ? " · In library" : " · Not in library"}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {owned && gameId != null ? (
                <AuraButton variant="primary" onClick={() => navigate(`/game/${gameId}`)}>
                  ▶ Play
                </AuraButton>
              ) : (
                <AuraButton variant="primary" onClick={findDownloads}>
                  Find downloads
                </AuraButton>
              )}
              {!owned && (
                <AuraButton variant="ghost" onClick={findDownloads}>
                  Search for this game
                </AuraButton>
              )}
            </div>
          </div>
        </div>
        {description && (
          <div style={{ marginTop: 20 }}>
            <p style={{ margin: 0, lineHeight: 1.5, fontSize: 14 }}>{description}</p>
            {wikiUrl && (
              <button
                type="button"
                className="rgp-detail__wiki"
                style={{
                  marginTop: 8,
                  background: "none",
                  border: "none",
                  color: "var(--aura-primary)",
                  cursor: "pointer",
                  fontSize: 13,
                }}
                onClick={() => void openUrl(wikiUrl).catch((e) => swallow(e, "wiki"))}
              >
                Wikipedia ↗
              </button>
            )}
          </div>
        )}
      </AuraCard>
    </div>
  );
}
