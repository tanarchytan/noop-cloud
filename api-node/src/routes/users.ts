import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";

import { db } from "../db.js";
import * as auth from "../auth.js";
import { requireAdmin } from "../security.js";

/** Admin-only user management. */
export async function usersRoutes(app: FastifyInstance): Promise<void> {
  const d = db();

  app.get("/api/users", { schema: { tags: ["users"] } }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { users: auth.listUsers(d) };
  });

  app.post("/api/users", {
    schema: {
      tags: ["users"],
      body: Type.Object({
        username: Type.String(), password: Type.String(), is_admin: Type.Optional(Type.Boolean()),
      }),
    },
  }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = req.body as { username: string; password: string; is_admin?: boolean };
    try {
      auth.createUser(d, b.username ?? "", b.password ?? "", !!b.is_admin);
    } catch (e) {
      if (e instanceof auth.ValueError) return reply.code(400).send({ error: e.message });
      if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        return reply.code(409).send({ error: "username already exists" });
      }
      throw e;
    }
    return reply.code(201).send({ ok: true });
  });

  app.delete("/api/users", {
    schema: { tags: ["users"], querystring: Type.Object({ username: Type.String() }) },
  }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      auth.deleteUser(d, (req.query as { username: string }).username ?? "");
    } catch (e) {
      if (e instanceof auth.ValueError) return reply.code(400).send({ error: e.message });
      throw e;
    }
    return { ok: true };
  });
}
