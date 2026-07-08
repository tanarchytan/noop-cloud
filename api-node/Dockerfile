# noop-cloud API — Fastify/Node LTS + Vite/React dashboard. Multi-stage: build the SPA, build the API
# (with native deps), then a lean runtime image serving both from one process.

# 1) Build the React dashboard → web/dist
FROM node:24-alpine AS webbuild
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2) Build the API (better-sqlite3 may compile from source on musl; these are build-only)
FROM node:24-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# 3) Runtime
FROM node:24-alpine
# openssl 3.5 CLI: mints the self-signed CA/server/client certs at runtime (ML-DSA/EC), replacing
# node-forge. Node's bundled OpenSSL is a library, not the CLI, so the apk is needed for cert-gen.
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=webbuild /web/dist ./web/dist
ENV NODE_ENV=production \
    PORT=80 \
    DB_PATH=/data/pairing.db \
    PAIR_CODE_TTL_SECONDS=300 \
    PAIR_POLL_INTERVAL_SECONDS=3
EXPOSE 80 443
HEALTHCHECK --interval=1m --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
