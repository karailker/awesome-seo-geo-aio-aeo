"""Page fetching for crawl runs (P4): robots.txt per hop, per-host rate limit, redirect chain,
retry on 5xx and timeouts, HTML extraction, JSONL output (docs/MCP.md crawl record).

Policy: docs/SECURITY-AND-APPROVAL.md. Raw HTML storage is off by default and pruned after 30 days.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from crawl_server.extract import extract_page
from crawl_server.sitemap import Fetcher

MAX_REDIRECTS = 5
RETRY_ATTEMPTS = 2  # retries after the first attempt, for 5xx and transport timeouts
RETRY_BACKOFF_SECONDS = (2.0, 4.0)
MAX_HTML_BYTES = 10 * 1024 * 1024
REDIRECT_STATUSES = {301, 302, 303, 307, 308}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _request(fetcher: Fetcher, url: str) -> httpx.Response:
    """One hop with retries on transport errors and 5xx. Redirects are not followed here."""
    for attempt in range(RETRY_ATTEMPTS + 1):
        last = attempt == RETRY_ATTEMPTS
        try:
            resp = fetcher.get(url, follow_redirects=False)
        except httpx.HTTPError:
            if last:
                raise
        else:
            if resp.status_code < 500 or last:
                return resp
        time.sleep(RETRY_BACKOFF_SECONDS[attempt])
    raise AssertionError("unreachable")


def fetch_page(fetcher: Fetcher, url: str, want_raw: bool = False) -> dict[str, Any]:
    """Fetch one URL with its redirect chain and extract its fields. Never raises for page errors."""
    record: dict[str, Any] = {
        "url": url,
        "fetched_at": _now(),
        "status": None,
        "final_url": None,
        "redirect_chain": [],
        "content_type": None,
        "title": None,
        "meta_description": None,
        "canonical": None,
        "lang": None,
        "hreflang": [],
        "headings": [],
        "word_count": None,
        "content_hash": None,
        "structured_data": [],
        "robots_allowed": True,
        "raw_html_path": None,
        "errors": [],
    }
    current = url
    resp: httpx.Response | None = None
    for _hop in range(MAX_REDIRECTS + 1):
        blocked = fetcher.allowed(current)
        if blocked is not None:
            # False = disallowed; None = robots.txt unreadable, so unknown (never guessed).
            record["robots_allowed"] = False if blocked.code == "ROBOTS_DISALLOWED" else None
            record["final_url"] = current
            record["errors"].append({"code": blocked.code, "message": str(blocked), "retryable": blocked.retryable})
            return record
        try:
            resp = _request(fetcher, current)
        except httpx.TimeoutException:
            record["final_url"] = current
            record["errors"].append({"code": "TIMEOUT", "message": "Request timed out", "retryable": True})
            return record
        except httpx.HTTPError:
            record["final_url"] = current
            record["errors"].append({"code": "UPSTREAM_ERROR", "message": "Request failed", "retryable": True})
            return record
        if resp.status_code in REDIRECT_STATUSES and resp.headers.get("location"):
            target = urljoin(current, resp.headers["location"])
            record["redirect_chain"].append({"from": current, "status": resp.status_code, "to": target})
            current = target
            continue
        break
    else:
        record["final_url"] = current
        record["errors"].append({"code": "TOO_MANY_REDIRECTS", "message": f"More than {MAX_REDIRECTS} hops", "retryable": False})
        return record

    assert resp is not None
    record["status"] = resp.status_code
    record["final_url"] = current
    record["content_type"] = resp.headers.get("content-type")

    if resp.status_code >= 400:
        code = "NOT_FOUND" if resp.status_code == 404 else "HTTP_ERROR"
        record["errors"].append({"code": code, "message": f"HTTP {resp.status_code}", "retryable": resp.status_code >= 500})
        return record

    content_type = (record["content_type"] or "").lower()
    if "html" not in content_type:
        record["errors"].append({"code": "NOT_HTML", "message": "Response is not HTML; no extraction", "retryable": False})
        return record

    body = resp.content[:MAX_HTML_BYTES]
    html = body.decode(resp.encoding or "utf-8", errors="replace")
    try:
        fields = extract_page(html, current)
    except Exception:  # extraction must not abort the run; the error code is enough for the report
        record["errors"].append({"code": "EXTRACT_FAILED", "message": "HTML extraction failed", "retryable": False})
        return record
    record.update(fields)
    record["_html"] = html if want_raw else None
    return record


def _store_raw(record: dict[str, Any], run_id: str, data_dir: Path) -> None:
    html = record.pop("_html", None)
    if not html:
        return
    digest = hashlib.sha256(html.encode("utf-8")).hexdigest()
    target = data_dir / "raw" / run_id / f"{digest}.html.gz"
    target.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(target, "wt", encoding="utf-8") as handle:
        handle.write(html)
    record["raw_html_path"] = str(target)


def crawl_pages(
    urls: list[str],
    output_path: Path,
    data_dir: Path,
    client: httpx.Client,
    want_raw: bool = False,
) -> dict[str, Any]:
    """Fetch URLs in order, write one JSONL record per URL, return the ToolResult envelope."""
    started = _now()
    run_id = f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H%M%SZ')}-{uuid.uuid4().hex[:4]}"
    fetcher = Fetcher(client)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    counts = {"ok": 0, "robots_blocked": 0, "errors": 0}
    with output_path.open("w", encoding="utf-8") as handle:
        for url in urls:
            record = fetch_page(fetcher, url, want_raw=want_raw)
            _store_raw(record, run_id, data_dir)
            record = {"run_id": run_id, **record}
            if any(e["code"] == "ROBOTS_DISALLOWED" for e in record["errors"]):
                counts["robots_blocked"] += 1
            elif record["errors"]:
                counts["errors"] += 1
            else:
                counts["ok"] += 1
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    status = "completed" if counts["errors"] == 0 and counts["robots_blocked"] == 0 else "partial"
    return {
        "ok": True,
        "source": "crawl",
        "collectedAt": started,
        "data": {
            "runId": run_id,
            "outputPath": str(output_path),
            "urlCount": len(urls),
            "status": status,
            **counts,
        },
        "warnings": [],
        "errors": [],
    }


def fetch_single(url: str, client: httpx.Client) -> dict[str, Any]:
    """On-demand fetch and extraction of one URL. Nothing is written."""
    record = fetch_page(Fetcher(client), url)
    record.pop("_html", None)
    return record

