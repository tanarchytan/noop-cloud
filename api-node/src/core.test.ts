import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as auth from "./auth.js";
import * as links from "./links.js";
import * as metrics from "./metrics.js";
import * as jwt from "./jwt.js";
import * as ratelimit from "./ratelimit.js";

/** Fresh in-memory DB with every module's schema applied — the unit-test harness. */
function freshDb(): Database.Database {
  const d = new Database(":memory:");
  d.pragma("foreign_keys = ON");
  auth.ensureSchema(d);
  links.ensureSchema(d);
  metrics.ensureSchema(d);
  ratelimit.ensureSchema(d);
  return d;
}

test("password hash verifies and rejects wrong password", () => {
  const h = auth.hashPassword("s3cret");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(auth.verifyPassword("s3cret", h), true);
  assert.equal(auth.verifyPassword("wrong", h), false);
});

test("seedAdmin creates admin/admin must_change; isUnconfigured true until password set", () => {
  const d = freshDb();
  auth.seedAdmin(d);
  assert.equal(auth.isUnconfigured(d), true);
  const u = auth.authenticate(d, "admin", "admin");
  assert.ok(u && u.is_admin && u.must_change);
  auth.setPassword(d, "admin", "real-pw");
  assert.equal(auth.isUnconfigured(d), false);
});

test("sessions round-trip and expire-delete", () => {
  const d = freshDb();
  auth.seedAdmin(d);
  const u = auth.authenticate(d, "admin", "admin")!;
  const tok = auth.createSession(d, u.id);
  assert.equal(auth.sessionUser(d, tok)?.username, "admin");
  auth.deleteSession(d, tok);
  assert.equal(auth.sessionUser(d, tok), null);
});

test("createUser rejects short password + duplicate username", () => {
  const d = freshDb();
  assert.throws(() => auth.createUser(d, "bob", "xy"), auth.ValueError);
  auth.createUser(d, "bob", "goodpw");
  assert.throws(() => auth.createUser(d, "bob", "goodpw")); // UNIQUE constraint
});

test("jwt access token verifies and rejects tamper", () => {
  const d = freshDb();
  const secret = jwt.getSecret(d);
  const tok = jwt.makeAccess(secret, "link-123");
  assert.equal(jwt.verifyAccess(secret, tok), "link-123");
  assert.equal(jwt.verifyAccess(secret, tok + "x"), null);
  assert.equal(jwt.verifyAccess(secret, "not.a.jwt"), null);
});

test("link refresh rotates, and REUSE of a spent token revokes the link", () => {
  const d = freshDb();
  const [linkId, r0] = links.issueLink(d, "NOOP-TEST", "device-1:strap-9");
  assert.equal(links.linkActive(d, linkId), true);
  const rot = links.rotate(d, r0);
  assert.ok(rot);
  const [, r1] = rot!;
  // Replaying the spent r0 must fail AND revoke the whole link.
  assert.equal(links.rotate(d, r0), null);
  assert.equal(links.linkActive(d, linkId), false);
  // The rotated r1 is now dead too (link revoked).
  assert.equal(links.rotate(d, r1), null);
});

test("metrics partial upsert never nulls a previously-synced column", () => {
  const d = freshDb();
  metrics.ingest(d, { days: [{ day: "2026-07-08", recovery: 60, strain: 11, provenance: "band" }] });
  metrics.ingest(d, { days: [{ day: "2026-07-08", strain: 13 }] }); // partial
  const t = metrics.today(d);
  assert.equal(t.recovery, 60); // preserved
  assert.equal(t.strain, 13); // updated
  assert.equal(t.provenance, "band"); // preserved
});

test("metrics history returns oldest→newest", () => {
  const d = freshDb();
  metrics.ingest(d, { days: [{ day: "2026-07-06", recovery: 50 }, { day: "2026-07-08", recovery: 70 }] });
  const h = metrics.history(d, 30);
  assert.equal(h[0].day, "2026-07-06");
  assert.equal(h[h.length - 1].day, "2026-07-08");
});

test("rate limit bans an ip after repeated failures, and success clears it", () => {
  const d = freshDb();
  const ip = "10.0.0.9";
  assert.equal(ratelimit.check(d, ip, "login").allowed, true);
  for (let i = 0; i < 5; i++) ratelimit.recordFailure(d, ip, "login"); // MAX default 5
  assert.equal(ratelimit.check(d, ip, "login").allowed, false); // now banned
  // A different bucket is independent.
  assert.equal(ratelimit.check(d, ip, "pair").allowed, true);
  ratelimit.recordSuccess(d, ip, "login");
  assert.equal(ratelimit.check(d, ip, "login").allowed, true); // cleared
});

test("link is bound to its client id at pairing", () => {
  const d = freshDb();
  const [linkId] = links.issueLink(d, "NOOP-X", "androidABC:strap123");
  assert.equal(links.linkClientId(d, linkId), "androidABC:strap123");
});
