import type Database from "better-sqlite3";
import { now } from "./db.js";
import { log } from "./log.js";

/**
 * Per-IP rate limiting with escalating bans for the abuse-prone endpoints (login, pairing). Backed by
 * SQLite so bans survive a restart. Model: count failures in a sliding window per (ip, bucket); when
 * the count crosses [MAX], ban the IP for [BAN_SECONDS] and reset. A success clears the counter.
 *
 * Buckets keep login and pairing independent, so hammering /pair doesn't lock you out of /login.
 */
export type Bucket = "login" | "pair";

const MAX = Number(process.env.RATE_MAX_ATTEMPTS ?? "5");
const WINDOW = Number(process.env.RATE_WINDOW_SECONDS ?? "300"); // 5 min
const BAN_SECONDS = Number(process.env.BAN_SECONDS ?? "900"); // 15 min

export function ensureSchema(d: Database.Database): void {
  d.exec(
    `CREATE TABLE IF NOT EXISTS ip_attempts (
       ip TEXT, bucket TEXT, count INTEGER NOT NULL DEFAULT 0,
       window_start INTEGER NOT NULL, banned_until INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (ip, bucket))`,
  );
}

export interface Gate { allowed: boolean; retryAfter: number }

/** Check whether [ip] may attempt [bucket] right now. Call BEFORE processing the attempt. */
export function check(d: Database.Database, ip: string, bucket: Bucket): Gate {
  const t = now();
  const row = d.prepare("SELECT banned_until FROM ip_attempts WHERE ip=? AND bucket=?").get(ip, bucket) as
    | { banned_until: number } | undefined;
  if (row && row.banned_until > t) {
    return { allowed: false, retryAfter: row.banned_until - t };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Record a failed attempt; ban the IP once failures cross the threshold in the window. */
export function recordFailure(d: Database.Database, ip: string, bucket: Bucket): void {
  const t = now();
  const row = d.prepare("SELECT count,window_start,banned_until FROM ip_attempts WHERE ip=? AND bucket=?")
    .get(ip, bucket) as { count: number; window_start: number; banned_until: number } | undefined;

  // Fresh window if none, expired, or previously banned window has passed.
  const freshWindow = !row || t - row.window_start > WINDOW;
  const count = (freshWindow ? 0 : row!.count) + 1;
  const windowStart = freshWindow ? t : row!.window_start;

  if (count >= MAX) {
    const bannedUntil = t + BAN_SECONDS;
    d.prepare(
      `INSERT INTO ip_attempts(ip,bucket,count,window_start,banned_until) VALUES(?,?,0,?,?)
       ON CONFLICT(ip,bucket) DO UPDATE SET count=0, window_start=excluded.window_start, banned_until=excluded.banned_until`,
    ).run(ip, bucket, t, bannedUntil);
    log.warn("ratelimit.ban", { ip, bucket, until: bannedUntil, ban_seconds: BAN_SECONDS });
  } else {
    d.prepare(
      `INSERT INTO ip_attempts(ip,bucket,count,window_start,banned_until) VALUES(?,?,?,?,0)
       ON CONFLICT(ip,bucket) DO UPDATE SET count=excluded.count, window_start=excluded.window_start`,
    ).run(ip, bucket, count, windowStart);
    log.debug("ratelimit.fail", { ip, bucket, count, max: MAX });
  }
}

/** Clear the counter for [ip]/[bucket] after a successful attempt. */
export function recordSuccess(d: Database.Database, ip: string, bucket: Bucket): void {
  d.prepare("DELETE FROM ip_attempts WHERE ip=? AND bucket=?").run(ip, bucket);
}
