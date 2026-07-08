# noop-cloud — ideas / backlog

Executed roadmap (built + verified):
- **Phase 1** — security spine: web login, users, localhost-only first-run, device pairing (rotating code). ✅
- **Phase 2** — REST metrics/sync API (`/api/sync`, `/api/metrics/*`). ✅
- **Phase 3** — app-side opt-in auto data sync (`com.noop.sync.CloudSync`). ✅
- **Phase 4** — metrics dashboard (goose 4-tab, WHOOP-style rings). ✅
- **Phase 5** — link token hardening: 5-min access JWT + rotating 8h-idle refresh, reuse-detection. ✅
- **Phase 5b** — transport: optional self-signed HTTPS for the app link + app cert-pinning (TOFU). ✅
  (Full mutual TLS with a *client* cert is the remaining stretch — one-way server-cert pinning done.)

---

## Phase 5 — Link security hardening (band/app ↔ cloud)  — token model DONE ✅ / mTLS stretch PENDING

**Done (cloud `jwtmini.py`+`links.py`+`pair_api.py`, app `CloudSession`/`CloudClient`/`CloudPrefs`):**
5-min HS256 access JWT auto-rotated from an opaque single-use refresh token with a sliding 8h idle
window; transient outage < 8h survives; idle > 8h or refresh reuse revokes the link. Verified end-to-end.

**Why (original).** Pairing used to mint a single **opaque, non-expiring bearer token** that the
app then sent on every `/api/sync` and coach call. A leaked token was valid forever and there was no
transport-level mutual auth. This phase upgraded the *link* (not the
one-time pairing UX, which stays the rotating-code flow) to short-lived, auto-rotating credentials with
an idle lifetime — resilient to transient internet loss but self-expiring when truly idle.

### Token model — short access + sliding refresh
- **Access token = JWT, 5-min TTL.** Signed by the cloud (HS256 with a per-install secret, or RS256 if
  we want asymmetric). Stateless-verifiable; carries `link_id`, `scope`, `iat`, `exp`. Used as the
  `Authorization: Bearer` on `/api/sync`, `/api/coach/chat`, etc. Server rejects on `exp`.
- **Refresh token = opaque, server-stored, single-use, sliding 8-hour idle window.** Persisted
  encrypted on the app (extend `CloudPrefs`). `POST /pair/refresh {refresh_token}` → new 5-min access +
  a **rotated** refresh (old one invalidated). Each successful refresh bumps `last_used`; if a refresh
  goes unused for **8 h**, it expires → the link drops and the app must re-pair.
- **Transient internet loss ≠ disconnect.** The 5-min access token expiring during an outage does *not*
  disconnect: the refresh token lives on the app. When connectivity returns within the 8-h idle window,
  the app silently refreshes and resumes. Only 8 h of *no successful refresh* ends the link.
- **Refresh-reuse detection.** Because refresh is single-use + rotated, presenting an old refresh
  (replay) is a theft signal → invalidate the whole refresh chain for that link and force re-pair.

### Auto-rotation on the app side
- `CloudClient` gains `refresh()`; a small token manager mints/caches the access JWT, refreshing ~30 s
  before `exp` and on any `401 token_expired`. Sync/coach calls go through it, so callers never see the
  rotation. Retries with backoff across an outage; gives up (surfaces "re-link needed") only after the
  refresh itself 401s (i.e. past the 8-h idle window or after a reuse-detection revoke).

### Transport hardening (stretch) — mutual TLS with two self-signed certs
- At pairing, the cloud mints a **client cert** for the app and the app pins the **cloud's self-signed
  cert** (TOFU — trust-on-first-use, learned during the in-person rotating-code approval). Thereafter the
  link is **mTLS**: cloud verifies the app's client cert, app verifies the pinned cloud cert. Defeats LAN
  MITM even on plain/hostile networks and gives mutual identity independent of the bearer.
- Cheaper alternative if mTLS is too heavy for the stdlib server: keep bearer JWTs but **pin the cloud's
  self-signed cert** in the app (one-way TLS pinning) and require HTTPS for any non-loopback base URL
  (NetGuard already forces this).

### Server changes
- New tables: `links` (link_id, created, last_used, status), `refresh_tokens` (token, link_id, created,
  expires=last_used+8h, used INTEGER). Migrate the current `tokens` rows to a `links` row + initial
  refresh.
- New endpoints: `POST /pair/refresh`; JWT verify middleware replacing the `tokens` table lookup in
  `_token_valid`.
- Keep the rotating **pairing code** unchanged (5-min TTL) — it already matches this model's spirit.

### Acceptance
- Access token expires in 5 min; app keeps working across it (auto-refresh).
- Pull the network for < 8 h, restore → sync resumes with no re-pair.
- Idle > 8 h with no refresh → link expires; app prompts to re-link.
- Replayed refresh token → chain revoked.

---

## Other backlog
- **Sleep-performance sync.** `DailyMetric` lacks the composite `sleep_performance`; wire the app to send
  it (from the series layer / `DayResult.rest`) so the dashboard Sleep ring fills. (Currently null.)
- **ONNX chat provider.** Pluggable local `.onnx` model behind the same `/api/coach/chat` (decided:
  OpenAI-compatible first, ONNX slot later).
- **History charts.** Dashboard Health tab: 30-day trend sparklines from `/api/metrics/history`.
- **HTTPS/reverse-proxy recipe.** Caddy/Traefik sidecar for a real cert when exposed beyond the LAN.
