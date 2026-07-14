import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";

import { db } from "../db.js";
import * as ratelimit from "../ratelimit.js";
import { accessLinkId, bearer, checkLinkAccess } from "../security.js";
import { AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_SYSTEM_PROMPT, COACH_MAX_PER_MIN } from "../config.js";

/** The AI coach proxy — the cloud owns the system prompt + provider + model; universal OpenAI-compatible. */
export async function coachRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/coach/chat", {
    schema: {
      tags: ["coach"],
      body: Type.Object({
        messages: Type.Array(Type.Object({ role: Type.String(), content: Type.String() })),
      }),
    },
  }, async (req, reply) => {
    const access = checkLinkAccess(req);
    if (!access.ok) return reply.code(access.status!).send({ error: access.error });
    // Per-link rate cap: a compromised or runaway client must not burn the AI key or turn this into an
    // open OpenAI-compatible proxy.
    const key = accessLinkId(bearer(req)) ?? req.ip;
    const gate = ratelimit.throttle(db(), key, "coach", COACH_MAX_PER_MIN, 60);
    if (!gate.allowed) {
      return reply.code(429).header("Retry-After", gate.retryAfter)
        .send({ error: `coach rate limit — try again in ${gate.retryAfter}s` });
    }
    if (!AI_API_KEY) return reply.code(503).send({ error: "cloud AI not configured (set AI_API_KEY)" });
    const msgs = (req.body as { messages: unknown[] }).messages;
    if (!Array.isArray(msgs) || msgs.length === 0) return reply.code(400).send({ error: "messages[] required" });

    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: "system", content: AI_SYSTEM_PROMPT }, ...msgs],
          temperature: 0.6, max_tokens: 900,
        }),
      });
      if (!r.ok) return reply.code(502).send({ error: `provider HTTP ${r.status}`, detail: (await r.text()).slice(0, 300) });
      data = await r.json();
    } catch (e) {
      return reply.code(502).send({ error: `provider call failed: ${String((e as Error).message).slice(0, 200)}` });
    }
    const replyText = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!replyText) return reply.code(502).send({ error: "provider returned empty reply" });
    return { reply: replyText, model: AI_MODEL };
  });
}
