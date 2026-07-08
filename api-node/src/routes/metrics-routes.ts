import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";

import { db } from "../db.js";
import * as metrics from "../metrics.js";
import { checkLinkAccess, currentUser } from "../security.js";
import { log } from "../log.js";

/** Metric sync (from the app) + read models (for the dashboard). */
export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  const d = db();

  app.post("/api/sync", { schema: { tags: ["metrics"] } }, async (req, reply) => {
    // Written by the app: a paired-device access token OR a signed-in session (manual push/test).
    const access = checkLinkAccess(req);
    if (!access.ok) return reply.code(access.status!).send({ error: access.error });
    const payload = req.body;
    if (typeof payload !== "object" || payload === null) return reply.code(400).send({ error: "JSON object body required" });
    const result = metrics.ingest(d, payload as never);
    log.info("sync.ok", { days: result.days, hr: result.hr });
    return { ok: true, ...result };
  });

  app.get("/api/metrics/today", { schema: { tags: ["metrics"] } }, async (req, reply) => {
    if (!currentUser(req)) return reply.code(401).send({ error: "not signed in" });
    return metrics.today(d);
  });

  app.get("/api/metrics/history", {
    schema: { tags: ["metrics"], querystring: Type.Object({ days: Type.Optional(Type.String()) }) },
  }, async (req, reply) => {
    if (!currentUser(req)) return reply.code(401).send({ error: "not signed in" });
    const n = Number((req.query as { days?: string }).days ?? "30") || 30;
    return { days: metrics.history(d, n), hr: metrics.recentHr(d) };
  });
}
