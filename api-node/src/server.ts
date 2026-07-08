import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { db } from "./db.js";
import * as auth from "./auth.js";
import * as links from "./links.js";
import * as metrics from "./metrics.js";
import * as pairing from "./pairing.js";
import * as ratelimit from "./ratelimit.js";
import * as tls from "./tls.js";
import { clientIsLoopback, initSecret, pathOf } from "./security.js";
import { PORT, SETUP_PATHS, TLS_ENABLED, TLS_PORT } from "./config.js";
import { log } from "./log.js";

import { pagesRoutes } from "./routes/pages.js";
import { authRoutes } from "./routes/auth-routes.js";
import { usersRoutes } from "./routes/users.js";
import { pairingRoutes } from "./routes/pairing.js";
import { metricsRoutes } from "./routes/metrics-routes.js";
import { coachRoutes } from "./routes/coach.js";
import { firmwareRoutes } from "./routes/firmware.js";

/** Register every route module on an instance. Shared by the http and (optional) https listeners. */
async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(pagesRoutes);
  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(pairingRoutes);
  await app.register(metricsRoutes);
  await app.register(coachRoutes);
  await app.register(firmwareRoutes);
}

/** Build a fully-wired instance: Swagger, cookies, the setup gate, and all routes. */
async function buildApp(https?: tls.ServerTlsOptions): Promise<FastifyInstance> {
  // One typed options object → a single Fastify() call, so `app` is one concrete instance type (the
  // https branch otherwise widens it to a non-callable union). `https` is still honoured at runtime.
  const opts: FastifyServerOptions = { logger: false };
  if (https) (opts as FastifyServerOptions & { https: tls.ServerTlsOptions }).https = https;
  const app = Fastify(opts);

  await app.register(cookie);
  await app.register(swagger, {
    openapi: {
      info: { title: "noop-cloud API", version: "1.0.0", description: "Self-hosted WHOOP-companion cloud." },
      tags: [
        { name: "auth" }, { name: "users" }, { name: "pairing" }, { name: "metrics" },
        { name: "coach" }, { name: "firmware" },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // Setup gate: while unconfigured, non-loopback clients get only the setup surface (defence in depth;
  // the compose port bind to 127.0.0.1 is the physical enforcement).
  app.addHook("onRequest", async (req, reply) => {
    if (clientIsLoopback(req)) return;
    const p = pathOf(req);
    if (p.startsWith("/docs")) return;
    if (auth.isUnconfigured(db()) && !SETUP_PATHS.has(p)) {
      reply.code(403).send({
        error: "cloud not set up yet — finish first-run setup (set an admin password) before this cloud will serve anything else",
      });
    }
  });

  await registerRoutes(app);
  await registerDashboard(app);
  return app;
}

// The built Vite SPA (web/dist) served under /app. Path is relative to the compiled server at
// dist/server.js → ../web/dist. Absent until `npm run build` in web/ → skipped gracefully.
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");

async function registerDashboard(app: FastifyInstance): Promise<void> {
  if (!existsSync(join(WEB_ROOT, "index.html"))) return;
  await app.register(fastifyStatic, { root: WEB_ROOT, prefix: "/app/" });
  // /app and any client route → the SPA entry (React handles the in-app tabs).
  const spa = async (_req: unknown, reply: FastifyReply) => reply.sendFile("index.html");
  app.get("/app", spa);
  app.get("/app/", spa);
}

// ── startup ──────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const d = db();
  auth.ensureSchema(d);
  metrics.ensureSchema(d);
  links.ensureSchema(d);
  pairing.ensureSchema(d);
  ratelimit.ensureSchema(d);
  initSecret(d);
  auth.seedAdmin(d);
  if (auth.maybeEnvReset(d)) log.warn("admin.reset", { reason: "FORGOT_PASSWORD" });
  if (auth.isUnconfigured(d)) log.info("setup.pending", { hint: "sign in admin/admin on localhost" });
  if (!process.env.PAIR_ADMIN_PIN) log.warn("pair.no_admin_pin");

  const httpApp = await buildApp();
  await httpApp.listen({ host: "0.0.0.0", port: PORT });
  log.info("listen.http", { port: PORT });

  if (TLS_ENABLED) {
    try {
      const created = !tls.certExists();
      tls.ensureCert();
      if (created) log.info("cert.server.created", { sha256: tls.fingerprint() });
      const httpsApp = await buildApp(tls.serverTlsOptions());
      await httpsApp.listen({ host: "0.0.0.0", port: TLS_PORT });
      log.info("listen.https", {
        port: TLS_PORT, sha256: tls.fingerprint(), kex_pqc: "X25519MLKEM768",
        cert_alg: tls.certAlg(), mtls: true,
      });
    } catch (e) {
      log.error("tls.setup_failed", { err: (e as Error).message });
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
