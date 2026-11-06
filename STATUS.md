# STATUS

Date: 2026-11-06. Phase: P10 complete. Next: P11 (evaluation). P9 deferred. Plugin 0.2.0 is distributed through the marketplace (`awesome-seo-marketplace`) and npm.

## Phases

| Phase | State | What is in the repo |
|---|---|---|
| P0 Scaffold | done | Workspace, plugin manifests, docs |
| P1 Core and SQLite | done | Drizzle schema, migrations 0000–0003, store (WAL, foreign keys), Zod schemas, `awesome-seo migrate`, `seed` |
| P2 Sitemap discovery | done | `crawl_discover_sitemap`, `awesome-seo sitemap-ingest`, `/sitemap-sync` |
| P3 Search Console | done | `google_gsc_*`, GSC ingest, `awesome-seo seo-audit`, `/seo-audit` (search part) |
| P4 Full crawler | done | `crawl_fetch_pages`, `crawl_extract_structured_data`, `crawl_check_access`, `crawl-ingest`, `access-ingest`, `/crawl-run` |
| P5 Performance | done | `performance_psi_run` (local fallback), `performance_crux_query`, `performance_lighthouse_local_run`, `/perf-audit` |
| P6 GEO, AIO, AEO | done, two skills deferred | `awesome-seo geo-audit [--access]`, `/geo-audit`, `/aio-audit`, `/aeo-audit`, `visibility-analyst`; `entity-consistency` and `faq-quality` not built |
| P7 Analytics | done | GA4 tools and ingest, Metrica tool and ingest, AI referral traffic, traffic section in `seo-audit` |
| P8 Bing and Yandex Webmaster | done | Bing tools and ingest; Yandex Webmaster tools (incl. in-search samples); three-source reconciliation |
| P9 Merchant Center | deferred | Code and tests exist. The site sells no products, so no live check is planned |
| P10 Approval and write tools | done | Approval engine (migration 0003), PreToolUse gate, `approval` CLI, `/approve-action`, three write tools |
| P11 Evaluation | next | Golden dataset, evaluator (precision and recall), evidence coverage check |
| P12 Reporting and polish | not started | Scoring doc, `/connections-check`, README setup per credential |

## Packages and distribution

| Package | Latest on npm | Notes |
|---|---|---|
| `@karailker/awesome-seo-core` | 0.2.1 | 0.2.2 prepared in the repo (access-ingest, cli tests, geo-audit cap warnings). Publish is pending. |
| `@karailker/awesome-seo-mcp-performance` | 0.1.1 | 0.1.0 pinned core 0.1.0, which lacks `drizzle-orm` and crashed at start. 0.1.1 depends on core 0.2.0. |
| `@karailker/awesome-seo-mcp-google` | 0.1.0 | Connects through the plugin |
| `@karailker/awesome-seo-mcp-bing` | 0.1.0 | Connects through the plugin |
| `@karailker/awesome-seo-mcp-yandex` | 0.1.0 (0.1.1 prepared, publish pending) | 0.1.1 fixes the host ownership read: every host looked unverified and every response carried the warning. |

- Plugin manifest `.claude-plugin/plugin.json` (0.2.0) declares the five MCP servers. The root `.mcp.json` was removed. A project-scope copy of the write servers used tool names that the approval hook does not match, so writes ran ungated in the repo directory.
- The crawl server writes under `${CLAUDE_PROJECT_DIR}/data` (`AWESOME_SEO_DATA_DIR`). Takes effect after a Claude Code restart.
- Hook: `hooks/scripts/validate-approval.sh` is executable in git (mode 100755) and is run through `bash` from `hooks/hooks.json`. Before this fix the marketplace clone ran it without execute permission, the launch failed with exit 126, and the write tool ran unguarded.
- Verified 2026-11-06 in a headless session: an unapproved `bing_submit_url` call with the plugin tool name is blocked before it reaches Bing.
- Marketplace: `.claude-plugin/marketplace.json` at the repo root (plugin source `./`). Installed from GitHub; the local-path install failed on WSL symlinks in `node_modules`.

## Tests

- 2026-11-06: core 73 (Vitest, 13 files, includes `src/cli.test.ts` with 8 CLI tests), performance 19. Typecheck passes.
- 2026-11-05 (not re-run this session): google 22, yandex 18, bing 9; crawler 37 (pytest).
- `claude plugin validate .` passes with warnings.

## Live checks done (read-only unless noted)

