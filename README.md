# Awesome SEO / GEO / AIO / AEO

A local Claude Code plugin that audits one website across SEO, GEO (generative engine visibility), AIO (AI discoverability), and AEO (answer readiness). It combines sitemap discovery, a local crawl, Google Search Console, GA4, Bing Webmaster, Yandex Metrica and Webmaster, PageSpeed Insights, and CrUX. Reports are in English, and every finding cites the observations behind it.

Local-first: data stays in a SQLite file on your machine. Write actions to search engines (sitemap submit, URL submit) need an approved proposal and are blocked by a hook until one exists.

## Status

Phases P0 to P8 and P10 are done. P9 (Merchant Center) is deferred because the site sells no products. The current phase is P11 (evaluation). All four TypeScript MCP servers and the shared core are live on npm at 0.1.0. See `STATUS.md` for live checks, known gaps, and open decisions, and `docs/ROADMAP.md` for the plan.

## What you get

| Command | What it does |
|---|---|
| `/sitemap-sync` | Discovers sitemap URLs and stores them |
| `/crawl-run` | Crawls discovered URLs (robots.txt on every hop, 1 request per second per host) and stores the results |
| `/seo-audit` | Search Console, GA4, Bing, Yandex, and sitemap reconciliation with traffic and AI referral sections |
| `/geo-audit`, `/aio-audit`, `/aeo-audit` | GEO, AIO, and AEO checks: citation readiness, AI crawler access, llms.txt, structured data validation |
| `/perf-audit` | PageSpeed Insights lab values and CrUX field values, reported separately; local Lighthouse fallback |
| `/approve-action` | Reviews write proposals and runs approved ones after verifying and recording them |

MCP tools (`google_*`, `yandex_*`, `bing_*`, `performance_*`, `crawl_*`) are listed in `docs/MCP.md`.

## Requirements

