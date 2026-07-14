import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";

import { db } from "../db.js";
import * as bp from "../bp.js";
import * as ratelimit from "../ratelimit.js";
import { accessLinkId, bearer, checkLinkAccess, currentUser } from "../security.js";
import { DATA_MAX_PER_MIN } from "../config.js";
import { log } from "../log.js";

/** Per-link rate cap shared by the CPU-heavy PPG routes. */
function bpThrottle(req: FastifyRequest): ratelimit.Gate {
  return ratelimit.throttle(db(), accessLinkId(bearer(req)) ?? req.ip, "data", DATA_MAX_PER_MIN, 60);
}

const PpgBody = Type.Object({ ppg: Type.Array(Type.Number()), fs: Type.Number() });

/** Cuffless blood-pressure estimate from the strap PPG (experimental wellness estimate). */
export async function bpRoutes(app: FastifyInstance): Promise<void> {
  const d = db();

  // Calibrate against a real cuff reading taken WHILE this PPG window was captured.
  app.post("/api/bp/calibrate", {
    schema: {
      tags: ["bp"],
      body: Type.Intersect([PpgBody, Type.Object({ systolic: Type.Integer(), diastolic: Type.Integer() })]),
    },
  }, async (req, reply) => {
    const access = checkLinkAccess(req);
    if (!access.ok) return reply.code(access.status!).send({ error: access.error });
    const gate = bpThrottle(req);
    if (!gate.allowed) return reply.code(429).header("Retry-After", gate.retryAfter).send({ error: `rate limit — retry in ${gate.retryAfter}s` });
    const b = req.body as { ppg: number[]; fs: number; systolic: number; diastolic: number };
    const f = bp.extractFeatures(b.ppg, b.fs);
    if (!f) return reply.code(422).send({ error: "PPG signal too poor to calibrate — hold still and retry" });
    bp.calibrate(d, b.systolic, b.diastolic, f);
    log.info("bp.calibrate", { systolic: b.systolic, diastolic: b.diastolic, hr: Math.round(f.hr) });
    return { ok: true, features: f };
  });

  // Estimate from a fresh PPG window (needs a prior calibration).
  app.post("/api/bp/estimate", { schema: { tags: ["bp"], body: PpgBody } }, async (req, reply) => {
    const access = checkLinkAccess(req);
    if (!access.ok) return reply.code(access.status!).send({ error: access.error });
    const gate = bpThrottle(req);
    if (!gate.allowed) return reply.code(429).header("Retry-After", gate.retryAfter).send({ error: `rate limit — retry in ${gate.retryAfter}s` });
    const b = req.body as { ppg: number[]; fs: number };
    const f = bp.extractFeatures(b.ppg, b.fs);
    if (!f) return reply.code(422).send({ error: "PPG signal too poor — hold still and retry" });
    const est = bp.estimate(d, f);
    if (!est) return reply.code(409).send({ error: "not calibrated — take a cuff calibration first" });
    log.info("bp.estimate", { systolic: est.systolic, diastolic: est.diastolic, confidence: est.confidence });
    return est;
  });

  app.get("/api/bp/latest", { schema: { tags: ["bp"] } }, async (req, reply) => {
    if (!currentUser(req)) return reply.code(401).send({ error: "not signed in" });
    return bp.latest(d);
  });
}
