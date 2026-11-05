"""Sitemap discovery (P2). Resolves sitemap indexes and gzip, records errors, writes JSONL.

Core ingests the JSONL (docs/ARCHITECTURE.md: the crawler never writes SQLite).
Policy: docs/SECURITY-AND-APPROVAL.md and CLAUDE.md rule 9 (robots.txt, per-host rate limit,
identifiable User-Agent, URL cap).
"""

from __future__ import annotations

import gzip
import io
import json
import os
import re
import time
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx

DEFAULT_URL_CAP = 500
MAX_URL_CAP = 10_000
MAX_DEPTH = 3
MAX_SITEMAP_BYTES = 50 * 1024 * 1024  # decompressed size limit (zip-bomb guard)
REQUEST_TIMEOUT_SECONDS = 20.0
# Per-host minimum interval. Default 1 req/s; slower is always allowed, faster needs confirmation.
MIN_INTERVAL_SECONDS = 1.0
USER_AGENT_PRODUCT = "awesome-seo-geo-aio-aeo/0.0.1"
CONTACT_ENV = "AWESOME_SEO_CONTACT_URL"
CONTACT_PLACEHOLDER = "contact-url-not-configured"
DATA_DIR_ENV = "AWESOME_SEO_DATA_DIR"

_DTD_PATTERN = re.compile(rb"<!(DOCTYPE|ENTITY)", re.IGNORECASE)


