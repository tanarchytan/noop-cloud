import { randomInt } from "node:crypto";

/**
 * All environment-driven configuration in one place (same env names as the Python build), so the rest
 * of the code reads typed constants instead of scattering `process.env` lookups.
 */
// Version + compatibility contract. SERVICE_VERSION is the human release; API_VERSION is the wire
// contract the app must match (bump it on any breaking endpoint change); MIN_APP_API is the oldest
// app contract this cloud still accepts. The app checks these on link (see /api/version).
export const SERVICE_VERSION = "1.0.0";
export const API_VERSION = 1;
export const MIN_APP_API = 1;

export const PORT = Number(process.env.PORT ?? "80");
export const TLS_ENABLED = ["1", "true", "yes", "on"].includes((process.env.TLS_ENABLED ?? "").toLowerCase());
export const TLS_PORT = Number(process.env.TLS_PORT ?? "443");
export const ADMIN_PIN = process.env.PAIR_ADMIN_PIN ?? "";
// When set, protected data routes require a valid mutual-TLS client cert (in addition to the token).
// Default off so http and cert-less links keep working; flip on for a hardened https-only deployment.
export const MTLS_REQUIRED = ["1", "true", "yes", "on"].includes((process.env.MTLS_REQUIRED ?? "").toLowerCase());
// Require a unique client id (app: Android device id + WHOOP strap id) on pairing + data routes, and
// bind it to the link so a token stolen onto another device is rejected. Reject-by-default (on).
export const REQUIRE_CLIENT_ID =
  !["0", "false", "no", "off"].includes((process.env.REQUIRE_CLIENT_ID ?? "").toLowerCase());
export const CLIENT_ID_HEADER = "x-noop-client-id";
export const CODE_TTL = Number(process.env.PAIR_CODE_TTL_SECONDS ?? "300");
export const POLL_INTERVAL = Number(process.env.PAIR_POLL_INTERVAL_SECONDS ?? "3");
export const FIRMWARE_JSON = process.env.FIRMWARE_JSON ?? "/firmware-data/firmware-latest.json";

export const AI_BASE_URL = (process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
export const AI_API_KEY = process.env.AI_API_KEY ?? "";
export const AI_MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";
export const AI_SYSTEM_PROMPT = process.env.AI_SYSTEM_PROMPT ??
  "You are a concise, evidence-based fitness and recovery coach for a wearable user. Ground every " +
  "answer in the numbers the user provides. Be practical and specific; never give medical advice or " +
  "diagnose. If data is missing, say so plainly.";

/** Paths an UNCONFIGURED cloud (admin still on the default password) will serve — nothing else. */
export const SETUP_PATHS = new Set([
  "/", "/login", "/change", "/health", "/api/version",
  "/api/login", "/api/logout", "/api/password", "/api/session",
]);

// Rotating pairing code: unambiguous alphabet (no 0/O/1/I) so it's easy to read off a screen.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const makeUserCode = (): string =>
  "NOOP-" + Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
