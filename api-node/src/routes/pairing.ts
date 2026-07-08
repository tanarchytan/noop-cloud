import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";

import { db, now } from "../db.js";
import * as links from "../links.js";
import * as pairing from "../pairing.js";
import * as tls from "../tls.js";
import * as ratelimit from "../ratelimit.js";
import { ACCESS_TTL } from "../jwt.js";
import type { FastifyReply } from "fastify";
import { accessLinkId, clientId, clientIdOk, makeAccess, mtlsAuthorized, requireAdmin } from "../security.js";
import { ADMIN_PIN, CODE_TTL, POLL_INTERVAL, REQUIRE_CLIENT_ID, TLS_ENABLED } from "../config.js";
import { log } from "../log.js";

/** Device pairing + the rotating access/refresh token lifecycle. */
export async function pairingRoutes(app: FastifyInstance): Promise<void> {
  const d = db();

  /** Approve a pending code: issue the link (bound to its client id), mint the mTLS client cert, and
   *  reply. Shared by the PIN endpoint (/pair/approve) and the admin-session endpoint. */
  function approveByCode(uc: string, reply: FastifyReply) {
    const row = pairing.byUserCode(d, uc);
    if (!row) return reply.code(404).send({ ok: false, message: "unknown code" });
    if (now() > row.expires) return reply.code(410).send({ ok: false, message: "code expired — start again in the app" });
    if (row.status === "approved") return reply.send({ ok: true, message: "already linked" });
    const [linkId, refresh] = links.issueLink(d, uc, row.client_id);
    pairing.markApproved(d, uc, refresh);
    log.info("pair.approved", { link_id: linkId, client_id: row.client_id });
    // Mint this link's mutual-TLS client cert now (handed to the app on /pair/token). Best-effort:
    // if TLS isn't set up the app simply links without a client cert (server-cert pinning still applies).
    if (TLS_ENABLED) {
      try {
        const cc = tls.mintClientCert(`noop-app-${linkId}`);
        links.saveClientCert(d, linkId, cc.certPem, cc.keyPem);
        log.info("cert.client.mint", { link_id: linkId });
      } catch (e) {
        log.error("cert.client.mint_failed", { link_id: linkId, err: (e as Error).message });
      }
    }
    return reply.send({ ok: true, message: "linked ✓ — your app is now connected" });
  }

  app.post("/pair/start", { schema: { tags: ["pairing"] } }, async (req, reply) => {
    const cid = clientId(req);
    // Reject-by-default: the app must present its unique id (device + strap) to pair.
    if (REQUIRE_CLIENT_ID && !cid) {
      log.warn("pair.start.no_client_id", { ip: req.ip });
      return reply.code(400).send({ error: "client id required (X-Noop-Client-Id) — update the app" });
    }
    const key = cid ?? req.ip;
    const gate = ratelimit.check(d, key, "pair");
    if (!gate.allowed) {
      log.warn("pair.blocked", { key, retry_after: gate.retryAfter });
      return reply.code(429).header("Retry-After", gate.retryAfter)
        .send({ error: `too many pairing attempts — try again in ${gate.retryAfter}s` });
    }
    const started = pairing.start(d, CODE_TTL, cid);
    if (!started) return reply.code(500).send({ error: "could not allocate code" });
    const host = (req.headers.host as string) ?? "localhost";
    log.info("pair.start", { client_id: cid, user_code: started.userCode });
    return {
      device_code: started.deviceCode, user_code: started.userCode,
      verification_uri: `http://${host}/pair`, interval: POLL_INTERVAL, expires_in: CODE_TTL,
    };
  });

  app.post("/pair/approve", {
    schema: { tags: ["pairing"], body: Type.Object({ user_code: Type.String(), pin: Type.String() }) },
  }, async (req, reply) => {
    const b = req.body as { user_code: string; pin: string };
    const uc = (b.user_code ?? "").trim().toUpperCase();
    const gate = ratelimit.check(d, req.ip, "pair");
    if (!gate.allowed) {
      log.warn("pair.approve.blocked", { ip: req.ip, retry_after: gate.retryAfter });
      return reply.code(429).header("Retry-After", gate.retryAfter).send({ ok: false, message: "too many attempts" });
    }
    if (!ADMIN_PIN) return reply.code(503).send({ ok: false, message: "cloud has no PAIR_ADMIN_PIN set" });
    if ((b.pin ?? "").trim() !== ADMIN_PIN) {
      ratelimit.recordFailure(d, req.ip, "pair");
      log.warn("pair.approve.wrong_pin", { ip: req.ip, user_code: uc });
      return reply.code(403).send({ ok: false, message: "wrong PIN" });
    }
    ratelimit.recordSuccess(d, req.ip, "pair");
    return approveByCode(uc, reply);
  });

  // Dashboard approval (admin session, no PIN — the session IS the auth). Powers the React "Devices"
  // screen's Approve button, so the owner never needs the CLI or the standalone /pair page.
  app.get("/api/pair/pending", { schema: { tags: ["pairing"] } }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { pending: pairing.pending(d) };
  });

  app.post("/api/pair/approve", {
    schema: { tags: ["pairing"], body: Type.Object({ user_code: Type.String() }) },
  }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const uc = ((req.body as { user_code: string }).user_code ?? "").trim().toUpperCase();
    return approveByCode(uc, reply);
  });

  app.post("/pair/token", {
    schema: { tags: ["pairing"], body: Type.Object({ device_code: Type.String() }) },
  }, async (req, reply) => {
    const deviceCode = ((req.body as { device_code: string }).device_code ?? "").trim();
    const row = pairing.byDeviceCode(d, deviceCode);
    if (!row) return reply.code(404).send({ error: "unknown device_code" });
    if (row.status === "approved" && row.token) {
      const linkId = links.linkIdForRefresh(d, row.token);
      if (!linkId) return reply.code(410).send({ error: "link reset — start pairing again" });
      if (!clientIdOk(req, linkId)) {
        log.warn("pair.token.client_id_mismatch", { link_id: linkId, presented: clientId(req) });
        return reply.code(403).send({ error: "client id does not match this link" });
      }
      const cc = links.getClientCert(d, linkId);
      return {
        access_token: makeAccess(linkId), refresh_token: row.token, token_type: "Bearer",
        expires_in: ACCESS_TTL,
        // Present these on the mTLS handshake (null when the cloud isn't running TLS).
        ...(cc ? { client_cert: cc.cert, client_key: cc.key } : {}),
      };
    }
    if (now() > row.expires) return reply.code(410).send({ error: "expired", detail: "code expired; start pairing again" });
    return reply.code(202).send({ status: "pending", interval: POLL_INTERVAL });
  });

  app.post("/pair/refresh", {
    schema: { tags: ["pairing"], body: Type.Object({ refresh_token: Type.String() }) },
  }, async (req, reply) => {
    const rt = ((req.body as { refresh_token: string }).refresh_token ?? "").trim();
    if (!rt) return reply.code(400).send({ error: "refresh_token required" });
    const result = links.rotate(d, rt);
    if (!result) return reply.code(401).send({ error: "invalid or expired refresh token — re-pair" });
    const [linkId, newRefresh] = result;
    return { access_token: makeAccess(linkId), refresh_token: newRefresh, token_type: "Bearer", expires_in: ACCESS_TTL };
  });

  app.get("/pair/cert", { schema: { tags: ["pairing"] } }, async (_req, reply) => {
    if (!TLS_ENABLED) return reply.code(404).send({ error: "TLS not enabled on this cloud" });
    try { return { tls: true, sha256: tls.fingerprint() }; }
    catch { return reply.code(503).send({ error: "cert not available" }); }
  });

  app.get("/api/whoami", { schema: { tags: ["pairing"] } }, async (req, reply) => {
    const auth = req.headers.authorization ?? "";
    const linkId = accessLinkId(auth.startsWith("Bearer ") ? auth.slice(7).trim() : null);
    if (!linkId) return reply.code(401).send({ error: "missing or expired access token" });
    if (!links.linkActive(d, linkId)) return reply.code(401).send({ error: "link revoked — re-pair" });
    if (!clientIdOk(req, linkId)) return reply.code(403).send({ error: "client id does not match this link" });
    // true when the client presented a cert that validated against our CA (mutual TLS).
    return { linked: true, link_id: linkId, mtls: mtlsAuthorized(req) };
  });
}
