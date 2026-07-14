import type { FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";

import { db } from "./db.js";
import * as auth from "./auth.js";
import * as links from "./links.js";
import * as jwt from "./jwt.js";
import { CLIENT_ID_HEADER, MTLS_REQUIRED, REQUIRE_CLIENT_ID } from "./config.js";

/**
 * Request-scoped auth helpers, shared by every route module. The JWT signing secret is cached here so
 * access-token verification never re-reads it from the DB on the hot path.
 */
let SECRET: Buffer | null = null;

export function initSecret(d: Database.Database): void {
  SECRET = jwt.getSecret(d);
}
function secret(): Buffer {
  if (!SECRET) SECRET = jwt.getSecret(db());
  return SECRET;
}

/** Path without query or trailing slash (root stays "/"). */
export function pathOf(req: FastifyRequest): string {
  const p = req.url.split("?")[0];
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function clientIsLoopback(req: FastifyRequest): boolean {
  const ip = req.ip ?? "";
  return ip.startsWith("127.") || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/** True when this request reached us over HTTPS — directly (TLS socket) or via a trusted proxy that
 *  set X-Forwarded-Proto. Drives the Secure cookie flag and HSTS so neither breaks plain-http localhost
 *  setup while still hardening the exposed https path. */
export function isRequestSecure(req: FastifyRequest): boolean {
  if ((req.raw.socket as { encrypted?: boolean }).encrypted === true) return true;
  const xfp = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(xfp) ? xfp[0] : xfp)?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

/** Baseline response hardening applied to every reply (see the onRequest hook in server.ts). HSTS is
 *  only asserted on secure responses; a relaxed CSP is skipped for the Swagger UI so /docs still works
 *  for the admin. No user input is reflected into the server-rendered pages, so 'unsafe-inline' here is
 *  a pragmatic allowance for their small inline scripts, not an XSS hole. */
export function setSecurityHeaders(req: FastifyRequest, reply: FastifyReply): void {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Cross-Origin-Opener-Policy", "same-origin");
  if (isRequestSecure(req)) {
    reply.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  if (!pathOf(req).startsWith("/docs")) {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; " +
        "base-uri 'none'; object-src 'none'",
    );
  }
}

export function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** The signed-in web user for this request (from the `sid` cookie), or null. */
export function currentUser(req: FastifyRequest): auth.User | null {
  return auth.sessionUser(db(), req.cookies?.sid);
}

/** A valid, unexpired access JWT whose link is still active — the device-link authorization check. */
export function tokenValid(token: string | null): boolean {
  const linkId = jwt.verifyAccess(secret(), token);
  return !!linkId && links.linkActive(db(), linkId);
}

export function accessLinkId(token: string | null): string | null {
  return jwt.verifyAccess(secret(), token);
}

export function makeAccess(linkId: string): string {
  return jwt.makeAccess(secret(), linkId);
}

/** Guard: 401 if not signed in, 403 if not admin. Returns the user or null (and has already replied). */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): auth.User | null {
  const u = currentUser(req);
  if (!u) { reply.code(401).send({ error: "not signed in" }); return null; }
  if (!u.is_admin) { reply.code(403).send({ error: "admin only" }); return null; }
  return u;
}

/** Authorised either by a paired-device access token OR a signed-in web session. */
export function linkedOrSession(req: FastifyRequest): boolean {
  return tokenValid(bearer(req)) || !!currentUser(req);
}

export interface AccessResult { ok: boolean; status?: number; error?: string }

/** One guard for the protected data routes: valid link/session, matching client id, and (when
 *  MTLS_REQUIRED) a valid client cert. Returns the first failure or {ok:true}. */
export function checkLinkAccess(req: FastifyRequest): AccessResult {
  if (!linkedOrSession(req)) return { ok: false, status: 401, error: "not linked / invalid token" };
  if (!clientIdOk(req, accessLinkId(bearer(req)))) {
    return { ok: false, status: 403, error: "client id does not match this link" };
  }
  if (!mtlsSatisfied(req)) return { ok: false, status: 403, error: "mutual-TLS client certificate required" };
  return { ok: true };
}

/** True when mutual TLS is satisfied: the client presented a cert that validated against our CA.
 *  Only meaningful on the https listener; false for plain http. */
export function mtlsAuthorized(req: FastifyRequest): boolean {
  return (req.raw.socket as { authorized?: boolean }).authorized === true;
}

/** Enforce mutual TLS when MTLS_REQUIRED and the connection is encrypted. A web session (browser,
 *  no client cert) is exempt. Returns true if the request may proceed. */
export function mtlsSatisfied(req: FastifyRequest): boolean {
  if (!MTLS_REQUIRED) return true;
  if (currentUser(req)) return true; // browser sessions don't carry a client cert
  const encrypted = (req.raw.socket as { encrypted?: boolean }).encrypted === true;
  return !encrypted || mtlsAuthorized(req);
}

/** The app's unique client id (Android device id + WHOOP strap id), from the request header. */
export function clientId(req: FastifyRequest): string | null {
  const v = req.headers[CLIENT_ID_HEADER];
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s || null;
}

/** Verify the request's client id matches the one bound to [linkId] at pairing. Reject-by-default:
 *  when REQUIRE_CLIENT_ID, a missing header or a mismatch fails (a token stolen onto another device
 *  carries a different client id). A browser session is exempt. */
export function clientIdOk(req: FastifyRequest, linkId: string | null): boolean {
  if (!REQUIRE_CLIENT_ID) return true;
  if (currentUser(req)) return true;
  if (!linkId) return false;
  const bound = links.linkClientId(db(), linkId);
  const presented = clientId(req);
  return !!bound && !!presented && bound === presented;
}
