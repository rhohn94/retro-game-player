# GitHub Issues Cost-Efficiency Spike

> **Up:** [↑ Grimoire tier](README.md)


> R1 findings for v1.12 "External issue tracking". Hard gate for D1 and Phase 2.
> Method: live `gh` probes against `rhohn94/agentic-scaffolding` (3 probe
> issues created, measured, then closed). Token proxy: `chars ÷ 4` (no
> transcript available for `gh` CLI output; see note). All "LIVE" rows are
> direct measurements; "MODELED" rows extrapolate from live per-issue rates or
> apply the v1.9 cost-class weights from `docs/design/token-efficiency-design.md`.

> **Note on proxy accuracy.** `chars ÷ 4` is a well-established approximation
> for English text (Anthropic's tokenizer averages ~4 chars/token on prose and
> JSON with ASCII keys). The probe bodies were deliberately representative of
> real issue text. Extrapolations use the same per-issue rate derived from the
> 3-issue live sample and are labeled "MODELED".

---

## 1. Measurements table

| Pattern | Scope | Approx tokens | Type | Notes |
|---|---|---|---|---|
| `gh issue list` (human table) | 3 issues | 59 | LIVE | Tab-separated; drops labels column when empty |
| `gh issue list` (human table) | 30 issues | ~590 | MODELED | Linear extrapolation; ~20 tok/issue |
| `gh issue list --json number,title,labels,state --limit 30` | 3 issues | 75 | LIVE | JSON key overhead adds ~27% vs human table |
| `gh issue list --json number,title,labels,state --limit 30` | 30 issues | ~750 | MODELED | ~25 tok/issue; JSON key repetition per item |
| `gh issue list --json number,title,state --jq '.[] \| [.number,.state,.title] \| @tsv'` | 3 issues | 42 | LIVE | TSV via jq; minimal overhead; 29% cheaper than JSON |
| `gh issue list --json … --jq …` (tsv) | 30 issues | ~420 | MODELED | ~14 tok/issue — **cheapest list pattern** |
| `gh issue list --state open --json …` (server-side state filter) | 3 issues (all open) | 66 | LIVE | Same result set; filter runs server-side |
| `gh issue list --search 'is:issue is:open bug' --json …` (server search) | 1 matching issue | 24 | LIVE | Returns 1 of 3; server narrows result set |
| `gh issue view 1` (human, full body) | 1 issue | 93 | LIVE | Metadata header + body; header ~50 tok fixed |
| `gh issue view 1 --json number,title,body,state` | 1 issue | 79 | LIVE | Structured; ~15% cheaper than human view |
| `gh issue list --json number,title,body,state --limit 30` (bulk bodies) | 3 issues | 257 | LIVE | ~86 tok/issue; body dominates |
| `gh issue list … body …` bulk | 30 issues | ~2,550 | MODELED | ~6× costlier than title-only list |

**Key ratios (from live data):**
- Table vs jq-tsv: 59 vs 42 = **29% more tokens** for the human table (less parseable too).
- JSON-fields vs jq-tsv: 75 vs 42 = **44% overhead** for uncompressed JSON on same fields.
- Body-on-demand (1 issue) vs title-only (1 issue share of list): 79 vs 14 = **~5.6× per issue** when body is included.
- Bulk-with-body vs title-only list (30 issues): 2,550 vs 420 = **6.1× more expensive**.

---

## 2. Cache-vs-requery crossover

**Setup:** using the v1.9 cost model (warm cache_read ≈ 0.08× output rate;
cache_creation ≈ 0.42× output rate; cold `gh` output is charged at the output
token rate when injected into agent context).

**Baseline query cost:** 30-issue jq-tsv list ≈ 420 output tokens (cold).

**Snapshot-once-then-cache:**
- One cold read: 420 tokens (output rate).
- Cache creation overhead: `420 × (1.25/3) ≈ 175` tokens (one-time).
- Per warm re-read: `420 × 0.08 ≈ 34` tokens.

**Crossover inequality** (K = number of queries per session):

```
cold_K:     K × 420
cached_K:   420 + 175 + K × 34   (snapshot + cache_creation + K warm reads)

cached_K < cold_K when:
  420 + 175 + 34K < 420K
  595 < 386K
  K > 1.54
```

**Crossover: K = 2.** Any session that reads the issue list **twice or more**
is cheaper with a session snapshot. In practice, release-planning, reporter,
and feedback-to-issue all read the list multiple times in a session — caching
wins almost always. Even single-read sessions benefit if the snapshot also
serves `gh issue view` calls (bodies loaded from cache instead of network).

---

## 3. Multi-repo aggregation cost

For N trackers, each with ~30 issues:

