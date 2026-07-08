# One small Alpine image that BOTH scrapes and serves — nothing else to run.
# Alpine + its system Chromium/Chromedriver keeps this far smaller than Playwright's Ubuntu image,
# and Selenium (pure-Python) drives the system browser (Playwright's driver is glibc-only → no Alpine).
# Base pinned to the current-latest python-on-alpine (Python 3.13 / Alpine 3.24).
FROM python:3.13-alpine3.24

# Chromium + chromedriver from Alpine's repo (musl-built, headless-capable). Versions track the
# pinned Alpine 3.24 repo, so the image is reproducible for a given base digest.
RUN apk add --no-cache chromium chromium-chromedriver tini

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY scrape_firmware_notes.py serve.py entrypoint.sh ./
COPY firmware-latest.json /seed/firmware-latest.json
# Normalize any CRLF the script may have picked up on a Windows checkout, then mark executable.
# (We also invoke it via /bin/sh below, so a stray shebang can't cause an "exec format error".)
RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh

ENV OUT_DIR=/data \
    PORT=80 \
    SCRAPE_INTERVAL_SECONDS=43200 \
    CHROMIUM_BIN=/usr/bin/chromium-browser \
    CHROMEDRIVER=/usr/bin/chromedriver

EXPOSE 80
HEALTHCHECK --interval=1m --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:80/health').read()" || exit 1

# tini as PID 1 → reaps the background scrape loop cleanly on shutdown. Invoke via /bin/sh explicitly
# so a stray CRLF/shebang in the script can never cause an "exec format error".
ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "/app/entrypoint.sh"]
