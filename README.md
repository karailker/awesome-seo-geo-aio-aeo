# Awesome SEO / GEO / AIO / AEO

A Claude Code plugin that audits one website across SEO, GEO (generative engine visibility), AIO (AI discoverability), and AEO (answer readiness). It combines sitemap discovery, a local crawl, Google Search Console, GA4, Bing Webmaster, Yandex Metrica and Webmaster, PageSpeed Insights, and CrUX. Reports are in English, and every finding cites the observations behind it.

Local-first: data stays in a SQLite file in your project folder. Write actions to search engines (sitemap submit, URL submit) need an approved proposal, and a hook blocks them until one exists.

**Status (2026-11-05):** version 0.2.0. Phases P0–P8 and P10 are done. P9 (Merchant Center) is deferred because the site sells no products. P11 (evaluation) is next. See `STATUS.md` for live checks, known gaps, and open decisions.

## Install as a Claude Code plugin

Prerequisites:
- Claude Code 2.1 or newer
- Node.js 22.18 or newer (`npx` is used to start the MCP servers and the CLI)
- [uv](https://docs.astral.sh/uv/) (starts the Python crawler)
- Google Chrome, only for the local Lighthouse fallback (set `CHROME_PATH` if it is not found automatically)

Add the marketplace and install the plugin:

```
/plugin marketplace add karailker/awesome-seo-geo-aio-aeo
/plugin install awesome-seo --marketplace karailker/awesome-seo-geo-aio-aeo
```

Or from a terminal:

```bash
claude plugin marketplace add karailker/awesome-seo-geo-aio-aeo
claude plugin install awesome-seo@awesome-seo-marketplace
```

Check it with `claude plugin list`. The first run downloads the npm packages through `npx`.

**Load from a local checkout (development):**

```bash
git clone https://github.com/karailker/awesome-seo-geo-aio-aeo.git
claude --plugin-dir /path/to/awesome-seo-geo-aio-aeo
```

## Set up a project

Run these from your project folder (the database and data directory are created there). Set the environment first (see Credentials).

```bash
npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo migrate
npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo seed --origin https://www.example.com --sitemap https://www.example.com/sitemap.xml
```

Use the origin your sitemap and search consoles use (for example `www`). Hosts are not merged.

Then, in Claude Code: `/sitemap-sync`, `/crawl-run`, `/seo-audit <origin> <start> <end>`, `/geo-audit`, `/aio-audit`, `/aeo-audit`, `/perf-audit`, `/approve-action`.

## Commands

| Command | What it does |
|---|---|
| `/sitemap-sync` | Discovers sitemap URLs and stores them |
| `/crawl-run` | Crawls discovered URLs (robots.txt on every hop, 1 request per second per host) and stores the results |
| `/seo-audit` | Search Console, GA4, Bing, Yandex, and sitemap reconciliation, with traffic and AI referral sections |
| `/geo-audit`, `/aio-audit`, `/aeo-audit` | GEO, AIO, and AEO checks: citation readiness, AI crawler access, llms.txt, structured data validation |
| `/perf-audit` | PageSpeed Insights lab values and CrUX field values, reported separately; local Lighthouse fallback |
| `/approve-action` | Reviews write proposals, runs approved ones, verifies and records them |

MCP tools (`google_*`, `yandex_*`, `bing_*`, `performance_*`, `crawl_*`) are listed in `docs/MCP.md`.

## Credentials

Keys and tokens never go into the repo, the database, or logs. Put each secret in a file outside the repo with mode 600 and load it before starting Claude Code (for example `set -a; . ~/.config/awesome-seo/bing.env; set +a`). Variable names are listed in `.env.example`.

| Source | Variables | How to get it |
|---|---|---|
| Search Console, GA4 | `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` (path to the key file) | Create a service account, enable the Search Console and GA4 Data APIs, download its JSON key, and add the service account email to the property (Search Console: Users and permissions; GA4: Property access). An OAuth client JSON does not work for this. |
| Yandex Metrica, Yandex Webmaster | `YANDEX_METRICA_TOKEN`, `YANDEX_WEBMASTER_TOKEN`, `YANDEX_METRICA_COUNTER_ID` | OAuth token from a Yandex app with the Metrica and Webmaster permissions |
| Bing Webmaster | `BING_WEBMASTER_API_KEY` | API key from Bing Webmaster Tools |
| PageSpeed Insights, CrUX | `PAGESPEED_API_KEY`, `CRUX_API_KEY` | API keys. Enable both APIs in the key's Google Cloud project and allow them in the key's restrictions. |
| Crawler identity | `AWESOME_SEO_CONTACT_URL` | A page that describes your crawler; it goes into the User-Agent |
| Storage | `AWESOME_SEO_DB` (default `data/awesome-seo.sqlite`), `AWESOME_SEO_DATA_DIR` (default `data/`) | Optional overrides |

## Command line

The CLI is published as `@karailker/awesome-seo-core` and runs with `npx`:

| Command | Purpose |
|---|---|
| `migrate`, `seed` | Database schema and the single site |
| `sitemap-ingest`, `crawl-ingest` | Store sitemap and crawl JSONL |
| `seo-audit`, `geo-audit` | Markdown reports (inputs: `--gsc`, `--ga4`, `--metrica`, `--bing`, `--yandex`, `--access`) |
| `approval list\|propose\|approve\|reject\|record` | Write approval flow |

## Development

```bash
git clone https://github.com/karailker/awesome-seo-geo-aio-aeo.git && cd awesome-seo-geo-aio-aeo
corepack pnpm install
corepack pnpm -r build        # TypeScript: core, MCP servers
corepack pnpm -r test         # Vitest
cd mcp-servers/crawl && uv sync && uv run pytest
```

Repo scripts: `pnpm db:migrate`, `pnpm db:seed`, `pnpm sitemap:ingest`, `pnpm crawl:ingest`, `pnpm seo:audit`, `pnpm geo:audit`, `pnpm approval` (they run `packages/core/dist/cli.js`).

Layout:
- `packages/core`: shared TypeScript: SQLite store (the only writer), migrations, ingest, reports, approval engine, and the `awesome-seo` CLI.
- `mcp-servers/google`, `yandex`, `bing`, `performance`: TypeScript MCP servers (npm packages `@karailker/awesome-seo-mcp-*`).
- `mcp-servers/crawl`: Python crawler (FastMCP), run with `uv`.
- `.claude-plugin/`: plugin and marketplace manifests. `.mcp.json`: MCP servers.
- `commands/`, `agents/`, `skills/`, `hooks/`: plugin content (the PreToolUse approval gate is in `hooks/`).
- `knowledge/`: reference lists (AI referrer hosts).
- `docs/`: architecture, data model, MCP tools, agents and skills, security and approval, roadmap.

## Publishing

The core and MCP packages are published under `@karailker` (version 0.1.0 for the MCP servers, 0.2.0 for core). Publish per package from its directory (`corepack pnpm publish --access public --no-git-checks`).

## Security

- Write tools (`google_gsc_submit_sitemap`, `yandex_webmaster_add_sitemap`, `bing_submit_url`) run only after the PreToolUse hook finds an approved proposal for the exact payload. The hook fails closed: a check that cannot run blocks the call.
- Analytics are aggregates only. Individual-user and session dimensions are refused.
- The crawler follows robots.txt, rate-limits per host, and identifies itself.
- Tests make no external calls.

## Documentation

- `docs/ARCHITECTURE.md`: design and decisions
- `docs/ROADMAP.md`: phases and done criteria
- `docs/MCP.md`: tool reference
- `docs/DATA-MODEL.md`: SQLite tables
- `docs/AGENTS-AND-SKILLS.md`: agents, skills, commands, status
- `docs/SECURITY-AND-APPROVAL.md`: credentials, approval flow, hook, crawler policy
- `STATUS.md`: current state, live checks, known gaps, open decisions

## License

MIT. See `LICENSE`.