- Search Console: sites, sitemaps, search analytics (page and query) on `sc-domain:bulmacalig.com`.
- GA4 property 552874034: metadata, page and session-source reports. October 2026: 619 sessions, 14 from chatgpt.com.
- Yandex Metrica counter 113337943: traffic sources, October 2026: 396 visits.
- Yandex Webmaster (2026-11-06): all three hosts `verified: true` after DNS verification (`yandex-verification` TXT on `bulmacalig.com`). Host summary: SQI 0, 29 searchable pages, 461 excluded. Earlier `verified: false` readings came from a plugin bug (fixed in 0.1.1).
- Bing Webmaster: site list, rank and traffic (31 days), page stats (8 rows), URL info, quota.
- PageSpeed Insights (lab), CrUX (field) and local Lighthouse on `www.bulmacalig.com`.
- BulmacaLig crawl (`https://www.bulmacalig.com`, 2026-11-06): sitemap index with 3 children, discovery capped at 500 URLs, 500 of 500 fetched (status completed, 0 robots blocks, 0 errors). Crawl run `2026-11-06T163038Z-0504`.
- BulmacaLig GEO report (core 0.2.1 + local 0.2.2 build): robots readable, llms.txt valid, 10 AI user agents allowed on the 2-URL sample. Warning shown: sitemap equals the URL cap (500).

Live writes (each approved by the user for the test):
- Google Search Console, `sitemap-pages.xml`: success, verified.
- Bing SubmitUrl, `https://www.bulmacalig.com/kare`: call succeeded; the owner sees the submission in Bing (12:42 local time). `GetUrlInfo` last crawl not checked since the Bing key is not set in the plugin's server environment. Acceptance is not confirmed by the API.
- Yandex Webmaster add sitemap, `sitemap-pages.xml`: POST returned 405 (route closed; `OPTIONS` says `Allow: GET`). Recorded as failure. Retry later with a new proposal.

## Known gaps

- **Credentials**: plugin servers read keys from the shell environment at Claude Code start. `~/.bashrc` loads `~/.config/awesome-seo/*.env`. Verified 2026-11-06: Bing, Yandex, Google, PageSpeed and CrUX `true`.
- **Yandex write**: pending approval. Proposal `094007e9-a790-40bc-95ba-8e33a6eb7210` (`sitemap-pages.xml` on `https:www.bulmacalig.com:443`, expires 2026-11-07 17:16Z).
- **Bing acceptance**: not confirmed. `GetUrlInfo` for `https://www.bulmacalig.com/kare` still shows `LastCrawledDate` 2026-10-09 on 2026-11-06 (submit was 2026-11-05). Re-check later.
- **JS-rendered content**: the crawler reads static HTML by default. `render=true` (`crawl_fetch_pages`, `crawl_extract_structured_data`) loads the page in the system Chrome and extracts the DOM after scripts ran (`b8e0f42`). Checked live: `/sss` has `FAQPage` only with render. Active in the installed plugin after an update and a Claude Code restart. Chrome also requests the page's assets; the per-host limit does not cover those. Off by default.
- **Sitemap size**: discovery stops at `url_cap` (500). BulmacaLig's sitemap indexes list far more URLs, so a 500-URL audit is a sample. Raising the cap raises crawl time (about 1 request per second per host).
- **Long crawl calls**: a 500-URL `crawl_fetch_pages` call exceeds the MCP call timeout and is moved to the background. The result arrives as a task notification.
- **`access-ingest` duplicates `geo-audit --access`**: both store the same access report. The commands use `geo-audit --access`. `access-ingest` remains as a standalone helper; remove it if no caller needs it.
- Search Console: one request per call (25 000 rows max, no paging).
- GA4 page report is one request (100 000 rows max, no paging).
- The first GSC execution log row (`5c772bcc`) keeps record-time values; its real submit time was 09:37:03.790Z (Search Console `lastSubmitted`).
- Pages removed from a sitemap are not marked stale.
- Yandex per-URL data is a snapshot (in-search samples); there is no date range for it.
- Crawler `AWESOME_SEO_CONTACT_URL` is unset, so the User-Agent carries a placeholder. Set it before a larger crawl.
- Every VERIFY-marked endpoint, quota, and rule is unconfirmed against vendor documentation. See `grep -rn VERIFY`.

## Open decisions

1. Rotate the secrets pasted in chat during this project: Yandex client secret and tokens, Bing API key, PageSpeed and CrUX keys.
2. Whether to keep `access-ingest` (see gaps).
3. Whether to add a rendered-DOM check for JS-only schema (headless Chrome), which changes the crawl path.

## Credentials and local files (not in the repo)

- `~/.config/awesome-seo/gsc-service-account.json` (service account key, mode 600)
- `~/.config/awesome-seo/performance.env`, `yandex.env`, `bing.env` (mode 600). Loaded into the shell by `~/.bashrc` (snippet marked `awesome-seo plugin credentials`); the plugin's servers read them from the environment.
- `~/Downloads`: the OAuth client JSON (`client_secret_2_...json`) is unused and remains there.

## Toolchain

pnpm 12.16.1 (corepack), Node 24.22.0, uv (Python 3.12.14 for the crawler), Claude Code 2.1.308, Google Chrome 155 (`/usr/bin/google-chrome`). SQLite 3.53.4 (better-sqlite3 13.0.3). Crawler: selectolax 1.0.2 (lexbor), extruct 0.18.0, httpx. Performance: lighthouse 13.6.0, chrome-launcher 1.2.2.
