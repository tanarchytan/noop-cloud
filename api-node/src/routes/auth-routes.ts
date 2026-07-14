import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";

import { db } from "../db.js";
import * as auth from "../auth.js";
import { SESSION_TTL } from "../auth.js";
import * as ratelimit from "../ratelimit.js";
import { currentUser, isRequestSecure } from "../security.js";
import { log } from "../log.js";

/** Web login / logout / session / password-change. */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const d = db();

  app.post("/api/login", {
    schema: { tags: ["auth"], body: Type.Object({ username: Type.String(), password: Type.String() }) },
  }, async (req, reply) => {
    const ip = req.ip;
    const gate = ratelimit.check(d, ip, "login");
    if (!gate.allowed) {
      log.warn("login.blocked", { ip, retry_after: gate.retryAfter });
      return reply.code(429).header("Retry-After", gate.retryAfter)
        .send({ error: `too many attempts — try again in ${gate.retryAfter}s` });
    }
    const { username, password } = req.body as { username: string; password: string };
    const user = auth.authenticate(d, (username ?? "").trim(), password ?? "");
    if (!user) {
      ratelimit.recordFailure(d, ip, "login");
      log.warn("login.fail", { ip, username: (username ?? "").trim() });
      return reply.code(401).send({ error: "wrong username or password" });
    }
    ratelimit.recordSuccess(d, ip, "login");
    const token = auth.createSession(d, user.id);
    reply.setCookie("sid", token, {
      path: "/", httpOnly: true, sameSite: "lax", secure: isRequestSecure(req), maxAge: SESSION_TTL,
    });
    log.info("login.ok", { ip, user: user.username, is_admin: user.is_admin });
    return { ok: true, username: user.username, is_admin: user.is_admin, must_change: user.must_change };
  });

  app.post("/api/logout", { schema: { tags: ["auth"] } }, async (req, reply) => {
    auth.deleteSession(d, req.cookies?.sid);
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });

  app.get("/api/session", { schema: { tags: ["auth"] } }, async (req, reply) => {
    const u = currentUser(req);
    return u ?? reply.code(401).send({ error: "not signed in" });
  });

  app.post("/api/password", {
    schema: { tags: ["auth"], body: Type.Object({ new_password: Type.String() }) },
  }, async (req, reply) => {
    const u = currentUser(req);
    if (!u) return reply.code(401).send({ error: "not signed in" });
    try {
      auth.setPassword(d, u.username, (req.body as { new_password: string }).new_password ?? "");
    } catch (e) {
      if (e instanceof auth.ValueError) return reply.code(400).send({ error: e.message });
      throw e;
    }
    return { ok: true };
  });
}
