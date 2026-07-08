import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { now } from "./db.js";

/**
 * Device links + rotating refresh tokens — the Node port of `links.py`. Same model (Phase 5):
 *
 *   * A **link** is one paired app/device, created at pairing approval.
 *   * A **refresh token** is opaque, single-use, with a SLIDING 8-hour idle window: each rotate mints a
 *     new access JWT + rotated refresh and pushes the idle deadline out 8h. Unused for 8h → the link
 *     must re-pair. A transient outage < 8h does not disconnect (the app re-mints on reconnect).
 *   * **Reuse detection:** presenting an already-used refresh token revokes the whole link.
 */
export const REFRESH_IDLE_TTL = 8 * 3600;

export function ensureSchema(d: Database.Database): void {
  d.exec(
    `CREATE TABLE IF NOT EXISTS links (
       link_id TEXT PRIMARY KEY, label TEXT, client_id TEXT, created INTEGER, last_used INTEGER, status TEXT)`,
  );
  d.exec(
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
       token TEXT PRIMARY KEY, link_id TEXT NOT NULL, created INTEGER, expires INTEGER,
       used INTEGER NOT NULL DEFAULT 0)`,
  );
  // The mutual-TLS client cert minted for a link (handed to the app at pairing over the pinned channel).
  d.exec(
    `CREATE TABLE IF NOT EXISTS client_certs (link_id TEXT PRIMARY KEY, cert TEXT, key TEXT)`,
  );
}

export function saveClientCert(d: Database.Database, linkId: string, cert: string, key: string): void {
  d.prepare("INSERT OR REPLACE INTO client_certs(link_id,cert,key) VALUES(?,?,?)").run(linkId, cert, key);
}

export function getClientCert(d: Database.Database, linkId: string): { cert: string; key: string } | null {
  const row = d.prepare("SELECT cert,key FROM client_certs WHERE link_id=?").get(linkId) as
    | { cert: string; key: string } | undefined;
  return row ?? null;
}

function mintRefresh(d: Database.Database, linkId: string, t: number): string {
  const token = randomBytes(32).toString("base64url");
  d.prepare("INSERT INTO refresh_tokens(token,link_id,created,expires,used) VALUES(?,?,?,?,0)")
    .run(token, linkId, t, t + REFRESH_IDLE_TTL);
  return token;
}

/** Create a link (bound to [clientId]) + its first refresh token. Returns [linkId, refreshToken]. */
export function issueLink(d: Database.Database, label: string, clientId: string | null): [string, string] {
  const t = now();
  const linkId = randomBytes(12).toString("base64url");
  d.prepare("INSERT INTO links(link_id,label,client_id,created,last_used,status) VALUES(?,?,?,?,?,'active')")
    .run(linkId, label, clientId, t, t);
  return [linkId, mintRefresh(d, linkId, t)];
}

/** The client id (device+strap) bound to this link at pairing, or null. */
export function linkClientId(d: Database.Database, linkId: string): string | null {
  const row = d.prepare("SELECT client_id FROM links WHERE link_id=?").get(linkId) as
    | { client_id: string | null } | undefined;
  return row?.client_id ?? null;
}

/** Consume [refreshToken], issue a fresh one, slide the 8h window. Returns [linkId, newRefresh] or
 *  null if invalid/expired. On REUSE of a spent token, revoke the link. */
export function rotate(d: Database.Database, refreshToken: string): [string, string] | null {
  const t = now();
  const row = d.prepare("SELECT link_id,expires,used FROM refresh_tokens WHERE token=?").get(
    refreshToken,
  ) as { link_id: string; expires: number; used: number } | undefined;
  if (!row) return null;

  if (row.used) {
    // Replay of an already-rotated token → treat as compromise, revoke the whole link.
    d.prepare("UPDATE links SET status='revoked' WHERE link_id=?").run(row.link_id);
    d.prepare("DELETE FROM refresh_tokens WHERE link_id=?").run(row.link_id);
    return null;
  }
  if (t > row.expires) return null;
  const link = d.prepare("SELECT status FROM links WHERE link_id=?").get(row.link_id) as
    | { status: string }
    | undefined;
  if (!link || link.status !== "active") return null;

  d.prepare("UPDATE refresh_tokens SET used=1 WHERE token=?").run(refreshToken);
  const newRefresh = mintRefresh(d, row.link_id, t);
  d.prepare("UPDATE links SET last_used=? WHERE link_id=?").run(t, row.link_id);
  return [row.link_id, newRefresh];
}

export function linkActive(d: Database.Database, linkId: string | null | undefined): boolean {
  if (!linkId) return false;
  const row = d.prepare("SELECT status FROM links WHERE link_id=?").get(linkId) as
    | { status: string }
    | undefined;
  return !!row && row.status === "active";
}

export function linkIdForRefresh(d: Database.Database, refreshToken: string): string | null {
  const row = d.prepare("SELECT link_id FROM refresh_tokens WHERE token=?").get(refreshToken) as
    | { link_id: string }
    | undefined;
  return row?.link_id ?? null;
}
