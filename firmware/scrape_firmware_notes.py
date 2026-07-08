#!/usr/bin/env python3
"""
Scrape WHOOP's public firmware release-notes pages for the latest firmware version per device,
and write firmware-latest.json.

WHY A HEADLESS BROWSER: the release-notes pages are Salesforce Lightning/Aura JavaScript apps — the
version numbers are injected via XHR AFTER the page's JS runs, so a plain HTTP GET returns zero
versions. Selenium drives Alpine's system Chromium (headless) to run that JS, then reads the rendered
DOM. This runs server-side and publishes a tiny JSON the app fetches with a normal GET — no login,
no browser on the client.

Selenium (not Playwright) because Playwright's bundled driver is glibc-linked and won't run on musl
Alpine; Selenium is pure-Python and talks to Alpine's system chromedriver over HTTP.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# device_key -> (release-notes URL, version prefix that identifies this device's firmware, label)
SOURCES = {
    "maverick": (
        "https://support.whoop.com/s/article/WHOOP-5-0-MG-Firmware-Release-Notes?language=en_US",
        "50",  # WHOOP 5.0 / MG firmware is 50.x.x.x (AMBIQ main MCU)
        "WHOOP 5.0 / MG",
    ),
    "harvard": (
        "https://support.whoop.com/s/article/WHOOP-4-0-Firmware-Release-Notes?language=en_US",
        "41",  # WHOOP 4.0 firmware is 41.x.x.x (MAXIM main MCU)
        "WHOOP 4.0",
    ),
}

VERSION_RE = re.compile(r"\b(\d{2}\.\d+\.\d+\.\d+)\b")
OUT = Path(__file__).with_name("firmware-latest.json")
RENDER_WAIT_S = float(os.environ.get("RENDER_WAIT_SECONDS", "5"))


def _version_key(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in v.split("."))


def _latest_for(text: str, prefix: str) -> str | None:
    """Highest NN.N.N.N version in the page text whose major matches the device prefix."""
    versions = [m for m in VERSION_RE.findall(text) if m.split(".")[0] == prefix]
    return max(versions, key=_version_key) if versions else None


def _new_driver():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service

    opts = Options()
    opts.binary_location = os.environ.get("CHROMIUM_BIN", "/usr/bin/chromium-browser")
    for a in (
        "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
        "--window-size=1280,2000",
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ):
        opts.add_argument(a)
    service = Service(os.environ.get("CHROMEDRIVER", "/usr/bin/chromedriver"))
    return webdriver.Chrome(service=service, options=opts)


def scrape() -> dict:
    result: dict = {"scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")}
    ok = True
    driver = _new_driver()
    try:
        driver.set_page_load_timeout(45)
        for key, (url, prefix, label) in SOURCES.items():
            try:
                driver.get(url)
                time.sleep(RENDER_WAIT_S)  # let the Aura article body render
                body = driver.find_element("tag name", "body").text
                ver = _latest_for(body, prefix)
                if ver:
                    result[key] = {"version": ver, "label": label, "notes_url": url}
                else:
                    ok = False
                    result[key] = {"version": None, "label": label, "notes_url": url,
                                   "error": "no version found in rendered page"}
            except Exception as e:  # noqa: BLE001 — record, keep going for the other device
                ok = False
                result[key] = {"version": None, "label": label, "notes_url": url, "error": str(e)[:200]}
    finally:
        driver.quit()
    result["ok"] = ok
    return result


def main() -> int:
    try:
        data = scrape()
    except Exception as e:  # noqa: BLE001
        print(f"scrape failed: {e}", file=sys.stderr)
        return 1
    # Never clobber a good JSON with an all-null run: keep the last known good version per device.
    if OUT.exists() and not data.get("ok"):
        try:
            prev = json.loads(OUT.read_text())
            for key in SOURCES:
                if not data.get(key, {}).get("version") and prev.get(key, {}).get("version"):
                    data[key] = prev[key]
        except Exception:  # noqa: BLE001
            pass
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print(json.dumps(data, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
