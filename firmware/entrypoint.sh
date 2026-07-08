#!/bin/sh
# One container, two jobs: serve firmware-latest.json (foreground) and re-scrape the release notes on
# a loop (background). Seeds /data with the bundled known-good JSON on first boot so the endpoint is
# live immediately, before the first scrape finishes. POSIX sh — Alpine has no bash.
set -eu

OUT_DIR="${OUT_DIR:-/data}"
INTERVAL="${SCRAPE_INTERVAL_SECONDS:-43200}"   # re-check every 12h by default
OUT="$OUT_DIR/firmware-latest.json"

mkdir -p "$OUT_DIR"
[ -f "$OUT" ] || { cp /seed/firmware-latest.json "$OUT"; echo "seeded $OUT"; }
# The scraper writes ./firmware-latest.json; symlink it to the shared volume so writes land there
# directly (no copy needed — a copy would be "same file" under set -eu and kill this loop).
ln -sf "$OUT" ./firmware-latest.json

# Background: scrape now, then every INTERVAL. A failed scrape keeps the last good JSON (handled in
# the scraper); the `|| true` stops set -eu from killing the loop on a transient failure.
(
  while true; do
    echo "[$(date -u +%FT%TZ)] scraping WHOOP release notes…"
    python scrape_firmware_notes.py || echo "scrape failed — keeping last good JSON"
    sleep "$INTERVAL"
  done
) &

# Foreground: the HTTP server (exec → clean signal handling as the container's main process).
exec python serve.py
