"""AI crawler access and llms.txt check (P4, crawl_check_access).

For each AI user agent, evaluates the site's robots.txt against sampled URLs. Results are
"unknown" when robots.txt cannot be read; they are never guessed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from crawl_server.sitemap import Fetcher

# VERIFY: user-agent tokens must be checked against each vendor's current crawler documentation.
AI_USER_AGENTS = [
    "GPTBot",
    "ChatGPT-User",
    "OAI-SearchBot",
    "ClaudeBot",
    "anthropic-ai",
    "PerplexityBot",
    "Google-Extended",
    "CCBot",
    "Applebot-Extended",
    "Bytespider",
]

MAX_LISTED_URLS = 20


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def _llms_txt(fetcher: Fetcher, origin: str) -> dict[str, Any]:
    try:
        resp = fetcher.get(f"{origin}/llms.txt")
    except httpx.HTTPError:
        return {"present": None, "valid": None, "status": None, "note": "request failed"}
    if resp.status_code != 200:
        return {"present": False, "valid": False, "status": resp.status_code, "note": None}
    first = next((line.strip() for line in resp.text.splitlines() if line.strip()), "")
    # llms.txt proposal: the file starts with an H1 title. VERIFY against the current spec.
    valid = first.startswith("# ")
    return {
        "present": True,
        "valid": valid,
        "status": 200,
        "note": None if valid else "first non-empty line is not an H1 title",
    }


def check_access(site_root: str, sample_urls: list[str], client: httpx.Client) -> dict[str, Any]:
    fetcher = Fetcher(client)
    origin = _origin(site_root)
    now = datetime.now(timezone.utc).isoformat()

    parser: RobotFileParser | None = fetcher.robots(origin)
    robots_state = "readable" if parser is not None else "unavailable"

    agents: list[dict[str, Any]] = []
    for agent in AI_USER_AGENTS:
        if parser is None:
            agents.append({"user_agent": agent, "allowed": None, "blocked": None, "blocked_urls": []})
            continue
        blocked_urls = [u for u in sample_urls if not parser.can_fetch(agent, u)]
        agents.append(
            {
                "user_agent": agent,
                "allowed": len(sample_urls) - len(blocked_urls),
                "blocked": len(blocked_urls),
                "blocked_urls": blocked_urls[:MAX_LISTED_URLS],
            }
        )

    return {
        "ok": True,
        "source": "crawl",
        "collectedAt": now,
        "data": {
            "siteRoot": origin,
            "robots": robots_state,
            "sampleSize": len(sample_urls),
            "agents": agents,
            "llmsTxt": _llms_txt(fetcher, origin),
        },
        "warnings": [] if robots_state == "readable" else ["robots.txt unavailable: AI crawler access is unknown"],
        "errors": [],
    }
