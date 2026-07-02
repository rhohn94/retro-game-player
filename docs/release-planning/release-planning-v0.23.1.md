# Release Planning — v0.23.1

> status: agreed
> Hotfix release — single-item lane, abbreviated ritual. Captures the scope
> and ledger for v0.23.1. Archive into `version-history.md` when it ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.23.1` |
| **Previous** | v0.23 (Continuity — saves, native-play closeout, attract mode) |
| **Theme** | Hotfix — native-play frame delivery performance. First real gameplay after the v0.23 crash fix exposed the v0.21 base64-over-JSON frame IPC as the bottleneck (heavy stutter, user-reported same day). |

---

## 2. Major Features

### W239 — Raw-bytes frame IPC

Replace `get_native_frame`'s base64-in-JSON payload (~327 KB string per frame
plus a per-byte JS decode loop, next poll serialized behind the previous
round trip) with Tauri 2's raw-binary channel: a `tauri::ipc::Response` whose
body is a 16-byte header (`[seq: u64 LE][width: u32 LE][height: u32 LE]`)
followed by tightly-packed RGBA8888 pixels, viewed zero-copy into
`ImageData`. The runtime stamps frames with a sequence number; the poller
echoes the last painted one and unchanged frames answer with an empty body.
The rAF tick is scheduled up-front with an in-flight guard so a slow round
trip skips a paint instead of halving the frame rate.

- **Acceptance:** all gates green; painted gameplay is smooth at the core's
  native rate on the maintainer's machine (user-verified, same-day loop);
  paused/overlay/idle polls return empty bodies.
- **Branch:** `feat/w239-frame-ipc`
- **Design:** `native-emulation-design.md` §3 (updated).

---

## 3. Parallel Implementation Strategy

Single item, single phase.

---

## 4. Out of Scope for v0.23.1

- NSView/Metal overlay frame delivery — remains the documented escalation if
  canvas paint itself ever bottlenecks (design doc §3 / Follow-ups).
- Everything scheduled for v0.24 "Everywhere".

---

## 5. Status Ledger

| Branch | Design doc | Implemented | Reviewed | Merged into version/0.23.1 |
|---|---|---|---|---|
| `feat/w239-frame-ipc` (W239) | ☑ | ☑ | ☑ | ☑ |

### Follow-ups discovered during implementation

- None yet.