- Node 22.18 or newer (Node 24 is what the project uses), with pnpm available through `corepack`.
- Python 3.12 and [uv](https://docs.astral.sh/uv/) for the crawler.
- Claude Code 2.1 or newer.
- Google Chrome, only for the local Lighthouse fallback (`CHROME_PATH` if it is not found automatically).

## Install and build

```bash
git clone https://github.com/karailker/awesome-seo-geo-aio-aeo.git
cd awesome-seo-geo-aio-aeo
corepack pnpm install          # TypeScript workspace
corepack pnpm -r build         # compiles the MCP servers and core
cd mcp-servers/crawl && uv sync && cd ../..
```

Run the tests with `corepack pnpm -r test` and `cd mcp-servers/crawl && uv run pytest`.

## MCP servers on npm

All five packages are published under the `@karailker` scope at version 0.1.0 (MIT):

| Package | Tools | What it wraps |
|---|---|---|
| `@karailker/awesome-seo-mcp-google` | 11 | Search Console, GA4 (Merchant Center code is present, deferred) |
| `@karailker/awesome-seo-mcp-yandex` | 9 | Yandex Metrica, Yandex Webmaster |
| `@karailker/awesome-seo-mcp-bing` | 6 | Bing Webmaster |
| `@karailker/awesome-seo-mcp-performance` | 5 | PageSpeed Insights, CrUX, local Lighthouse |
| `@karailker/awesome-seo-core` | library | shared store, ingest, reports, approval engine |

`.mcp.json` starts the four TypeScript servers with `npx -y <package>`, so they need no local build. If a fresh install reports "No matching version found" right after publishing, retry with `npx -y --prefer-online <package>@0.1.0`.

Still from the repo checkout: the Python crawler (`mcp-servers/crawl`, run with `uv`), the commands, the hooks, and the `scripts/` CLIs.

## Load the plugin in Claude Code

**Development (from the repo):**

```bash
claude --plugin-dir /path/to/awesome-seo-geo-aio-aeo
```

Inside Claude Code, the plugin's commands appear as `/seo-audit`, `/crawl-run`, and so on. The MCP servers start from `dist/` and the crawler from `mcp-servers/crawl`, so run the build steps above first.

**Check the manifest:**

```bash
claude plugin validate /path/to/awesome-seo-geo-aio-aeo
```

**Persistent install (marketplace):** Claude Code installs plugins from marketplaces:

```bash
claude plugin marketplace add <source>      # a path, URL, or GitHub owner/repo that has a marketplace manifest
claude plugin install awesome-seo@<marketplace-name>
```

No marketplace manifest is published yet. Until it is, use `--plugin-dir`.

## Credentials

Keys and tokens are never stored in the repo, the database, or logs. Each source reads a file outside the repo (mode 600) or an environment variable. Only variable names appear in `.env.example`.

| Source | Where | Variables |
|---|---|---|
| Search Console, GA4 | service account key file, outside the repo | `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`; grant the service account email access to the property |
| Yandex Metrica, Yandex Webmaster | OAuth token from a registered Yandex app | `YANDEX_METRICA_TOKEN`, `YANDEX_WEBMASTER_TOKEN`, `YANDEX_METRICA_COUNTER_ID` |
| Bing Webmaster | API key | `BING_WEBMASTER_API_KEY` |
| PageSpeed Insights, CrUX | API keys (the APIs must be enabled in the key's project and allowed by the key's restrictions) | `PAGESPEED_API_KEY`, `CRUX_API_KEY` |
| Crawler User-Agent | contact page for the crawler | `AWESOME_SEO_CONTACT_URL` |
| Storage | SQLite file and data directory | `AWESOME_SEO_DB` (default `data/awesome-seo.sqlite`), `AWESOME_SEO_DATA_DIR` (default `data/`) |

Example: store the Bing key in `~/.config/awesome-seo/bing.env` with `chmod 600`, then load it before starting Claude Code with `set -a; . ~/.config/awesome-seo/bing.env; set +a`. The same pattern works for the other env files.

Search Console setup: create a service account in a Google Cloud project, enable the Search Console API, download its JSON key, and add the service account email under Users and permissions for the property. The OAuth client JSON (`installed` or `web`) does not work for this flow.

## Site setup

```bash
corepack pnpm db:migrate
corepack pnpm db:seed --origin https://www.example.com --sitemap https://www.example.com/sitemap.xml
```

Use the origin your sitemap and search consoles use, for example `www`. Hosts are not merged.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm db:migrate`, `pnpm db:seed` | Database schema and the single site |
| `pnpm sitemap:ingest --origin <o> <file>` | Sitemap JSONL into `pages` |
| `pnpm crawl:ingest --origin <o> <file>` | Crawl JSONL into crawl runs and results |
| `pnpm seo:audit --origin <o> --start <d> --end <d> [--gsc f] [--ga4 f] [--metrica f] [--bing f] [--yandex f]` | SEO audit Markdown report |
| `pnpm geo:audit --origin <o> [--run <id>] [--access f]` | GEO, AIO, AEO Markdown report |
| `pnpm approval list\|propose\|approve\|reject\|record` | Write approval flow |

## Project layout

- `packages/core`: shared TypeScript. SQLite store (the only writer), Drizzle schema, migrations, ingest, approval engine, reports.
- `mcp-servers/google`, `yandex`, `bing`, `performance`: TypeScript MCP servers.
- `mcp-servers/crawl`: Python crawler (FastMCP).
- `commands/`, `agents/`, `skills/`: Claude Code plugin content.
- `hooks/`: PreToolUse approval gate for write tools.
- `scripts/`: CLI entry points.
- `knowledge/`: reference lists (AI referrer hosts).
- `docs/`: architecture, data model, MCP tools, agents and skills, security and approval, roadmap.

## Documentation

- `docs/ARCHITECTURE.md`: design, components, data flow, key decisions
- `docs/ROADMAP.md`: phases and done criteria
- `docs/MCP.md`: tool reference
- `docs/DATA-MODEL.md`: SQLite tables
- `docs/AGENTS-AND-SKILLS.md`: agents, skills, commands, and their status
- `docs/SECURITY-AND-APPROVAL.md`: credentials, approval flow, hook, crawler policy
- `STATUS.md`: current state, live checks, known gaps, open decisions

## Security

- Write tools (`google_gsc_submit_sitemap`, `yandex_webmaster_add_sitemap`, `bing_submit_url`) run only after the PreToolUse hook finds an approved proposal for the exact payload. The hook fails closed.
- Analytics are aggregates only. Individual-user dimensions are refused.
- The crawler follows robots.txt, rate-limits per host, and identifies itself.
- Tests make no external calls. Fixtures are recorded or marked as hand-written.

## License

MIT. See `LICENSE`.
