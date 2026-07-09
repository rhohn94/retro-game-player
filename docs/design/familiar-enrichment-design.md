# Familiar Enrichment — Harmony v0.1 (W12)

> **Up:** [↑ Design docs](README.md) · [↑ Architecture master contract](architecture-design.md)

> **Status:** implementation detail beneath the master contract. The `familiar`
> command surface and the `FamiliarProbe` DTO are owned by
> [architecture-design.md §2.8](architecture-design.md#28-familiar-w12) (D1);
> where this doc and the master contract disagree, the **master contract wins**.
> Implemented by **W12**.

## Motivation

The Familiar is an OPTIONAL, AI-backed companion service that disambiguates fuzzy
ROM titles and ambiguous dumps. It is a **soft dependency**: Harmony must work
fully without it. When the Familiar is absent, unauthorized, rate-limited, or
slow, Harmony degrades **silently** — the AI affordances are simply hidden and
every other feature keeps working. W12 implements the two-stage probe, the
Keychain-backed Bearer key, the enrichment client, and the result cache behind the
`probe_familiar` / `enrich_game` IPC commands. The Settings screen's Familiar
pane (W15, [settings-shell-design.md](settings-shell-design.md)) persists the
connection via a third command, `save_familiar_config`.

## Module map (`src-tauri/src/core/familiar/`)

```
core/
  mod.rs                 # domain root; `pub mod familiar;`
  familiar/
    mod.rs               # constants (paths, headers, status codes, timeout) + submodule wiring
    transport.rs         # HttpTransport trait + ReqwestTransport (timeout) + MockTransport (tests)
    probe.rs             # two-stage ProbeState machine + FamiliarProbe DTO
    keychain.rs          # KeyStore trait + KeychainStore (macOS Keychain) + MemoryKeyStore (tests)
    cache.rs             # EnrichmentCache (in-memory, keyed by game id)
    client.rs            # FamiliarClient — composes transport + keystore + cache
commands/
  familiar.rs            # thin #[tauri::command] adapters: probe_familiar, enrich_game, save_familiar_config
```

The frontend wrapper is `src/ipc/familiar.ts` (`probeFamiliar`, `enrichGame`,
`saveFamiliarConfig`), re-exported from the `src/ipc/commands.ts` barrel.
`save_familiar_config` persists the base URL to the file-backed `AppConfig`
(W4) and, when a non-empty key is supplied, writes it straight to the
Keychain (an empty string explicitly clears the stored key; omitting the
field leaves it untouched) — the same never-serialize-the-key contract as
the rest of this doc, just entered from the Settings form instead of a
config file.

## Configuration

The Familiar base URL is read from `AppConfig.familiar_base_url` (W4,
`config/mod.rs`), defaulting to the W4 constant `DEFAULT_FAMILIAR_BASE_URL`. W12
does NOT redefine the base URL; it consumes the W4 config field. (Note: the W4
default currently differs from the W12 spec value — see Open questions.)

## Two-stage probe state machine

`probe::probe(transport, base_url, key) -> ProbeState`:

1. **Presence** — `GET {base}/healthz`. A `200` means up; anything else
   (unreachable / timeout / non-200) → `Absent`.
2. **Authorization** — `GET {base}/integration/v1/capabilities` with
   `Authorization: Bearer {key}` and `X-Consumer-Id: harmony`. A `200` →
   `Authorized { capabilities }`. A `401` / `429` / other non-200 / timeout →
   `Present` (up but not authorized). No stored key short-circuits to `Present`.

`ProbeState` maps to the wire `FamiliarProbe { present, authorized, base_url,
capabilities }`. **The probe never returns an error** — every soft-failure path
classifies cleanly so the UI keys AI-affordance visibility off `authorized`.

| Condition | Classification | `present` / `authorized` |
|---|---|---|
| host unreachable | Absent | false / false |
| `/healthz` timeout | Absent | false / false |
| `/healthz` non-200 | Absent | false / false |
| healthy, no key | Present | true / false |
| capabilities 401 | Present | true / false |
| capabilities 429 | Present | true / false |
| capabilities timeout | Present | true / false |
| capabilities 200 | Authorized | true / true |

## Bearer key — macOS Keychain

The Bearer key is a secret and is **never** written to disk — not to
`app-config.json`, not to the `settings` table. It lives in the macOS Keychain
(`keyring` crate) under service `com.retro-game-player.app` (post-rename,
W269B — see below), account `familiar-bearer-key`. The key store is
abstracted behind the `KeyStore` trait; production uses `KeychainStore`,
tests use `MemoryKeyStore`. `FamiliarClient` holds **no plaintext key
field** — it fetches from the `KeyStore` on demand — so the key can never leak
into a serialized config/DTO. A missing key is `Ok(None)`, not an error.

**Post-rename Keychain migration (W269B, v0.26):** the Keychain service name
migrated from `com.harmony.app` to `com.retro-game-player.app`. Reads try the
new service name first; on a miss they fall back to the legacy
`com.harmony.app` entry (kept as `LEGACY_KEYCHAIN_SERVICE`) and, on a legacy
hit, forward-write the value under the new service name so subsequent reads
no longer need the fallback. The legacy entry is never deleted (a stale
legacy entry is harmless and preserves downgrade). Writes and deletes always
target the new service name only. Full decision record + rationale:
[app-infrastructure-design.md §Post-rename identifier decisions](app-infrastructure-design.md#post-rename-identifier-decisions-w269b-v026).

## Enrichment + cache

`FamiliarClient::enrich(game_id, clean_name)` returns `Some(Enrichment)` or `None`
(silent degrade). It short-circuits on a cache hit; otherwise it probes, and only
when `authorized` POSTs to `/integration/v1/jobs` (header `X-Consumer-Id: harmony`)
with the disambiguation task. Success is parsed (`clean_name` / `title`), cached
keyed by game id, and returned. Any soft failure → `None`. The `enrich_game`
adapter, on a changed title, persists via `LibraryRepo::set_game_clean_name` and
returns the refreshed game; otherwise it returns the game unchanged.

## Testability

The HTTP call is abstracted behind `HttpTransport` and the key behind `KeyStore`,
so the probe state machine and client are unit-tested with a scripted
`MockTransport` + `MemoryKeyStore` — **no live server**. Tests cover all five
classifications (present / absent / 401 / 429 / timeout), capabilities parsing,
header correctness, cache hit/replace, and that the key never serializes onto the
client/config struct.

## Cross-links

- [architecture-design.md §2.8](architecture-design.md#28-familiar-w12) — command surface + `FamiliarProbe` DTO (D1, authoritative).
- [app-infrastructure-design.md](app-infrastructure-design.md) — `AppConfig` (base URL), Keychain note (W4).

## Post-rename note (W269B, v0.26)

`CONSUMER_ID_VALUE` (`src-tauri/src/core/familiar/mod.rs`, `"harmony"`, sent
via the `X-Consumer-Id` header) stays **"harmony" permanently pending a
coordinated change** — it is not an oversight. It is the wire value the
external Familiar service may allowlist per consumer; renaming it
unilaterally could silently break enrichment for already-configured users.
Any change to this value must be coordinated with the Familiar service side
first, not shipped as a unilateral rename. See
[app-infrastructure-design.md §Post-rename identifier decisions](app-infrastructure-design.md#post-rename-identifier-decisions-w269b-v026)
for the full decision record (including the Keychain service-name migration
above).

## Open questions

None outstanding — the earlier `DEFAULT_FAMILIAR_BASE_URL` mismatch (W4's
config default vs. the W12 acceptance value) was reconciled: `config/mod.rs`
now defines `DEFAULT_FAMILIAR_BASE_URL` as `http://127.0.0.1:2121`, matching
the W12 spec.