class SitemapError(Exception):
    def __init__(self, code: str, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def user_agent() -> str:
    contact = os.environ.get(CONTACT_ENV, CONTACT_PLACEHOLDER)
    return f"{USER_AGENT_PRODUCT} (+{contact})"


class Fetcher:
    """HTTP access with robots.txt checks and a per-host minimum interval."""

    def __init__(self, client: httpx.Client) -> None:
        self._client = client
        self._last_request: dict[str, float] = {}
        # origin -> parser, or None when robots.txt could not be read (fail closed).
        self._robots: dict[str, RobotFileParser | None] = {}

    def get(self, url: str, follow_redirects: bool = True) -> httpx.Response:
        host = urlsplit(url).netloc
        last = self._last_request.get(host)
        if last is not None:
            wait = MIN_INTERVAL_SECONDS - (time.monotonic() - last)
            if wait > 0:
                time.sleep(wait)
        self._last_request[host] = time.monotonic()
        return self._client.get(
            url,
            headers={"User-Agent": user_agent()},
            timeout=REQUEST_TIMEOUT_SECONDS,
            follow_redirects=follow_redirects,
        )

    def robots(self, origin: str) -> RobotFileParser | None:
        """Parsed robots.txt for an origin, or None when it could not be read (cached per run)."""
        if origin not in self._robots:
            self._robots[origin] = self._load_robots(origin)
        return self._robots[origin]

    def allowed(self, url: str) -> SitemapError | None:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        parser = self.robots(origin)
        if parser is None:
            return SitemapError("ROBOTS_UNAVAILABLE", f"robots.txt unavailable for {origin}", True)
        if not parser.can_fetch(user_agent(), url):
            return SitemapError("ROBOTS_DISALLOWED", "Disallowed by robots.txt", False)
        return None

    def _load_robots(self, origin: str) -> RobotFileParser | None:
        parser = RobotFileParser()
        try:
            resp = self.get(f"{origin}/robots.txt")
        except httpx.HTTPError:
            return None
        if 400 <= resp.status_code < 500:
            # RFC 9309: a 4xx for robots.txt means no restrictions.
            parser.parse([])
            return parser
        if resp.status_code >= 500:
            return None
        parser.parse(resp.text.splitlines())
        return parser


def _gunzip_limited(data: bytes) -> bytes:
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as handle:
            out = handle.read(MAX_SITEMAP_BYTES + 1)
    except (OSError, EOFError) as exc:
        raise SitemapError("GZIP_INVALID", f"Invalid gzip body: {exc}", False) from exc
    if len(out) > MAX_SITEMAP_BYTES:
        raise SitemapError("SIZE_LIMIT", "Decompressed sitemap exceeds size limit", False)
    return out


def _fetch_body(fetcher: Fetcher, url: str) -> bytes:
    try:
        resp = fetcher.get(url)
    except httpx.TimeoutException as exc:
        raise SitemapError("TIMEOUT", str(exc), True) from exc
    except httpx.HTTPError as exc:
        raise SitemapError("UPSTREAM_ERROR", str(exc), True) from exc
    if resp.status_code >= 400:
        raise SitemapError("HTTP_ERROR", f"HTTP {resp.status_code}", resp.status_code >= 500)
    if len(resp.content) > MAX_SITEMAP_BYTES:
        raise SitemapError("SIZE_LIMIT", "Sitemap body exceeds size limit", False)
    data = resp.content
    if data[:2] == b"\x1f\x8b" or url.endswith(".gz"):
        data = _gunzip_limited(data)
    return data


def _parse_xml(data: bytes) -> ET.Element:
    # Sitemaps never need a DTD. Refusing one blocks entity-expansion payloads.
    if _DTD_PATTERN.search(data):
        raise SitemapError("UNSUPPORTED_DTD", "DOCTYPE or ENTITY declarations are not allowed", False)
    try:
        return ET.fromstring(data)
    except ET.ParseError as exc:
        raise SitemapError("MALFORMED_XML", str(exc), False) from exc


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(root: ET.Element, name: str) -> list[dict[str, str | None]]:
    items: list[dict[str, str | None]] = []
    for el in root:
        if _local(el.tag) != name:
            continue
        item: dict[str, str | None] = {"loc": None, "lastmod": None}
        for child in el:
            key = _local(child.tag)
            if key in item:
                item[key] = (child.text or "").strip() or None
        items.append(item)
    return items


def _err(code: str, url: str, message: str, retryable: bool) -> dict[str, Any]:
    return {"code": code, "message": f"{url}: {message}", "retryable": retryable}


def resolve_output_path(output_path: str) -> Path:
    """Output must be a .jsonl file under AWESOME_SEO_DATA_DIR (default ./data)."""
    base = Path(os.environ.get(DATA_DIR_ENV, "data")).resolve()
    target = (base / output_path).resolve()
    if base not in target.parents:
        raise ValueError("output_path must stay inside the data directory")
    if target.suffix != ".jsonl":
        raise ValueError("output_path must end with .jsonl")
    return target


def discover_sitemap(
    sitemap_url: str,
    output_path: Path,
    url_cap: int = DEFAULT_URL_CAP,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    """Walk a sitemap (index or urlset), write one JSONL line per URL, return the envelope."""
    started = datetime.now(timezone.utc)
    collected_at = started.isoformat()
    run_id = f"{started.strftime('%Y-%m-%dT%H%M%SZ')}-{uuid.uuid4().hex[:4]}"
    root_host = urlsplit(sitemap_url).netloc

    owns_client = client is None
    http = client if client is not None else httpx.Client()
    errors: list[dict[str, Any]] = []
    warnings: list[str] = []
    entries: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    visited: set[str] = set()
    counters = {"sitemaps": 0, "off_host": 0, "capped": 0}
    root_ok = False

    fetcher = Fetcher(http)

    def walk(url: str, depth: int, is_root: bool) -> None:
        nonlocal root_ok
        if url in visited or counters["capped"]:
            return
        visited.add(url)
        if depth > MAX_DEPTH:
            errors.append(_err("DEPTH_EXCEEDED", url, "Sitemap index nested too deeply", False))
            return
        try:
            blocked = fetcher.allowed(url)
            if blocked is not None:
                raise blocked
            root = _parse_xml(_fetch_body(fetcher, url))
        except SitemapError as exc:
            errors.append(_err(exc.code, url, str(exc), exc.retryable))
            return

        tag = _local(root.tag)
        if tag == "sitemapindex":
            counters["sitemaps"] += 1
            if is_root:
                root_ok = True
            for item in _children(root, "sitemap"):
                if item["loc"]:
                    walk(item["loc"], depth + 1, False)
        elif tag == "urlset":
            counters["sitemaps"] += 1
            if is_root:
                root_ok = True
            for item in _children(root, "url"):
                loc = item["loc"]
                if not loc:
                    continue
                parts = urlsplit(loc)
                if parts.scheme not in ("http", "https"):
                    warnings.append(f"Skipped non-http URL in {url}")
                    continue
                if parts.netloc != root_host:
                    counters["off_host"] += 1
                    continue
                if loc in seen_urls:
                    continue
                if len(entries) >= url_cap:
                    counters["capped"] = 1
                    break
                seen_urls.add(loc)
                entries.append({"url": loc, "lastmod": item["lastmod"], "sitemap_url": url})
        else:
            errors.append(_err("NOT_A_SITEMAP", url, f"Root element <{tag}> is not a sitemap", False))

    try:
        walk(sitemap_url, 0, True)
    finally:
        if owns_client:
            http.close()

    if counters["capped"]:
        warnings.append(f"URL cap reached ({url_cap}); remaining URLs not collected")
    if counters["off_host"]:
        warnings.append(f"Skipped {counters['off_host']} URL(s) on other hosts")

    if root_ok:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as handle:
            for entry in entries:
                line = {"run_id": run_id, "collected_at": collected_at, **entry}
                handle.write(json.dumps(line, ensure_ascii=False) + "\n")

    return {
        "ok": root_ok,
        "source": "crawl",
        "collectedAt": collected_at,
        "data": {
            "runId": run_id,
            "outputPath": str(output_path) if root_ok else None,
            "urlCount": len(entries),
            "sitemapCount": counters["sitemaps"],
        },
        "warnings": warnings,
        "errors": errors,
    }
