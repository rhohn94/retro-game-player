/**
 * ProviderDialog — add or edit a search provider (v0.20 "Atlas": first-class).
 *
 * Renders inside an `<aura-dialog>` sheet. The caller controls open/close state
 * and passes `onSave`/`onClose`. Beyond name + URL template, the dialog now
 * guides authoring: inline requirement help, a kind (reference/download)
 * selector, a "Detect from URL" helper that derives the `{query}` template from
 * a pasted results URL, and a live "Test provider" validator that fetches a
 * sample query and reports how many links it found (warning when the site is
 * JavaScript-rendered). Controller-navigable. Design: provider-discovery-design.md.
 */
import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { AuraDialog, AuraButton, AuraField } from "@aura/react";
import { dialogPop } from "../../lib/motion";
import { validateProvider } from "../../ipc/search";
import type { SearchProvider, ProviderValidation } from "../../ipc/search";
import { isAppError } from "../../ipc/commands";
import { detectTemplate } from "./detectTemplate";

export interface ProviderFormData {
  name: string;
  urlTemplate: string;
  /** `"reference"` (metadata/info) or `"download"` (links to obtainable content). */
  kind: string;
  /**
   * Per-vendor opt-in for the future OPTIONAL direct-download feature (v0.16
   * scaffolding). Persisted, but no direct-download action exists yet.
   */
  directDownload: boolean;
  /**
   * Per-vendor opt-in (v0.18): append the structured search filters (console,
   * region) to this provider's query before substitution.
   */
  composeFilters: boolean;
}

interface ProviderDialogProps {
  /** When set, the dialog is open and pre-fills fields from the provider. */
  open: boolean;
  /** If editing, the existing provider; undefined when adding. */
  provider?: SearchProvider;
  /** Optional initial form values (e.g. prefilled from the catalog). */
  initial?: Partial<ProviderFormData>;
  onSave: (data: ProviderFormData) => void;
  onClose: () => void;
}

/** Validation: URL template must be non-empty and contain `{query}`. */
function validate(data: ProviderFormData): string | null {
  if (!data.name.trim()) return "Name is required.";
  if (!data.urlTemplate.trim()) return "URL template is required.";
  if (!data.urlTemplate.includes("{query}"))
    return 'URL template must contain the {query} placeholder.';
  return null;
}

const labelStyle = { fontSize: 12, color: "var(--aura-on-surface-muted)" } as const;

