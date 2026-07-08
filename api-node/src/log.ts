/**
 * Tiny structured logger (no dependency). Emits one JSON line per event to stdout, so `docker logs`
 * stays greppable. Level threshold via LOG_LEVEL (debug < info < warn < error; default info).
 *
 * Domain events are logged with a stable `event` name + context fields, e.g.
 *   log.info("login.ok", { user, ip }) · log.warn("pair.ban", { ip, until }) · log.error("cert.invalid", …)
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const THRESHOLD = ORDER[(process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : "info"];

function emit(level: Level, event: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < THRESHOLD) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
