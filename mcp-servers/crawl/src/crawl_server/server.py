"""Crawl MCP server: crawl_health, crawl_capabilities, crawl_discover_sitemap (P2),
crawl_fetch_pages, crawl_extract_structured_data, crawl_check_access (P4). All read-only.

The crawler never writes to SQLite (docs/ARCHITECTURE.md); it writes JSONL snapshots that
packages/core ingests.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from mcp.server.fastmcp import FastMCP

from crawl_server.access import check_access
from crawl_server.fetch import crawl_pages, fetch_single
from crawl_server.sitemap import DATA_DIR_ENV, DEFAULT_URL_CAP, MAX_URL_CAP, discover_sitemap, resolve_output_path

SERVER_NAME = "crawl"
VERSION = "0.0.1"

# The crawler needs no credentials (docs/SECURITY-AND-APPROVAL.md).
CREDENTIAL_VARS: list[str] = []

TOOLS = [
    {"name": "crawl_health", "access": "read", "credentials": []},
    {"name": "crawl_capabilities", "access": "read", "credentials": []},
    {"name": "crawl_discover_sitemap", "access": "read", "credentials": []},
    {"name": "crawl_fetch_pages", "access": "read", "credentials": []},
    {"name": "crawl_extract_structured_data", "access": "read", "credentials": []},
    {"name": "crawl_check_access", "access": "read", "credentials": []},
]

MAX_SAMPLE_URLS = 200

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


def _read_urls(input_path: str, url_cap: int) -> list[str]:
    """URLs from a JSONL file of discovery records (field `url`), under the data directory."""
    source = resolve_output_path(input_path)
    seen: list[str] = []
    for line in source.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        url = json.loads(line).get("url")
        if isinstance(url, str) and urlsplit(url).scheme in ("http", "https") and url not in seen:
            seen.append(url)
        if len(seen) >= url_cap:
            break
    return seen


@mcp.tool(name="crawl_fetch_pages")
def crawl_fetch_pages(
    input_path: str,
    output_path: str,
    url_cap: int = DEFAULT_URL_CAP,
    store_raw_html: bool = False,
    render: bool = False,
) -> dict[str, Any]:
    """Fetch the URLs in a discovery JSONL (field `url`), one at a time. Follows and records redirects;
    checks robots.txt at every hop; 1 request per second per host; identifiable User-Agent.
    Writes one record per URL to output_path. Raw HTML is stored gzipped only if store_raw_html is true.
    Both paths are relative to the data directory. render=true loads each page in headless Chrome so
    JavaScript-added markup (for example FAQPage JSON-LD) is extracted; Chrome also fetches the page's
    scripts and styles, which the per-host rate limit does not cover. Requires Chrome (CHROME_PATH).
    """
    if not 1 <= url_cap <= MAX_URL_CAP:
        return _invalid(f"url_cap must be between 1 and {MAX_URL_CAP}")
    try:
        source_urls = _read_urls(input_path, url_cap)
        target = resolve_output_path(output_path)
    except (ValueError, OSError) as exc:
        return _invalid(str(exc))
    if not source_urls:
        return _invalid("input_path has no http(s) URLs")
    data_dir = Path(os.environ.get(DATA_DIR_ENV, "data")).resolve()
    with httpx.Client() as client:
        return crawl_pages(source_urls, target, data_dir, client, want_raw=store_raw_html, render=render)


@mcp.tool(name="crawl_extract_structured_data")
def crawl_extract_structured_data(url: str, render: bool = False) -> dict[str, Any]:
    """Fetch one URL (robots.txt checked) and return its extracted fields and structured data
    (JSON-LD, microdata, RDFa). Nothing is written. render=true extracts the DOM after JavaScript ran.
    """
    if urlsplit(url).scheme not in ("http", "https"):
        return _invalid("url must be an http(s) URL")
    with httpx.Client() as client:
        record = fetch_single(url, client, render=render)
    return {
        "ok": not record["errors"],
        "source": "crawl",
        "collectedAt": record["fetched_at"],
        "data": record,
        "warnings": [],
        "errors": record["errors"],
    }


@mcp.tool(name="crawl_check_access")
def crawl_check_access(site_root: str, sample_urls: list[str]) -> dict[str, Any]:
    """robots.txt rules for AI crawler user agents against sample URLs, plus llms.txt status.
    Reports 'unknown' (null) when robots.txt cannot be read.
    """
    if urlsplit(site_root).scheme not in ("http", "https"):
        return _invalid("site_root must be an http(s) URL")
    if not 1 <= len(sample_urls) <= MAX_SAMPLE_URLS:
        return _invalid(f"sample_urls must have 1 to {MAX_SAMPLE_URLS} entries")
    if any(urlsplit(u).scheme not in ("http", "https") for u in sample_urls):
        return _invalid("every sample URL must be http(s)")
    with httpx.Client() as client:
        return check_access(site_root, sample_urls, client)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