export function ProviderDialog({
  open,
  provider,
  initial,
  onSave,
  onClose,
}: ProviderDialogProps) {
  const [name, setName] = useState("");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [kind, setKind] = useState("reference");
  const [directDownload, setDirectDownload] = useState(false);
  const [composeFilters, setComposeFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Detect-from-URL helper state.
  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteTerm, setPasteTerm] = useState("");
  const [detectNote, setDetectNote] = useState<string | null>(null);
  // Test-provider validator state.
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderValidation | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset all fields when the dialog opens or the target provider changes.
  useEffect(() => {
    if (open) {
      setName(provider?.name ?? initial?.name ?? "");
      setUrlTemplate(provider?.urlTemplate ?? initial?.urlTemplate ?? "");
      setKind(provider?.kind ?? initial?.kind ?? "reference");
      setDirectDownload(provider?.directDownload ?? initial?.directDownload ?? false);
      setComposeFilters(provider?.composeFilters ?? initial?.composeFilters ?? false);
      setError(null);
      setPasteUrl("");
      setPasteTerm("");
      setDetectNote(null);
      setTesting(false);
      setTestResult(null);
    }
  }, [open, provider, initial]);

  // Auto-focus the name field on open.
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => nameRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  function handleSave() {
    const data: ProviderFormData = {
      name: name.trim(),
      urlTemplate: urlTemplate.trim(),
      kind,
      directDownload,
      composeFilters,
    };
    const err = validate(data);
    if (err) {
      setError(err);
      return;
    }
    onSave(data);
  }

  function handleDetect() {
    const r = detectTemplate(pasteUrl, pasteTerm);
    setDetectNote(r.reason);
    if (r.ok && r.template) {
      setUrlTemplate(r.template);
      setTestResult(null);
    }
  }

  async function handleTest() {
    const tmpl = urlTemplate.trim();
    if (!tmpl.includes("{query}")) {
      setError('URL template must contain the {query} placeholder.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await validateProvider({ urlTemplate: tmpl });
      setTestResult(result);
    } catch (err) {
      setError(isAppError(err) ? err.detail : String(err));
    } finally {
      setTesting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Enter saves only from the core fields, not the helper inputs.
    if (e.key === "Escape") onClose();
  }

  if (!open) return null;

  const title = provider ? "Edit Provider" : "Add Provider";
  const templateValid = urlTemplate.trim().includes("{query}");

  return (
    <AuraDialog
      class="harmony-provider-dialog"
      open
      style={{ "--aura-dialog-width": "460px" } as React.CSSProperties}
    >
      <motion.div
        onKeyDown={handleKeyDown}
        initial={dialogPop.initial}
        animate={dialogPop.animate}
        style={{ display: "flex", flexDirection: "column", gap: 14, padding: 4 }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>

        {/* What's a provider — inline requirements help. */}
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--aura-on-surface-muted)",
            background: "var(--aura-surface-raised)",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          A provider is any site with a public search page. Give its URL with the
          search term replaced by{" "}
          <code
            style={{
              fontFamily: "monospace",
              background: "var(--aura-surface)",
              padding: "0 4px",
              borderRadius: 4,
            }}
          >
            {"{query}"}
          </code>
          . Harmony builds the link and previews the results — it never downloads
          anything. Not sure of the format? Paste a real results URL below and let
          it detect the template.
        </div>

        {/* Name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>Name</label>
          <AuraField>
            <input
              ref={nameRef}
              name="provider-name"
              className="harmony-input"
              type="text"
              value={name}
              placeholder="e.g. My ROM Site"
              onChange={(e) => setName(e.target.value)}
            />
          </AuraField>
        </div>

        {/* URL template */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>
            URL Template <span style={{ opacity: 0.6 }}>(must contain &#123;query&#125;)</span>
          </label>
          <AuraField>
            <input
              name="provider-url"
              className="harmony-input"
              type="text"
              value={urlTemplate}
              placeholder="https://example.com/search?q={query}"
              onChange={(e) => {
                setUrlTemplate(e.target.value);
                setTestResult(null);
              }}
            />
          </AuraField>
        </div>

        {/* Detect from URL helper */}
        <details style={{ fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
          <summary style={{ cursor: "pointer" }}>Detect template from a URL</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            <AuraField>
              <input
                name="provider-detect-url"
                className="harmony-input"
                type="text"
                value={pasteUrl}
                placeholder="Paste a results URL, e.g. https://site.com/search?q=mario"
                onChange={(e) => setPasteUrl(e.target.value)}
              />
            </AuraField>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <AuraField style={{ flex: 1 }}>
                <input
                  name="provider-detect-term"
                  className="harmony-input"
                  type="text"
                  value={pasteTerm}
                  placeholder="The term you searched (e.g. mario)"
                  onChange={(e) => setPasteTerm(e.target.value)}
                />
              </AuraField>
              <AuraButton variant="ghost" onClick={handleDetect}>
                Detect
              </AuraButton>
            </div>
            {detectNote && (
              <span style={{ fontSize: 11, color: "var(--aura-on-surface-muted)" }}>
                {detectNote}
              </span>
            )}
          </div>
        </details>

        {/* Kind selector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>Type</label>
          <select
            name="provider-kind"
            className="harmony-input"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            style={{ fontSize: 13, padding: "6px 8px" }}
          >
            <option value="reference">Reference (info / metadata)</option>
            <option value="download">Download source (⬇ links to games)</option>
          </select>
        </div>

        {/* Test provider */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AuraButton
              variant="ghost"
              onClick={handleTest}
              disabled={!templateValid || testing}
            >
              {testing ? "Testing…" : "Test provider"}
            </AuraButton>
            <span style={{ fontSize: 11, color: "var(--aura-on-surface-muted)" }}>
              Runs a sample search to check it returns links.
            </span>
          </div>
          {testResult && (
            <div
              style={{
                fontSize: 12,
                borderRadius: 8,
                padding: "8px 10px",
                background: "var(--aura-surface-raised)",
                color: "var(--aura-on-surface)",
              }}
            >
              {testResult.error ? (
                <span style={{ color: "var(--aura-error)" }}>
                  Couldn't reach it: {testResult.error}
                </span>
              ) : testResult.linkCount > 0 ? (
                <>
                  <span style={{ color: "var(--aura-success)", fontWeight: 600 }}>
                    ✓ Found {testResult.linkCount} link
                    {testResult.linkCount === 1 ? "" : "s"}.
                  </span>{" "}
                  {testResult.sampleTitles.length > 0 && (
                    <span style={{ color: "var(--aura-on-surface-muted)" }}>
                      e.g. {testResult.sampleTitles.slice(0, 3).join(" · ")}
                    </span>
                  )}
                </>
              ) : testResult.likelyJsRendered ? (
                <span style={{ color: "var(--aura-on-surface-muted)" }}>
                  This site looks JavaScript-rendered, so a preview finds no links
                  yet. You can still add it — support for these sites is coming.
                </span>
              ) : (
                <span style={{ color: "var(--aura-on-surface-muted)" }}>
                  No links found for the sample query. The template may be off, or
                  the page lists results in a way the preview can't read.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Advanced per-vendor flags */}
        <details style={{ fontSize: 12, color: "var(--aura-on-surface-muted)" }}>
          <summary style={{ cursor: "pointer" }}>Advanced options</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
              <input
                name="provider-compose-filters"
                type="checkbox"
                checked={composeFilters}
                onChange={(e) => setComposeFilters(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                Append search filters (console / region) to this provider's query{" "}
                <span style={{ opacity: 0.7 }}>
                  (narrows at the source — leave off if this site's listings don't
                  name the console)
                </span>
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
              <input
                name="provider-direct-download"
                type="checkbox"
                checked={directDownload}
                onChange={(e) => setDirectDownload(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                Allow direct download from this vendor{" "}
                <span style={{ opacity: 0.7 }}>(experimental — not available yet)</span>
              </span>
            </label>
          </div>
        </details>

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--aura-error)" }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <AuraButton variant="ghost" onClick={onClose}>
            Cancel
          </AuraButton>
          <AuraButton variant="primary" onClick={handleSave}>
            Save
          </AuraButton>
        </div>
      </motion.div>
    </AuraDialog>
  );
}
