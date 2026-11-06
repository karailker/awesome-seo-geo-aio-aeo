"""Opt-in headless render for markup that JavaScript adds after load (for example FAQPage JSON-LD).

Runs the system Chrome binary with --dump-dom. No shell is used, no package is added. Only http(s) URLs are
rendered, so file:// and other schemes never reach the browser.

Policy note: Chrome also requests the page's scripts, styles and images. Those requests are not covered by the
per-host rate limit that applies to the HTML fetch. Rendering is off by default and must be requested per call.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from urllib.parse import urlsplit

CHROME_ENV = "CHROME_PATH"
RENDER_TIMEOUT_SECONDS = 60
VIRTUAL_TIME_BUDGET_MS = 8000  # lets scripts that run after load finish before the DOM is dumped
MAX_RENDERED_BYTES = 10 * 1024 * 1024
_FALLBACK_NAMES = ("google-chrome", "chromium", "chromium-browser")


class RenderError(Exception):
    """Chrome is missing, failed, or timed out. The caller keeps the static HTML and records the error."""


def chrome_binary() -> str | None:
    configured = os.environ.get(CHROME_ENV)
    if configured:
        return configured if os.path.isfile(configured) else None
    for name in _FALLBACK_NAMES:
        found = shutil.which(name)
        if found:
            return found
    return None


def render_html(url: str, timeout: int = RENDER_TIMEOUT_SECONDS) -> str:
    """Return the DOM after scripts ran. Raises RenderError on any failure."""
    if urlsplit(url).scheme not in ("http", "https"):
        raise RenderError("only http(s) URLs are rendered")
    binary = chrome_binary()
    if binary is None:
        raise RenderError(f"Chrome not found; set {CHROME_ENV} or install google-chrome")
    cmd = [
        binary,
        "--headless=new",
        "--disable-gpu",
        f"--virtual-time-budget={VIRTUAL_TIME_BUDGET_MS}",
        "--dump-dom",
        url,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise RenderError(f"render timed out after {timeout}s") from exc
    except OSError as exc:
        raise RenderError("Chrome could not be started") from exc
    if proc.returncode != 0 or not proc.stdout:
        raise RenderError(f"Chrome exited with status {proc.returncode}")
    return proc.stdout[:MAX_RENDERED_BYTES].decode("utf-8", errors="replace")
