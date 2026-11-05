# STATUS

Date: 2026-11-05. Phase: P10 complete. Next: P11 (evaluation). P9 deferred.

## Phases

| Phase | State | What is in the repo |
|---|---|---|
| P0 Scaffold | done | Workspace, plugin manifests, stub servers, docs |
| P1 Core and SQLite | done | Drizzle schema, migrations, store (WAL, foreign keys), Zod schemas, `db:migrate`, `db:seed` |
| P2 Sitemap discovery | done | `crawl_discover_sitemap`, `sitemap:ingest`, `/sitemap-sync` |
| P3 Search Console | done | `google_gsc_*`, GSC ingest, `seo:audit`, `/seo-audit` (search part) |
| P4 Full crawler | done | `crawl_fetch_pages`, `crawl_extract_structured_data`, `crawl_check_access`, `crawl:ingest`, `/crawl-run` |
| P5 Performance | done | `performance_psi_run` (with local fallback), `performance_crux_query`, `performance_lighthouse_local_run`, `/perf-audit` |
| P6 GEO, AIO, AEO | done, two skills deferred | `geo:audit`, `/geo-audit`, `/aio-audit`, `/aeo-audit`, `visibility-analyst`; `entity-consistency` and `faq-quality` not built |
| P7 Analytics | done | GA4 tools and ingest, Metrica tool and ingest, AI referral traffic, traffic section in `seo:audit` |
| P8 Bing and Yandex Webmaster | done | Bing tools and ingest; Yandex Webmaster tools (incl. in-search samples); three-source reconciliation |
| P9 Merchant Center | deferred | Code and tests exist. The site sells no products, so no live check is planned |
| P10 Approval and write tools | done | Approval engine (migration 0003), PreToolUse gate, `approval` CLI, `/approve-action`, three write tools |
| P11 Evaluation | next | Golden dataset, evaluator (precision and recall), evidence coverage check |
| P12 Reporting and polish | not started | Scoring doc, `/connections-check`, README setup per credential |

## Tests (2026-11-05)

- core 62, google 22, yandex 18, bing 9, performance 19 (TypeScript, Vitest)
- crawler 37 (Python, pytest)
- `pnpm -r build`, `pnpm -r typecheck`, `claude plugin validate .`: pass (validate has warnings only: marketplace install advice and icon)

## Live checks done (read-only unless noted)

- Search Console: sites, sitemaps, search analytics (page and query) on `sc-domain:bulmacalig.com`.
- Search Console write: sitemap `sitemap-pages.xml` re-submitted through an approved proposal, inside a Claude Code session. Verified by `lastSubmitted`.
- GA4 property 552874034: metadata, page and session-source reports. October 2026: 619 sessions, 14 from chatgpt.com.
- Yandex Metrica counter 113337943: traffic sources, October 2026: 396 visits.
- Yandex Webmaster: hosts, summary, popular queries, in-search history, sitemaps, quota, in-search samples (30 URLs).
- Bing Webmaster: site list, rank and traffic (31 days), page stats (8 rows), URL info, quota.
- PageSpeed Insights (lab values), CrUX (field values for a high-traffic origin), local Lighthouse on `www.bulmacalig.com` (score 100).
- Crawl: sitemap discovery and crawl of 5 URLs on `www.bulmacalig.com` (5 of 5 status 200).
- Approval gate in a headless Claude Code session: unapproved call blocked; approved calls allowed.

Live writes (each approved by the user for the test):
- Google Search Console, `sitemap-pages.xml`: success, verified.
- Bing SubmitUrl, `https://www.bulmacalig.com/kare`: call succeeded; the owner sees the submission in Bing (12:42 local time); quota 99 is consistent with acceptance. `GetUrlInfo` last crawl not updated yet (crawling is later). Acceptance is not confirmed by the API.
- Yandex Webmaster add sitemap, `sitemap-pages.xml`: POST returned 405 (route closed; `OPTIONS` says `Allow: GET`). Yandex Webmaster was then read-only during a provider incident. Recorded as failure. Retry later with a new proposal.

