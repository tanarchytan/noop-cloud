# Self-Hosted "Reverse-Engineered WHOOP Cloud" — build plan

> **Historical planning doc** (early Supabase-based plan). The cloud was built on Fastify/Node + SQLite
> instead; current status + backlog live in `README.md` and `docs/IDEAS.md`. Kept for context.

**Date:** 2026-07-07. Pairs with the **noop fork** (`frankenwhoop-noop`), which stays
**pure-local** (phone = BLE gateway, decodes + computes on-device). This cloud is a **separate
self-hosted service**: a sync sink + backup + web dashboard + Claude coach. It does **not**
unlock features — noop already computes the WHOOP "cloud" scores locally (see the map below).

Extends the existing design: [`architecture.md`](architecture.md) + [`supabase-schema.sql`](supabase-schema.sql)
+ [`../mockup/dashboard.html`](../mockup/dashboard.html).

## What is / isn't achievable (honest matrix)

The MG-vs-5.0 differences reduce to: ECG (hardware electrode) + a set of **software/cloud scores**.
noop's analytics engines already reproduce the software ones on a 5.0, on-phone:

| WHOOP feature | Source | noop engine (already local) | Cloud adds |
|---|---|---|---|
| Recovery / Readiness | software | `RecoveryScorer` / `ReadinessEngine` / `RecoveryForecast` | durability, web view |
| Strain / day strain | software | `AnalyticsEngine` / `HrZones` / `ActivityCostEngine` | — |
| Sleep + staging + debt | software | `SleepStagerV2` / `SleepDebt` / `NapDetector` | re-decode when model improves |
| HRV / RHR / SpO₂ / resp / temp | software | `HrvAnalyzer` + decode | trend history |
| **WHOOP Age / Healthspan** | software | `FitnessAgeEngine` | 6-month trend, web |
| **Stress Monitor** | software | `DaytimeStress` / `DoseResponseEngine` | — |
| **Hormonal Insights** | software | `CyclePhaseEngine` | longer baseline |
| Illness / health monitor | software | `IllnessSignalEngine` | — |
| Behaviors / journal insights | software | `IntelligenceEngine` / `EffectRanker` | coach RAG |
| Rhythm screening (PPG) | software | `RhythmScreener` | — |
| **AI Coach + memory** | cloud | — | **THIS is a real cloud add** (Claude + memory) |
| Multi-device / sharing / backup | cloud | — | **real cloud add** |
| **ECG / AFib (Heart Screener)** | **hardware** | ✗ needs electrode | ✗ **WALL** — no signal on a 5.0 |
| **Blood Pressure** | **hardware+regulated** | ✗ | ✗ **WALL** — no source data, regulated model |

**Takeaway:** the cloud's value is durability + multi-device + coach + web — NOT feature unlock.
ECG and BP are hard walls no server can cross on a 5.0.

## Architecture (adapted: noop computes, cloud stores)

Because the phone already computes every score, the cloud drops the "Rust→WASM recompute" layer
from the original design. It becomes a thin, offline-first sink:

```
band ──BLE──▶ noop (fork)  ── decode + compute locally (Room/SQLite) ──▶ UI  [UNCHANGED, still works offline]
                    │  on wifi, best-effort sync (idempotent upsert):
                    ├─ POST raw frames      ──▶ raw_frames + Storage   (for future re-decode)
                    ├─ POST computed metrics ──▶ metric_daily / sleep_session / healthspan / hormonal_insight
                    └─ POST live HR (opt)    ──▶ samples_hr → Realtime channel hr:{user}
self-hosted Supabase (Docker):
   Postgres + RLS (per-user)  ·  Auth (JWT)  ·  Realtime (live HR)  ·  Storage (raw blobs)
   Edge Fn: ingest (validate+upsert)  ·  Edge Fn: coach (RAG → Claude)  ·  pg_cron (nightly rollups)
web dashboard (mockup/dashboard.html → real) reads via RLS; Claude coach over metric history.
```

Key principles kept: **offline-first** (phone owns truth), **RLS per user**, **own-device data only,
no WHOOP servers**, **raw frames retained** so improved noop algorithms can backfill history.

## Deviations from the original Supabase doc
- **No server-side recompute core.** noop is the single compute engine; the cloud stores its output.
  (Optional later: if multi-device bit-identical scores are wanted, port noop's Kotlin engines to a
  JVM Edge worker — deferred, not MVP.)
- **Coach memory → ZeroEntropy** for embed/rerank instead of raw pgvector (David's stack). Keep the
  `coach_memory` table for the transparent, user-readable/deletable text; ZeroEntropy indexes it.
- **Self-hosted, not hosted Supabase** — `supabase/docker` compose on David's VPS; no vendor lock-in,
  data stays home.

## Phased build

**Phase 0 — stand up the sink (½ day).** `supabase/docker` compose on the VPS; apply
`supabase-schema.sql` (already written); create the ingest Edge Function (validate JWT, idempotent
upsert by `(device, ts, kind)`). Deliverable: `curl` a sample metric row in, see it in Postgres under RLS.

**Phase 1 — noop → cloud sync (1–2 days).** New `com.noop.sync` package in the fork (mirrors the
existing `com.noop.firmware` idiom: okhttp, injectable, opt-in): a `CloudSync` that batches
`metric_daily` + `raw_frames` and POSTs on connectivity; a `SyncPrefs` toggle (default OFF — noop
stays local by default). Reuse the fork's `EncryptedSharedPreferences` pattern for the endpoint URL +
token. Deliverable: a real day of noop metrics visible in Postgres.

**Phase 2 — web dashboard (1 day).** Promote `mockup/dashboard.html` to a real page reading Supabase
via RLS + anon-key + user JWT. Live HR via Realtime channel. Deliverable: browser shows your recovery/
strain/sleep/WHOOP-Age from your own band.

**Phase 3 — Claude coach (1–2 days).** `coach` Edge Function: RAG over `metric_daily` + `coach_memory`
(ZeroEntropy retrieve) → Claude API → answer + new memory row. Transparent memory (user can read/delete).
Deliverable: "why is my recovery low this week" answered from your real history.

**Phase 4 — re-decode + durability (optional).** `pg_cron` job + a re-decode worker that replays
`raw_frames` through an updated decoder when noop's algo_version bumps. Deliverable: history recomputes
without re-syncing the band.

## Walls (do not attempt)
- **ECG/AFib**: needs the physical electrode. A 5.0 produces no ECG signal → nothing to send/compute.
- **Blood Pressure**: regulated PPG+calibration model + no source data on a 5.0. Stay wellness-side;
  no medical claims.
- **No WHOOP account / cloud scraping.** Own-device BLE data only. Keeps the independent-RE posture.
