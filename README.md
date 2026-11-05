# Awesome SEO / GEO / AIO / AEO

A local Claude Code plugin that audits one website across SEO, GEO (generative engine
visibility), AIO (AI discoverability), and AEO (answer readiness). Local-first,
sitemap-driven, evidence-backed reports in English.

Status: **P4 full crawler** - SQLite store, sitemap discovery, Search Console tools,
`/seo-audit` (search-only), and the crawler (`/crawl-run`: fetch, extraction, AI access check)
are in place. The Yandex, Bing, and performance servers are still stubs exposing only
`<prefix>_health` and `<prefix>_capabilities`. See `docs/ROADMAP.md` for phases.

Design docs: `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/MCP.md`,
`docs/AGENTS-AND-SKILLS.md`, `docs/SECURITY-AND-APPROVAL.md`, `docs/ROADMAP.md`.

## Setup

```bash
pnpm install                          # TypeScript workspace (core + 4 MCP servers)
cd mcp-servers/crawl && uv sync       # Python crawler MCP server
pnpm -r build                         # compile TypeScript
pnpm -r test                          # Vitest
cd mcp-servers/crawl && uv run pytest # pytest
pnpm db:migrate                       # create/upgrade data/awesome-seo.sqlite
pnpm db:seed --origin https://example.com [--sitemap URL] [--url-cap 500]
pnpm sitemap:ingest --origin https://example.com data/snapshots/<run>.jsonl
pnpm crawl:ingest --origin https://example.com data/crawl/<run>.jsonl
```

In Claude Code, `/crawl-run` fetches the discovered URLs (robots.txt checked at every hop,
one request per second per host, identifiable User-Agent). A 500-URL run takes about 10
minutes. The crawler uses `selectolax` and `extruct` (Python, in `mcp-servers/crawl`).

In Claude Code, `/sitemap-sync` runs discovery through the crawl MCP and ingests the result.

The database path can be overridden with `AWESOME_SEO_DB`. Crawl output goes under
`AWESOME_SEO_DATA_DIR` (default `./data`). Set `AWESOME_SEO_CONTACT_URL` to a page that
describes the crawler; it goes into the User-Agent. The scripts run `.ts` files
directly, which needs Node 22.18+ or 24 (type stripping).

Credentials: copy `.env.example` to `.env` (git-ignored, dev-only) or use the OS
keychain. Key files must live outside the repo. Health tools run without credentials.

### Search Console setup (P3)

1. Create a service account in a Google Cloud project and enable the Search Console API.
2. Download its JSON key and store it outside the repo, for example `~/.config/awesome-seo/gsc-service-account.json` with mode 600.
3. In Search Console, open the property and add the service account email under Users and permissions. Full access is used for now.
4. Export `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` to that path before starting Claude Code.
5. Run `/seo-audit <origin> <start> <end>` in Claude Code, or `pnpm seo:audit` with JSONL files from `google_gsc_search_analytics`.

The OAuth client JSON (`installed` or `web`) does not work for this flow. Use a service account key.

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