| Strategy | Per-repo cost | N=3 total | N=5 total |
|---|---|---|---|
| No optimization (human table, cold) | ~590 tok | ~1,770 tok | ~2,950 tok |
| Field-filtered + jq-tsv, cold | ~420 tok | ~1,260 tok | ~2,100 tok |
| Field-filtered + jq-tsv, session-cached (warm reads) | ~34 tok | ~102 tok | ~170 tok |
| Cold bulk-with-body (worst case) | ~2,550 tok | ~7,650 tok | ~12,750 tok |

**Mitigations ranked by impact:**
1. **Session snapshot cache** — 12× cheaper than cold re-query on same data (34 vs 420 tok/repo per access after first).
2. **Server-side filtering** — reduce result set before it hits the agent; a focused `--search 'label:bug'` can cut a 30-issue list to 5–8 issues, saving ~73% of the unfiltered cost.
3. **Field filtering + jq** — 29–44% cheaper than human table or raw JSON for the same data.
4. **Body-on-demand** — never include `body` in the list query; fetch bodies only when the agent needs to act on a specific issue (5.6× savings vs bulk-with-body).
5. **Bounded `--limit`** — default gh limit is 30; cap lower (e.g. 20) for routine reads; the cache serves history beyond the window.

---

## 4. Separate-issues-repo permissions constraint

**Finding (GitHub policy, permanent constraint):**
GitHub's permissions model ties Issues visibility to repo visibility. There is
no Issues-only role: the minimum access level that lets an external user read
issues is `Read` on the repo, which also grants read access to the source code.
Consequently:

- **If issue visibility must exceed source-code visibility** (e.g. public bug
  tracker, external user reports) the tracker **must live in a separate repo**
  (or an org-level GitHub Project).
- **Same-repo issues** are acceptable when both tracker and source have the same
  audience (fully internal or fully public).
- **Org Projects** (GitHub Projects v2) allow cross-repo issue aggregation with
  finer-grained access, but introduce a separate API (GraphQL, not `gh issue`).

**Cost implication for the v1.12 design:**

A separate-issues-repo model means every tracker read is a **cross-repo `gh`
call**. With N audience-routed repos (e.g. `internal-issues` + `public-issues`),
the agent must make N separate list calls — the multi-repo aggregation case from
§3 applies directly. This makes the session-snapshot cache and server-side
filtering levers **more important**, not less: without caching, N=2 repos with
no filter costs ~1,260 tokens per session read; with caching it costs ~68 tokens.

**Design constraint for D1:** the interface must support `{provider, repo}`
per tracker entry so the github backend can route list/get/create to the correct
repo. The cache key must include `(provider, repo, filter_hash)` so separate
repos are cached independently.

---

## 5. Recommended access pattern

Rules for D1 and the `github` backend (I1 / I4) to implement:

- **Always field-filtered JSON + jq projection.** Never pass `gh issue list`
  output raw to an agent. Use `--json number,title,labels,state` minimum;
  pipe through `--jq` to emit TSV or compact JSON. This alone saves 29–44%
  vs human table or raw JSON on the same data.

- **Body on demand, never in the list.** Omit `body` from all list queries.
  Fetch the full issue (`gh issue view N --json number,title,body,state`) only
  when the agent is about to act on that issue. Saves ~5.6× per issue accessed.

- **Server-side filtering before the agent sees data.** Always pass the
  narrowest `--state`, `--label`, and `--search` that satisfies the query.
  Returning 5 filtered issues instead of 30 unfiltered saves ~73% even before
  caching. Server filtering is free; client-side filtering wastes output tokens.

- **Session-snapshot cache with lazy refresh.** Snapshot the issue list once
  per session (at first access). Serve all subsequent reads from the in-memory
  snapshot (cache_read rate ≈ 0.08× output rate). Refresh lazily only when a
  write operation (create/close/label) is performed in the same session.
  Crossover is K=2: any session with two or more list accesses wins.

- **Bounded `--limit` (≤30).** Cap list output. The cache covers the session
  window; deep history is rarely needed for routine agent decisions.

- **Write batching.** Coalesce multiple label/state mutations into a single
  `gh issue edit` call. Avoid interleaving writes with reads that would
  invalidate the session snapshot.

- **Roadmap-default zero-network.** When no external tracker is configured,
  the `roadmap` backend reads [roadmap.md](../roadmap.md) from the working tree — no network
  calls, no token cost beyond the file read. This is the correct default.

- **Cache key includes `(provider, repo, filter_hash)`.** Required for
  multi-tracker / separate-issues-repo routing. Each distinct tracker is
  cached independently; a write to tracker A does not invalidate tracker B's
  cache.

- **Multi-repo aggregation: parallelize reads, then merge.** For N trackers,
  issue N simultaneous `gh issue list` calls (or sequence them if rate-limiting
  is a concern), cache each result, and merge in the abstraction layer. Do not
  issue N sequential reads across turns — that churns the prompt cache prefix.
