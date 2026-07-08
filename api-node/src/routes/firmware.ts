import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

import { FIRMWARE_JSON } from "../config.js";

/** Re-serve the scraper's firmware-latest.json (public, no token) so the paired URL is the one source. */
export async function firmwareRoutes(app: FastifyInstance): Promise<void> {
  app.get("/firmware/latest.json", { schema: { tags: ["firmware"] } }, async (_req, reply) => {
    try {
      const body = readFileSync(FIRMWARE_JSON);
      return reply.type("application/json").header("Cache-Control", "public, max-age=1800").send(body);
    } catch {
      return reply.code(503).send({ ok: false, error: "firmware data not available" });
    }
  });
}
