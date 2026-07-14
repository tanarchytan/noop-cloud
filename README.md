<h1 align="center">noop-cloud</h1>

<p align="center"><b>Your optional, self-hosted companion cloud for the <a href="https://github.com/ryanbr/noop">noop</a> WHOOP app.</b></p>

<p align="center">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-yes-22c55e?style=flat-square">
  <img alt="Node" src="https://img.shields.io/badge/Node-24%20LTS-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="Fastify" src="https://img.shields.io/badge/Fastify-5-000000?style=flat-square&logo=fastify&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-embedded-003b57?style=flat-square&logo=sqlite&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-compose-2496ed?style=flat-square&logo=docker&logoColor=white">
  <img alt="Account free" src="https://img.shields.io/badge/account-free-c8902f?style=flat-square">
</p>

---

**noop** keeps your WHOOP data **on your phone** — it's the BLE gateway and computes every score
on-device, no account, no cloud. **noop-cloud** is the *optional* side service, running on **your** hardware,
that does the things a phone-only app can't: a **web dashboard**, **durable metric sync**, an **AI coach**,
and a **no-login firmware update check**.

The app only ever talks to **your** cloud. Not affiliated with WHOOP. Own-device / public-data only.

## Features

| | |
|---|---|
| 📊 **Web dashboard** | React SPA — Home (Recovery/Sleep/Strain rings), Health (trends + vitals), Coach, Devices, Admin, Settings |
| 🔗 **Device pairing** | Link the app with a short rotating code (RFC 8628); approve with a **button in the dashboard** or a PIN |
| ☁️ **Metric sync** | The app pushes its computed daily metrics; the dashboard shows them and keeps them durable |
| 🤖 **AI coach** | Universal **OpenAI-compatible** proxy — OpenAI, Groq, OpenRouter, or a **local Ollama** |
| 📦 **Firmware update-check** | Scrapes WHOOP's JS-rendered release notes → JSON; the app compares to the band's BLE version, **no WHOOP login** |
| 👥 **Users** | Admin account with forced first-run password change; add/remove users |
| 📖 **API docs** | Auto-generated OpenAPI/Swagger UI at `/docs` |

## Security

Built for exposing a personal service on a home network — safely.

- **First-run gate** — default `admin/admin`, forced password change; until a real password is set a
  **remote** client gets liveness only (`/health`, `/api/version`) — setup must happen on `localhost`, so
  an exposed-before-setup cloud can't be seized with the default password.
- **Auth** — `scrypt` password hashing, server-side sessions (`httpOnly`, `SameSite=Lax`, `Secure` on
  https), admin-only user management. `/docs` is localhost- or admin-only.
- **Rate-limit + IP ban** — sliding-window on login and pairing with escalating bans (survives restart),
  plus per-link request caps on the AI coach and data routes so a compromised client can't burn the AI
  key or pin the CPU. A body-size limit bounds each payload.
- **Response hardening** — `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy`, and HSTS on the https path.
- **Rotating tokens** — 5-minute access **JWT** auto-rotated from an opaque refresh token with a sliding
  8-hour idle window. Refresh **reuse revokes the link** (theft signal). A transient outage doesn't disconnect.
- **Client binding** — every request carries a unique client id (**device + strap**); a token replayed
  from another device is rejected.
- **Mutual TLS** *(optional, `TLS_ENABLED=1`)* — self-signed cert the app pins **trust-on-first-use**;
  the cloud mints a per-link **client cert** for full mTLS.
- **Post-quantum ready** — TLS 1.3 key exchange defaults to hybrid **X25519MLKEM768** (clients auto-upgrade
  when their TLS stack supports it); `CERT_ALG=mldsa65` for ML-DSA post-quantum cert signatures.
- **Everything is logged** — structured JSON events for logins, pairings, cert lifecycle, and bans.

## Architecture

Two small containers, **SQLite** storage, **no external database**:

```
firmware  (Python · Selenium/Alpine)   scrape release notes every 12h → firmware-latest.json   :8088
api       (Fastify · Node 24 LTS · TS) pairing · sync · coach · firmware re-serve · dashboard   :8089 http · :8443 https
```

The `api` container builds the React dashboard (Vite) and serves it from the same process. Lean by design:
Node built-ins do password hashing (`scrypt`), JWTs (`createHmac`), TLS, and HTTP (`fetch`); TypeBox route
schemas give request validation **and** the OpenAPI spec from one definition.

## Quick start

```bash
git clone <this-repo> noop-cloud && cd noop-cloud
cp .env.example .env               # set PAIR_ADMIN_PIN (and AI_API_KEY for the coach)
docker compose up -d --build
```

Then:
1. Open **http://localhost:8089/** → sign in `admin` / `admin` → set a real password.
2. API docs at **http://localhost:8089/docs**.
3. To let your phone reach it, set `API_BIND=0.0.0.0` in `.env` (and `TLS_ENABLED=1` for the pinned HTTPS
   link on `:8443`) and re-run `docker compose up -d`.
