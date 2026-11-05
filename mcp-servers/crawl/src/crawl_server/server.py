"""Crawl MCP server. Exposes crawl_health, crawl_capabilities, and crawl_discover_sitemap (P2).

The crawler never writes to SQLite (docs/ARCHITECTURE.md); it writes JSONL snapshots that
packages/core ingests.
"""

import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from mcp.server.fastmcp import FastMCP

from crawl_server.sitemap import DEFAULT_URL_CAP, MAX_URL_CAP, discover_sitemap, resolve_output_path

SERVER_NAME = "crawl"
VERSION = "0.0.1"

# The crawler needs no credentials (docs/SECURITY-AND-APPROVAL.md).
CREDENTIAL_VARS: list[str] = []

TOOLS = [
    {"name": "crawl_health", "access": "read", "credentials": []},
    {"name": "crawl_capabilities", "access": "read", "credentials": []},
    {"name": "crawl_discover_sitemap", "access": "read", "credentials": []},
]

mcp = FastMCP(SERVER_NAME)


def health_payload(env: dict[str, str] | None = None) -> dict[str, Any]:
    # Health reports credential presence, never values.
    environ = os.environ if env is None else env
    return {
        "ok": True,
        "server": SERVER_NAME,
        "version": VERSION,
        "status": "running",
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "credentials": {var: bool(environ.get(var)) for var in CREDENTIAL_VARS},
    }


def capabilities_payload() -> dict[str, Any]:
    return {"ok": True, "server": SERVER_NAME, "version": VERSION, "tools": TOOLS}


@mcp.tool(name="crawl_health")
def crawl_health() -> dict[str, Any]:
    """Process status and configuration presence. Never returns secret values."""
    return health_payload()


@mcp.tool(name="crawl_capabilities")
def crawl_capabilities() -> dict[str, Any]:
    """List of tools, whether each is read or write, and credentials each requires."""
    return capabilities_payload()


def _invalid(message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "source": "crawl",
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "data": None,
        "warnings": [],
        "errors": [{"code": "INVALID_INPUT", "message": message, "retryable": False}],
    }


@mcp.tool(name="crawl_discover_sitemap")
def crawl_discover_sitemap(
    sitemap_url: str, output_path: str, url_cap: int = DEFAULT_URL_CAP
) -> dict[str, Any]:
    """Resolve a sitemap or sitemap index (gzip ok). Writes one JSONL line per URL to output_path,
    a path relative to the data directory (AWESOME_SEO_DATA_DIR, default ./data). Max 500 URLs by default.
    """
    if urlsplit(sitemap_url).scheme not in ("http", "https"):
        return _invalid("sitemap_url must be an http(s) URL")
    if not 1 <= url_cap <= MAX_URL_CAP:
        return _invalid(f"url_cap must be between 1 and {MAX_URL_CAP}")
    try:
        target = resolve_output_path(output_path)
    except ValueError as exc:
        return _invalid(str(exc))
    return discover_sitemap(sitemap_url, target, url_cap)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
