import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { now } from "./db.js";
import { makeUserCode } from "./config.js";

/**
 * The device-pairing store (RFC 8628 device-authorization flow): a short rotating user_code the owner
 * approves out-of-band with the admin PIN. Separated from the routes so the SQL lives in one place.
 */
export interface Pairing {
  device_code: string;
  status: string;
  expires: number;
  token: string | null;
}

export function ensureSchema(d: Database.Database): void {
  d.exec(
    `CREATE TABLE IF NOT EXISTS pairings (device_code TEXT PRIMARY KEY, user_code TEXT UNIQUE,
       client_id TEXT, status TEXT, created INTEGER, expires INTEGER, token TEXT)`,
  );
}

/** Start a pairing bound to [clientId]: allocate a device_code + fresh rotating user_code (retry on
 *  collision). */
export function start(d: Database.Database, ttl: number, clientId: string | null): { deviceCode: string; userCode: string } | null {
  const t = now();
  const deviceCode = randomBytes(24).toString("base64url");
  const ins = d.prepare(
    "INSERT INTO pairings(device_code,user_code,client_id,status,created,expires,token) VALUES(?,?,?,?,?,?,NULL)",
  );
  for (let i = 0; i < 5; i++) {
    const uc = makeUserCode();
    try {
      ins.run(deviceCode, uc, clientId, "pending", t, t + ttl);
      return { deviceCode, userCode: uc };
    } catch { /* user_code collision — retry */ }
  }
  return null;
}

export function byUserCode(d: Database.Database, userCode: string): (Pairing & { device_code: string; client_id: string | null }) | undefined {
  return d.prepare("SELECT device_code,client_id,status,expires,token FROM pairings WHERE user_code=?").get(userCode) as
    | (Pairing & { device_code: string; client_id: string | null }) | undefined;
}

export function byDeviceCode(d: Database.Database, deviceCode: string): Pairing | undefined {
  return d.prepare("SELECT status,expires,token FROM pairings WHERE device_code=?").get(deviceCode) as
    | Pairing | undefined;
}

/** Mark a pairing approved and stash the link's initial refresh token against it. */
export function markApproved(d: Database.Database, userCode: string, refreshToken: string): void {
  d.prepare("UPDATE pairings SET status='approved', token=? WHERE user_code=?").run(refreshToken, userCode);
}

/** Pending (not-yet-approved, unexpired) pairing requests, for the dashboard's approve list. */
export function pending(d: Database.Database): Array<{ user_code: string; client_id: string | null; created: number }> {
  return d.prepare(
    "SELECT user_code,client_id,created FROM pairings WHERE status='pending' AND expires>? ORDER BY created DESC",
  ).all(now()) as Array<{ user_code: string; client_id: string | null; created: number }>;
}
