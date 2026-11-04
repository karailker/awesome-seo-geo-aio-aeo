# Architecture

## Purpose

A local Claude Code plugin that audits one website across SEO, GEO (generative engine visibility), AIO (AI discoverability), and AEO (answer readiness). It combines data from search engine and analytics APIs, performance measurements, and a local crawl of the sitemap. It produces evidence-backed reports in English.

## Design principles

1. Local-first. Runs on the user's machine with local storage.
2. Read-only by default. External writes go through an approval flow.
3. Evidence-driven. Every finding links to observations.
4. Provider-independent. No logic depends on a single API provider.
5. Modular. Each data source is an independent MCP server; shared logic is in `core`.

## Components

| Component | Language | Responsibility |
|---|---|---|
| `packages/core` | TypeScript | Domain types, SQLite store (single writer), normalization, scoring, evidence, approval engine, JSONL ingest |
| `mcp-servers/google` | TypeScript | Search Console, GA4, Merchant Center tools |
| `mcp-servers/yandex` | TypeScript | Yandex Webmaster and Yandex Metrica tools |
| `mcp-servers/bing` | TypeScript | Bing Webmaster tools |
| `mcp-servers/performance` | TypeScript | PageSpeed Insights (primary), local Lighthouse (fallback), CrUX |
| `mcp-servers/crawl` | Python (FastMCP) | Sitemap discovery, page fetching, structured data extraction, AI crawler access checks, llms.txt check |
| `agents/` | Markdown | Agent definitions (orchestrator and domain analysts) |
| `skills/` | Markdown + assets | Methodology packages loaded by agents |
| `commands/` | Markdown | User-invoked entry points (`/seo-audit`, `/crawl-run`, ...) |
| `hooks/` | JSON + Bash | Pre-tool-use checks for write tools |

## Data flow

```
sitemap.xml ──► crawl MCP ──► JSONL snapshots ──► core ingest ──┐
                                                                 ▼
GSC / GA4 / Bing / Yandex / Merchant ──► MCP tools ──► core ──► SQLite (WAL)
                                                                 ▲
PSI (primary) / local Lighthouse (fallback) ──► performance MCP ─┘
                                                                 │
                                              agents + skills ◄──┘
                                                 │
                                    evidence-auditor ──► report (English)
```

## Single-site, sitemap-driven scope

- One row in `sites`, but every table keeps `site_id` so multi-site can be added later.
- The URL universe comes from the sitemap (recursively resolving sitemap indexes). Search console and other sources are reconciled against it.
- Crawl and performance analyses run on sitemap URLs, capped by a configurable limit (default 500).

## Agent model

- `seo-orchestrator` plans, selects the needed domain agents, runs independent work in parallel, and synthesizes.
- Domain agents do not message each other. Intermediate results are stored via `core` and returned to the orchestrator.
- `evidence-auditor` runs last and checks evidence coverage and consistency before the report is written.

## Language split

- TypeScript: MCP servers that wrap official SDKs, `core`, scripts.
- Python: crawler, because HTML extraction and structured-data parsing are simpler there.
- Boundary: the crawler writes JSONL files; `core` owns the database.

## Key decisions

| ID | Decision | Reason |
|---|---|---|
| D1 | Claude Code plugin with per-source MCP servers | Independent auth, quotas, and failure domains |
| D2 | SQLite with a single writer (`core`) | Local-first, simple backups, no concurrent-write races |
| D3 | Read-only default, approval for writes | Human control over external changes |
| D4 | PSI API primary for Lighthouse, local as fallback | Consistent results without local Chrome; fallback for outages and quotas |
| D5 | Local crawler in Python | Faster iteration on HTML and structured data extraction |
| D6 | GEO/AIO/AEO from crawl and search/analytics data in v1 | No AI platform prompt-testing API in v1 scope; prompt-based measurement deferred |
| D7 | English outputs | Project language; user may converse in another language |

## Deferred (not in v1)

- Prompt-based AI visibility measurement (ChatGPT, Gemini, Perplexity)
- JavaScript rendering in the crawler (Playwright)
- Multi-site management
- Scheduled monitoring and alerts
- Dashboard app