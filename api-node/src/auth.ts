import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { now } from "./db.js";

/**
 * User accounts, password auth, and web sessions — the Node port of `auth.py`. Same security model:
 *
 *   * First run seeds ONE admin account: **admin / admin**, flagged `must_change`.
 *   * While the admin still holds the default password ([isUnconfigured]), the request layer refuses
 *     any non-loopback client (see the setup gate in server.ts) — "localhost only until a password is
 *     set". First login therefore forces a password change before anything works off-box.
 *   * Sessions are opaque random tokens stored server-side with a TTL, in an httpOnly cookie.
 *   * FORGOT_PASSWORD=1 (+ optional ADMIN_RESET_PASSWORD) resets the admin password on boot and
 *     re-arms the lock.
 *
 * Password hash format (self-describing): `scrypt$N$r$p$salthex$hashhex` — identical to the Python
 * build, so an existing DB migrated from the Python service verifies unchanged.
 */
const N = 16384, R = 8, P = 1, DKLEN = 32;
export const SESSION_TTL = Number(process.env.SESSION_TTL_SECONDS ?? String(30 * 24 * 3600));
const DEFAULT_ADMIN_PW = "admin";

export interface User {
  id: number;
  username: string;
  is_admin: boolean;
  must_change: boolean;
}

// ── schema ──────────────────────────────────────────────────────────────────────────────────────
export function ensureSchema(d: Database.Database): void {
  d.exec(
    `CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       username TEXT UNIQUE NOT NULL,
       pw_hash TEXT NOT NULL,
       is_admin INTEGER NOT NULL DEFAULT 0,
       must_change INTEGER NOT NULL DEFAULT 0,
       created INTEGER NOT NULL)`,
  );
  d.exec(
    `CREATE TABLE IF NOT EXISTS sessions (
       token TEXT PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       created INTEGER NOT NULL,
       expires INTEGER NOT NULL)`,
  );
}

// ── password hashing ────────────────────────────────────────────────────────────────────────────
export function hashPassword(pw: string): string {
  if (!pw) throw new Error("empty password");
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, DKLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${dk.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const dk = scryptSync(pw, Buffer.from(saltHex, "hex"), hashHex.length / 2, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    const a = Buffer.from(dk.toString("hex"));
    const b = Buffer.from(hashHex);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── seeding / env reset ─────────────────────────────────────────────────────────────────────────
export function seedAdmin(d: Database.Database): void {
  if (d.prepare("SELECT 1 FROM users LIMIT 1").get()) return;
  d.prepare(
    "INSERT INTO users(username,pw_hash,is_admin,must_change,created) VALUES(?,?,1,1,?)",
  ).run("admin", hashPassword(DEFAULT_ADMIN_PW), now());
}

/** If FORGOT_PASSWORD is set, reset the admin password from env and re-arm must_change. Returns true
 *  if a reset happened. The reset re-locks the cloud to localhost until a fresh password is set. */
export function maybeEnvReset(d: Database.Database): boolean {
  const flag = (process.env.FORGOT_PASSWORD ?? "").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(flag)) return false;
  const newPw = (process.env.ADMIN_RESET_PASSWORD ?? "").trim() || DEFAULT_ADMIN_PW;
  const row = d.prepare("SELECT id FROM users WHERE username='admin'").get();
  if (row) {
    d.prepare("UPDATE users SET pw_hash=?, must_change=1, is_admin=1 WHERE username='admin'")
      .run(hashPassword(newPw));
  } else {
    d.prepare("INSERT INTO users(username,pw_hash,is_admin,must_change,created) VALUES(?,?,1,1,?)")
      .run("admin", hashPassword(newPw), now());
  }
  d.exec("DELETE FROM sessions"); // invalidate every session on a reset
  return true;
}

// ── unconfigured / localhost gate ─────────────────────────────────────────────────────────────
export function isUnconfigured(d: Database.Database): boolean {
  const row = d.prepare("SELECT must_change FROM users WHERE username='admin'").get() as
    | { must_change: number }
    | undefined;
  return !!row && !!row.must_change;
}

// ── user management ─────────────────────────────────────────────────────────────────────────────
export function createUser(
  d: Database.Database, username: string, password: string, isAdmin = false, mustChange = false,
): void {
  const name = (username ?? "").trim();
  if (!name) throw new ValueError("username required");
  if ((password ?? "").length < 4) throw new ValueError("password must be at least 4 characters");
  d.prepare("INSERT INTO users(username,pw_hash,is_admin,must_change,created) VALUES(?,?,?,?,?)")
    .run(name, hashPassword(password), isAdmin ? 1 : 0, mustChange ? 1 : 0, now());
}

export function setPassword(d: Database.Database, username: string, newPw: string): void {
  if ((newPw ?? "").length < 4) throw new ValueError("password must be at least 4 characters");
  d.prepare("UPDATE users SET pw_hash=?, must_change=0 WHERE username=?").run(hashPassword(newPw), username);
}

export function deleteUser(d: Database.Database, username: string): void {
  if (username === "admin") throw new ValueError("cannot delete the admin account");
  d.prepare("DELETE FROM users WHERE username=?").run(username);
}

export function listUsers(d: Database.Database): Array<Record<string, unknown>> {
  return d.prepare("SELECT username,is_admin,must_change,created FROM users ORDER BY id").all() as Array<
    Record<string, unknown>
  >;
}

export function authenticate(d: Database.Database, username: string, password: string): User | null {
  const row = d.prepare(
    "SELECT id,username,pw_hash,is_admin,must_change FROM users WHERE username=?",
  ).get(username) as
    | { id: number; username: string; pw_hash: string; is_admin: number; must_change: number }
    | undefined;
  if (!row || !verifyPassword(password, row.pw_hash)) return null;
  return { id: row.id, username: row.username, is_admin: !!row.is_admin, must_change: !!row.must_change };
}

// ── sessions ──────────────────────────────────────────────────────────────────────────────────
export function createSession(d: Database.Database, userId: number): string {
  const token = randomBytes(32).toString("base64url");
  const t = now();
  d.prepare("INSERT INTO sessions(token,user_id,created,expires) VALUES(?,?,?,?)")
    .run(token, userId, t, t + SESSION_TTL);
  return token;
}

export function sessionUser(d: Database.Database, token: string | null | undefined): User | null {
  if (!token) return null;
  const row = d.prepare(
    `SELECT u.id,u.username,u.is_admin,u.must_change,s.expires
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`,
  ).get(token) as
    | { id: number; username: string; is_admin: number; must_change: number; expires: number }
    | undefined;
  if (!row) return null;
  if (now() > row.expires) {
    d.prepare("DELETE FROM sessions WHERE token=?").run(token);
    return null;
  }
  return { id: row.id, username: row.username, is_admin: !!row.is_admin, must_change: !!row.must_change };
}

export function deleteSession(d: Database.Database, token: string | null | undefined): void {
  if (token) d.prepare("DELETE FROM sessions WHERE token=?").run(token);
}

/** Thrown for caller-fixable validation problems (maps to HTTP 400 in the routes). */
export class ValueError extends Error {}
