import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";

import { db } from "../db.js";
import * as auth from "../auth.js";
import { currentUser } from "../security.js";
import { changePage, loginPage } from "../web.js";
import { PAIR_PAGE } from "./pair-page.js";
import { API_VERSION, MIN_APP_API, SERVICE_VERSION } from "../config.js";

/** Health check + version/compat + the server-rendered auth pages + the /pair approval page. */
export async function pagesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", { schema: { tags: ["auth"], response: { 200: Type.Object({ ok: Type.Boolean() }) } } },
    async () => ({ ok: true }));

  // Public liveness + version handshake — the app fetches this on link to confirm the cloud is up and
  // that its wire contract (api) is compatible before pairing.
  app.get("/api/version", {
    schema: {
      tags: ["auth"],
      response: {
        200: Type.Object({
          service: Type.String(), version: Type.String(), api: Type.Integer(), min_app_api: Type.Integer(),
        }),
      },
    },
  }, async () => ({ service: "noop-cloud", version: SERVICE_VERSION, api: API_VERSION, min_app_api: MIN_APP_API }));

  app.get("/pair", async (_req, reply) => reply.type("text/html").send(PAIR_PAGE));

  const serveLogin = (req: FastifyRequest, reply: FastifyReply) => {
    const u = currentUser(req);
    if (u) return reply.redirect(u.must_change ? "/change" : "/app");
    return reply.type("text/html").send(loginPage(auth.isUnconfigured(db())));
  };
  app.get("/", serveLogin);
  app.get("/login", serveLogin);
  app.get("/change", async (_req, reply) => reply.type("text/html").send(changePage()));
  // /app is served by the React SPA (see registerDashboard in server.ts). The SPA calls /api/session
  // on load and redirects to /login or /change itself.
}
