import type Database from "better-sqlite3";
import { now } from "./db.js";

/**
 * Synced metric storage + read models — the Node port of `metrics.py`. The app POSTs a snapshot to
 * /api/sync; the dashboard reads it back via /api/metrics/*. Personal-cloud scope: one owner, so
 * metrics are stored per-day without a user partition. A partial sync must never null a
 * previously-synced column (COALESCE-style upsert).
 */
const DAILY_COLS = [
  "recovery", "sleep_perf", "strain", "resting_hr", "hrv", "spo2", "skin_temp", "respiratory", "steps",
] as const;
type DailyCol = (typeof DAILY_COLS)[number];

export function ensureSchema(d: Database.Database): void {
  d.exec(
    `CREATE TABLE IF NOT EXISTS metric_daily (
       day TEXT PRIMARY KEY,
       recovery INTEGER, sleep_perf INTEGER, strain REAL, resting_hr INTEGER, hrv REAL,
       spo2 REAL, skin_temp REAL, respiratory REAL, steps INTEGER,
       provenance TEXT, synced_at INTEGER)`,
  );
  d.exec("CREATE TABLE IF NOT EXISTS samples_hr (ts INTEGER PRIMARY KEY, bpm INTEGER NOT NULL)");
}

/** Coerce to a finite number or null; never trust the wire to be the right type. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const f = Number(v);
  return Number.isFinite(f) ? f : null;
}

interface DayPayload {
  day?: string;
  provenance?: string;
  [k: string]: unknown;
}

export interface IngestResult {
  days: number;
  hr: number;
  synced_at: number;
}

/** Upsert one sync payload: { days: [{day, recovery, ...}], hr: [{ts, bpm}] }. */
// Defensive caps on one sync's array sizes — the body limit already bounds bytes; these bound rows so
// a single call can't insert an unbounded number of DB records.
const MAX_DAYS = 400; // > a year of daily rollups
const MAX_HR = 5000;

export function ingest(d: Database.Database, payload: { days?: DayPayload[]; hr?: unknown[] }): IngestResult {
  const t = now();
  const days = (Array.isArray(payload.days) ? payload.days : []).slice(0, MAX_DAYS);
  const hr = (Array.isArray(payload.hr) ? payload.hr : []).slice(0, MAX_HR);
  let nDays = 0;

  const upsert = d.prepare(
    `INSERT INTO metric_daily(day,recovery,sleep_perf,strain,resting_hr,hrv,spo2,skin_temp,
       respiratory,steps,provenance,synced_at) VALUES(@day,@recovery,@sleep_perf,@strain,@resting_hr,
       @hrv,@spo2,@skin_temp,@respiratory,@steps,@provenance,@synced_at)
     ON CONFLICT(day) DO UPDATE SET recovery=excluded.recovery,sleep_perf=excluded.sleep_perf,
       strain=excluded.strain,resting_hr=excluded.resting_hr,hrv=excluded.hrv,spo2=excluded.spo2,
       skin_temp=excluded.skin_temp,respiratory=excluded.respiratory,steps=excluded.steps,
       provenance=excluded.provenance,synced_at=excluded.synced_at`,
  );
  const selExisting = d.prepare("SELECT * FROM metric_daily WHERE day=?");

  const tx = d.transaction((rows: DayPayload[]) => {
    for (const row of rows) {
      const day = (row.day ?? "").trim();
      if (!day) continue;
      const existing = selExisting.get(day) as Record<string, unknown> | undefined;
      const vals: Record<string, number | string | null> = {};
      for (const c of DAILY_COLS) {
        let v = num(row[c]);
        // Partial upsert: keep the existing value when the payload omits this metric.
        if (v === null && existing) v = (existing[c] as number | null) ?? null;
        vals[c] = v;
      }
      vals.provenance = row.provenance ?? (existing?.provenance as string | undefined) ?? null;
      vals.day = day;
      vals.synced_at = t;
      upsert.run(vals);
      nDays++;
    }
  });
  tx(days);

  let nHr = 0;
  const insHr = d.prepare("INSERT OR REPLACE INTO samples_hr(ts,bpm) VALUES(?,?)");
  const txHr = d.transaction((rows: unknown[]) => {
    for (const s of rows) {
      const ts = num((s as Record<string, unknown>)?.ts);
      const bpm = num((s as Record<string, unknown>)?.bpm);
      if (ts === null || bpm === null) continue;
      insHr.run(Math.trunc(ts), Math.trunc(bpm));
      nHr++;
    }
  });
  txHr(hr);

  return { days: nDays, hr: nHr, synced_at: t };
}

function rowToMetrics(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!row) return {};
  const out: Record<string, unknown> = {};
  for (const c of DAILY_COLS) out[c] = row[c];
  out.day = row.day;
  out.provenance = row.provenance;
  out.synced_at = row.synced_at;
  return out;
}

/** The most recent day we have (the dashboard's Home shows this). */
export function today(d: Database.Database): Record<string, unknown> {
  const row = d.prepare("SELECT * FROM metric_daily ORDER BY day DESC LIMIT 1").get() as
    | Record<string, unknown>
    | undefined;
  return rowToMetrics(row);
}

export function history(d: Database.Database, days = 30): Array<Record<string, unknown>> {
  const n = Math.max(1, Math.min(Math.trunc(days || 30), 365));
  const rows = d.prepare("SELECT * FROM metric_daily ORDER BY day DESC LIMIT ?").all(n) as Array<
    Record<string, unknown>
  >;
  return rows.map(rowToMetrics).reverse(); // oldest→newest for charts
}

export function recentHr(d: Database.Database, limit = 120): Array<{ ts: number; bpm: number }> {
  const n = Math.max(1, Math.min(Math.trunc(limit), 2000));
  const rows = d.prepare("SELECT ts,bpm FROM samples_hr ORDER BY ts DESC LIMIT ?").all(n) as Array<{
    ts: number;
    bpm: number;
  }>;
  return rows.reverse();
}

export type { DailyCol };
