# Reverse-Engineered WHOOP Cloud — Architecture

> **Historical planning doc.** This described an early Supabase/Postgres design. The implemented cloud
> is Fastify/Node + SQLite + a React dashboard — see the top-level `README.md` for the actual
> architecture. Kept for context.

A Supabase-backed cloud for an independent WHOOP 5.0 app. The phone stays the BLE
gateway (only a bonded phone can talk to the band); Supabase is sync + heavy
compute + coach + sharing. Offline-first: the phone owns truth, the cloud mirrors
and recomputes.

## Components

| Layer | Tech | Job |
|---|---|---|
| Gateway | iOS/Android app | BLE bond, frame reassembly + CRC, decode, local SQLite, sync |
| Decode core | Rust → `.a` (device) + **WASM** (Edge) | one math everywhere; `whoop_protocol.json` schema |
| Auth | Supabase Auth | per-user identity, JWT for RLS |
| DB | Postgres + RLS | raw timeseries + computed metrics, row-isolated per user |
| Realtime | Supabase Realtime | live HR fan-out to web / watch / second device |
| Compute | Edge Functions (Deno + WASM core) | recompute recovery / strain / sleep / healthspan |
| Scheduler | `pg_cron` | nightly recompute, WHOOP-Age 6-month refresh |
| Blobs | Supabase Storage | raw packet captures for re-decode when algos improve |
| Coach | Edge Function → Claude API + `pgvector` | transparent, user-readable "memory" |

## Data flow

```
band ──BLE──▶ phone
   decode (shared core) ──▶ local SQLite (offline-first)
   on connectivity:
     POST raw frames        ──▶ ingest Edge Fn ──▶ raw_frames + Storage
     POST decoded samples   ──▶ samples_* tables (idempotent upsert by (device,ts,kind))
   nightly / on-demand:
     recompute Edge Fn      ──▶ metric_daily, healthspan, sleep_session
   live:
     Realtime channel `hr:{user}` ◀── samples_hr insert trigger
   coach:
     ask() Edge Fn ── RAG(metric_daily + coach_memory via pgvector) ──▶ Claude ──▶ answer (+ new memory)
```

## Why re-store raw frames
Algorithms improve. Keeping raw type-47/40/43 payloads in `raw_frames` + Storage
lets the cloud **re-decode history** when the Rust core gains a better SpO₂ or
sleep model — without re-syncing the band. This is the single biggest advantage a
cloud adds over the band's 14-day flash.

## One math everywhere
Compile the Rust decode + metric core to WASM and run it inside Edge Functions.
The phone and the server then produce **bit-identical** recovery/strain/sleep, so
multi-device users never see two different scores. `metric_daily.algo_version`
records which core version produced each row; a version bump triggers a `pg_cron`
backfill recompute from `raw_frames`.

## Security / privacy
- **RLS on every table**: `user_id = auth.uid()`. No cross-user reads.
- Raw blobs in a private Storage bucket, signed URLs only.
- Coach memory is **user-visible and deletable** (mirror WHOOP "My Memory", but transparent).
- No WHOOP account, no WHOOP servers, own-device data only.
- ECG/BP, if ever added, stay flagged non-medical unless cleared.

## Realtime live HR
Insert trigger on `samples_hr` publishes to channel `hr:{user_id}`. Web dashboard,
Apple Watch complication, or a second phone subscribe for sub-second live HR while
the gateway phone is the only BLE-connected device.

## Deploy path
- Supabase project (Postgres 15 + extensions `pgcrypto`, `vector`, `pg_cron`).
- `supabase db push` the schema; deploy Edge Functions (`ingest`, `recompute`, `coach`).
- Mobile app to Google Play / App Store as the gateway; web dashboard on Vercel/CF Pages.
- Secrets: `ANTHROPIC_API_KEY` for the coach Edge Function only (server-side).