4. In the app: **Settings → Cloud** → enter the URL → **Link** → approve the code in the dashboard's
   **Devices** tab (or the `/pair` page with your PIN).

## Exposing to the internet

Reaching your cloud from outside the LAN (port-forwarding). The service has **two listeners with two
different consumers — expose them differently:**

| Consumer | Listener | How |
|---|---|---|
| **Phone app** | `:8443` HTTPS, self-signed | **Direct** port-forward `:8443` (`TLS_ENABLED=1`). The app **pins** the cert — don't proxy it. Turn on `MTLS_REQUIRED=1`. |
| **Browser dashboard** | `:8089` HTTP (localhost) | **Don't forward `:8089` raw.** Front it with a reverse proxy that terminates a real cert — see [`Caddyfile.example`](Caddyfile.example). |

**Do it in this order:**

1. **Finish setup on `localhost` first** — a strong admin password. (A remote client can't reach the auth
   surface until this is done, so never skip it.)
2. Set a **strong `PAIR_ADMIN_PIN`**; keep `API_BIND=127.0.0.1`.
3. Front the dashboard with **Caddy** (`Caddyfile.example`): real Let's-Encrypt cert, security headers,
   `/docs` blocked. Set **`TRUST_PROXY=1`** so per-IP rate-limiting and the `Secure` cookie see the real
   client and scheme.
4. For the phone, forward **`:8443`** and set **`MTLS_REQUIRED=1`**.

> **Why not one cert for both?** The app pins the self-signed `:8443` cert; a rotating Let's-Encrypt cert
> (renewed every ~90 days) would break that pin and force a re-link. So the browser gets the real cert via
> the proxy, and the app keeps its own pinned one. Note: Tailscale/CGNAT `100.x` addresses are *not* treated
> as LAN, so use `https` even over a VPN.

## API

`GET /api/version` → `{ service, version, api, min_app_api }` — the app checks `api` for compatibility
before pairing and refuses a mismatched cloud with a clear message.

| Area | Endpoints |
|---|---|
| Pairing | `POST /pair/start` · `/pair/approve` · `/pair/token` · `/pair/refresh` · `GET /pair/cert` |
| Metrics | `POST /api/sync` · `GET /api/metrics/today` · `/api/metrics/history` |
| Coach | `POST /api/coach/chat` |
| Auth / users | `POST /api/login` · `/api/logout` · `/api/password` · `GET /api/session` · `GET/POST/DELETE /api/users` |
| Firmware | `GET /firmware/latest.json` |
| Meta | `GET /health` · `/api/version` · `/docs` |

Full schemas at `/docs`.

## Configuration

Set in `.env` (see [`.env.example`](.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `PAIR_ADMIN_PIN` | — | **Required.** Trust anchor for approving a pairing |
| `API_BIND` | `127.0.0.1` | Bind localhost-only until set to `0.0.0.0` for the LAN |
| `TLS_ENABLED` | off | Serve the pinned HTTPS app-link on `:8443` |
| `MTLS_REQUIRED` | off | Require the app's mutual-TLS client cert on data routes |
| `CERT_ALG` | `ec` | `ec` · `rsa` · `mldsa65` (post-quantum — needs an ML-DSA-capable client) |
| `REQUIRE_CLIENT_ID` | on | Bind a link to its device+strap id and reject replayed tokens |
| `TRUST_PROXY` | off | Set to `1` **only** behind a reverse proxy (Caddy/nginx) — trusts `X-Forwarded-For/-Proto` |
| `BODY_LIMIT_BYTES` | `524288` | Max request body size |
| `COACH_MAX_PER_MIN` / `DATA_MAX_PER_MIN` | `20` / `120` | Per-link request caps on coach and sync/BP |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | OpenAI | Any OpenAI-compatible provider (incl. local Ollama) |
| `LOG_LEVEL` | `info` | `debug` · `info` · `warn` · `error` |

`FORGOT_PASSWORD=1` (+ optional `ADMIN_RESET_PASSWORD`) resets the admin password on the next start.

## Layout

```
api-node/   Fastify API (src/*.ts, routes/) + web/ (React dashboard) + Dockerfile
firmware/   Selenium release-notes scraper + Dockerfile
docs/       architecture · plan · ideas/backlog
```

## Scope & walls

- The authenticated WHOOP firmware-service (in the app) stays the **authoritative** update check and the
  only way to actually download firmware; this scraper is the convenient **no-login** signal.
- ECG, Blood Pressure and other WHOOP-cloud-only scores are **out of scope** — noop computes the software
  ones locally; ECG/BP are hardware/regulated walls no server can cross on a WHOOP 5.0.

## License

Pairs with [noop](https://github.com/ryanbr/noop) (PolyForm Noncommercial 1.0.0). Personal, non-commercial
use — add a `LICENSE` before publishing.
