# Awesome SEO / GEO / AIO / AEO

A local Claude Code plugin that audits one website across SEO, GEO (generative engine
visibility), AIO (AI discoverability), and AEO (answer readiness). Local-first,
sitemap-driven, evidence-backed reports in English.

Status: **P0 scaffold** - all MCP servers are stubs exposing only `<prefix>_health`
and `<prefix>_capabilities`. See `docs/ROADMAP.md` for phases.

Design docs: `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/MCP.md`,
`docs/AGENTS-AND-SKILLS.md`, `docs/SECURITY-AND-APPROVAL.md`, `docs/ROADMAP.md`.

## Setup

```bash
pnpm install                          # TypeScript workspace (core + 4 MCP servers)
cd mcp-servers/crawl && uv sync       # Python crawler MCP server
pnpm -r build                         # compile TypeScript
pnpm -r test                          # Vitest
cd mcp-servers/crawl && uv run pytest # pytest
```

Credentials: copy `.env.example` to `.env` (git-ignored, dev-only) or use the OS
keychain. Key files must live outside the repo. Stub servers run without any
credentials; P1+ phases add site configuration.

## Load the plugin

```bash
claude plugin validate .   # manifest check
claude --plugin-dir .      # load (Claude Code 2.1.308)
```

Plugin MCP tools appear as `mcp__plugin_awesome-seo_<server>__<tool>`. On slow
filesystems (WSL `/mnt/d`) server startup takes ~8s and can exceed the default MCP
startup timeout; `.claude/settings.json` raises it via `MCP_TIMEOUT=30000`.

## Layout

- `packages/core` - shared types, (P1+) SQLite store, approval engine
- `mcp-servers/{google,yandex,bing,performance}` - TypeScript MCP servers
- `mcp-servers/crawl` - Python (FastMCP) crawler
- `.claude-plugin/plugin.json`, `.mcp.json` - plugin and MCP manifests
