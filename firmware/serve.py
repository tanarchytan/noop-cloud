#!/usr/bin/env python3
"""
Tiny stdlib HTTP server for the firmware update-check — no nginx, no framework, so the whole cloud
is one small image. Serves the scraper's output at /firmware/latest.json (CORS-open, it's public
non-sensitive data) plus /health. Port from $PORT (default 80).
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(os.environ.get("OUT_DIR", "/data")) / "firmware-latest.json"
PORT = int(os.environ.get("PORT", "80"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=1800")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/firmware/latest.json", "/firmware/latest"):
            if DATA.exists():
                self._send(200, DATA.read_bytes(), "application/json")
            else:
                self._send(503, b'{"ok":false,"error":"not scraped yet"}\n', "application/json")
        elif self.path.rstrip("/") == "/health":
            self._send(200, b"ok\n", "text/plain")
        elif self.path.rstrip("/") in ("", "/"):
            self._send(200, b"noop-cloud firmware update-check. GET /firmware/latest.json\n", "text/plain")
        else:
            self._send(404, b'{"error":"not found"}\n', "application/json")

    def log_message(self, *_a) -> None:  # keep logs quiet
        pass


if __name__ == "__main__":
    print(f"serving {DATA} on :{PORT}/firmware/latest.json", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
