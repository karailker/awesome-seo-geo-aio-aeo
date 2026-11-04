"""Stub crawl MCP server (P0). Exposes only crawl_health and crawl_capabilities.

The crawler never writes to SQLite (docs/ARCHITECTURE.md); later phases write JSONL
snapshots that packages/core ingests.
"""

import os
from datetime import datetime, timezone
from typing import Any

from mcp.server.fastmcp import FastMCP

SERVER_NAME = "crawl"
VERSION = "0.0.1"

# The crawler needs no credentials (docs/SECURITY-AND-APPROVAL.md).
CREDENTIAL_VARS: list[str] = []

TOOLS = [
    {"name": "crawl_health", "access": "read", "credentials": []},
    {"name": "crawl_capabilities", "access": "read", "credentials": []},
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


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
