# Release Planning — v0.20

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.20.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.20` |
| **Previous** | `v0.18` (Focus — relevance), `v0.19` (Reach — dedupe + liveness + more providers) |
| **Theme** | "Atlas" — make adding a provider first-class: a curated searchable catalog ("Browse providers"), guided authoring with inline help + a kind selector, "Detect template from a URL", and a live "Test provider" validator. The discovery surface keeps high-value legitimate sources one click away without hand-crafting templates. |

Origin: the user asked to make the manual add-provider path first-class — easy
instructions, and a way to discover and add providers — and to prioritize indie
media (itch.io / GameJolt). The no-download contract is untouched (the validator
fetches only the public results page, like `run_search`).

### Scope decisions (user-directed)

1. **Add-provider experience** → "Gallery + guided add + validator", with
   **provider discovery** (search a catalog + detect-from-URL), keeping curated
   high-value indie sources in.
2. **Discovery boundary** (agent-held): a curated catalog + detect-from-URL, **not**
   an open-web crawler for download sites (that's a piracy-site finder).
3. **JS-rendered media** (itch.io/GameJolt) → "Phase it": the JS-render fetch
   tier is a distinct, riskier subsystem shipped as the next release (v0.21);
   v0.20 flags those sites honestly via the validator/catalog.

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W200** | validate_provider command | `validate_provider(url_template, sample_query?)` substitutes a sample query, fetches via the shared `fetch_body`, and returns `{searchUrl, linkCount, sampleTitles≤5, likelyJsRendered, error}`. Pure `looks_client_rendered` heuristic (low anchors + SPA marker, conservative) + `count_anchors`, unit-tested. |
| **W201** | Provider catalog (Rust) | Embedded `core/search/catalog.rs` of vetted LEGAL providers (name, template, kind, media tag, description, js_rendered) + `list_provider_catalog` flagging each `added`. No piracy sites. Tests assert https `{query}`, known kinds, unique names. |
| **W202** | IPC + detectTemplate | `ipc/search.ts` `validateProvider`/`listProviderCatalog` + DTOs; `kind` on add/update (+ `repo.set_kind`). Pure `detectTemplate(url, sample)` deriving a `{query}` template from a pasted URL (raw/`%20`/`+` encodings). vitest. |
| **W203** | Guided ProviderDialog | Inline requirements help, a reference/download **Type** selector, a **Detect from URL** helper, and a **Test provider** button surfacing the validator result. Advanced per-vendor flags moved under a disclosure. |
| **W204** | Provider catalog gallery | `ProviderCatalog` searchable/media-filterable sheet; one-click add with "✓ Added" state + JS-render badges; reached from a **Browse providers** button (and the empty state). |
| **W205** | Docs + release | `provider-discovery-design.md`; roadmap v0.20; this plan; version bump 0.20.0; gates; merge/release/tag/push; memory. |

---

## 3. Strategy

Single integration master, Noir, in-session sequential — the items share the
search/provider surface (catalog → validator → IPC → dialog/gallery). Order:
backend (catalog + validator + kind) → pure TS (detectTemplate) + IPC → dialog +
gallery wiring → docs. Gates after each layer.

---

## 4. Out of scope / deferred

- **JS-render fetch tier** (v0.21) — offscreen WebView render-then-scrape to
  unlock itch.io/GameJolt/GOG generically.
- **Open-web provider discovery** — not built (piracy-site finder; see design §2).
- **Per-provider API adapters** — "APIs later", behind the JS-render tier.

---

## 5. Implementation ledger

| ID | Status | Branch | Notes |
|---|---|---|---|
| W200 | ☑ merged | feat/v0.20-atlas | `validate_provider` + `fetch_diagnostics`/`looks_client_rendered`; 3 tests. |
| W201 | ☑ merged | feat/v0.20-atlas | `catalog.rs` (15 entries) + `list_provider_catalog`; 4 tests. |
| W202 | ☑ merged | feat/v0.20-atlas | IPC + `detectTemplate.ts` (11 tests) + `kind` plumbing + `set_kind` test. |
| W203 | ☑ merged | feat/v0.20-atlas | Rewritten `ProviderDialog`; verified headless. |
| W204 | ☑ merged | feat/v0.20-atlas | `ProviderCatalog` gallery; verified headless. |
| W205 | ☑ merged | feat/v0.20-atlas | Design doc, roadmap, plan, version bump. |
| Release | ☑ shipped | dev→main, tag v0.20 | All gates green; pushed. |
