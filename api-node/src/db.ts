import Database from "better-sqlite3";

/**
 * Shared SQLite connection for noop-cloud — the Node port of the Python `db.py`.
 *
 * One database file holds everything: pairings/tokens (device link), users/sessions (web login), the
 * synced metric tables, and the rotating-link tables. Each module owns its own `CREATE TABLE IF NOT
 * EXISTS`, so the schema is additive and no migration step is needed. WAL + a busy timeout so the
 * concurrent Fastify request handlers don't trip over each other.
 */
const DB_PATH = process.env.DB_PATH ?? "/data/pairing.db";

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const d = new Database(DB_PATH, { timeout: 10_000 });
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  _db = d;
  return d;
}

/** epoch seconds — the whole codebase stores times as integer seconds, matching the Python build. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}