## npm publication (2026-11-05)

Scope `@karailker`, MIT, public, version 0.1.0.

| Package | Registry state (last check) |
|---|---|
| `@karailker/awesome-seo-core` | 0.1.0 live |
| `@karailker/awesome-seo-mcp-performance` | 0.1.0 live |
| `@karailker/awesome-seo-mcp-google` | 0.1.0 live; run via `npx` from a clean directory: 11 tools |
| `@karailker/awesome-seo-mcp-bing` | 0.1.0 live; run via `npx` (`--prefer-online`): 6 tools |
| `@karailker/awesome-seo-mcp-yandex` | not on the registry; publish reports 0.1.0 as already published or staged |

Open: Yandex is not on the registry. Its publish reported 0.1.0 as already published or staged. Approve the staged version on npmjs.com or publish 0.1.1. `.mcp.json` uses `npx -y` for all four TypeScript servers, so the Yandex server does not start from npm until it is live. A fresh `npx` may hit a cached "no matching version" error; use `--prefer-online`.

## Known gaps

- Yandex write: not yet successful. Retry after the Yandex incident with a new proposal and approval.
- Bing acceptance: re-check `GetUrlInfo` `LastCrawledDate` after 2026-11-05 09:42Z.
- The first GSC execution log row (`5c772bcc`) keeps record-time values; its real submit time was 09:37:03.790Z (Search Console `lastSubmitted`).
- The execution log records the time the call ran, provided by the write tool; the `approval record` command requires those times.
- GA4 page report is one request (100 000 rows max, no paging).
- Search Console: one request per call (25 000 rows max, no paging).
- `scripts/*.ts` run through Node type stripping and are not typechecked.
- The seed origin is `https://www.bulmacalig.com`. Search Console property is `sc-domain:bulmacalig.com`. No `site_properties` mapping yet.
- Pages removed from a sitemap are not marked stale.
- Yandex per-URL data is a snapshot (in-search samples); there is no date range for it.
- Crawler `AWESOME_SEO_CONTACT_URL` is unset, so the User-Agent carries a placeholder. Set it before a larger crawl.
- Every VERIFY-marked endpoint, quota, and rule is unconfirmed against vendor documentation. See `grep -rn VERIFY`.

## Open decisions

1. Distribution of the plugin. The MCP servers need a build (`pnpm -r build`) and the crawler needs `uv sync`. Neither is in git (`dist/`, `.venv/` are ignored), so a marketplace install from git would not start the servers. Options: (a) commit build output for releases, (b) publish each MCP server to npm and reference it with `npx` in `.mcp.json`, (c) document the build step and keep local `--plugin-dir` installs. See README.
2. npm publication. Recommended only after decision 1 (b). The current packages are `private: true`. Publishing is outward-facing and needs the owner's npm account and the package scope.
3. Rotate the secrets pasted in chat during this project: Yandex client secret and tokens, Bing API key, PageSpeed and CrUX keys.

## Credentials and local files (not in the repo)

- `~/.config/awesome-seo/gsc-service-account.json` (service account key, mode 600)
- `~/.config/awesome-seo/performance.env`, `yandex.env`, `bing.env` (mode 600)
- `~/Downloads`: the OAuth client JSON (`client_secret_2_...json`) is unused and remains there.

## Toolchain

pnpm 12.16.1 (corepack), Node 24.22.0, uv (Python 3.12.14 for the crawler), Claude Code 2.1.308, Google Chrome 155 (`/usr/bin/google-chrome`). SQLite 3.53.4 (better-sqlite3 13.0.3). Crawler: selectolax 1.0.2 (lexbor), extruct 0.18.0, httpx. Performance: lighthouse 13.6.0, chrome-launcher 1.2.2.
