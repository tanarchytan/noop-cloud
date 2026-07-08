import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Minimal HS256 JWT — the Node port of `jwtmini.py`, using the built-in `node:crypto` HMAC (no `jose`
 * dependency). Access tokens are stateless: verify = recompute the HMAC + check `exp`, no DB hit on
 * the hot path. The signing secret is generated once and persisted so tokens survive restarts.
 */
export const ACCESS_TTL = 300; // 5 minutes

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function getSecret(d: Database.Database): Buffer {
  d.exec("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)");
  const row = d.prepare("SELECT v FROM settings WHERE k='jwt_secret'").get() as { v: string } | undefined;
  if (row?.v) return Buffer.from(row.v, "hex");
  const sec = randomBytes(32);
  d.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES('jwt_secret',?)").run(sec.toString("hex"));
  return sec;
}

export function makeAccess(secret: Buffer, linkId: string, ttl: number = ACCESS_TTL): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    Buffer.from(JSON.stringify({ sub: linkId, scope: "link", iat, exp: iat + ttl })),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(createHmac("sha256", secret).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

/** Return the link_id if the token is a valid, unexpired HS256 JWT signed by [secret], else null. */
export function verifyAccess(secret: Buffer, tok: string | null | undefined): string | null {
  if (!tok || tok.split(".").length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = tok.split(".");
  const expected = b64url(createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest());
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: { sub?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  } catch {
    return null;
  }
  if (Number(payload.exp ?? 0) < Math.floor(Date.now() / 1000)) return null;
  const sub = payload.sub;
  return typeof sub === "string" && sub ? sub : null;
}
