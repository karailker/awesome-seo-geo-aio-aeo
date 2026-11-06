# Agents, skills, and commands

Status: as of 2026-11-05. Items marked *not built* are planned and not in the repo.

## Agents

| Agent | Purpose | MCP servers used | Status |
|---|---|---|---|
| `seo-orchestrator` | Plans a run, picks domain agents, synthesizes | none directly | not built (commands call the domain agents directly for now) |
| `search-analyst` | Search Console, Bing, and Yandex analysis, reconciliation | google, bing, yandex | built |
| `traffic-analyst` | GA4 and Metrica traffic, attribution, AI referrals | google (GA4), yandex (Metrica) | built |
| `visibility-analyst` | GEO, AIO, AEO from crawl data and access checks | crawl | built |
| `performance-analyst` | Lab and field performance for sampled URLs | performance | built |
| `evidence-auditor` | Checks evidence coverage and labels before delivery | core (reads report) | built |

Rules for all agents: read the relevant skill first; never call write tools directly (they run only through the approval flow); report missing sources explicitly; keep measured facts apart from inferred findings; state samples and date ranges.

## Skill standard

Each skill is `skills/<domain>/<name>/SKILL.md` with frontmatter (`name`, `description`) and these sections in order: Purpose, When to use, Inputs, Tools, Method, Evidence rules, Output schema, Quality checks, Missing and failed data.

## Skill inventory

| Skill | Status | Notes |
|---|---|---|
| `seo/query-analysis` | built | Striking-distance queries (position 8–20, 100+ impressions). Project thresholds. |
| `seo/sitemap-reconciliation` | built | Sitemap vs Search Console, Bing, and Yandex snapshot. |
| `seo/indexation-analysis` | built (tool only) | Uses `google_gsc_inspect_url` for a sample. Results are not stored yet. |
| `seo/technical-audit` | written; report not built | Needs a crawl report section. |
| `geo/citation-readiness` | built | Thin content, author and date presence (JSON-LD). |
| `geo/entity-consistency` | not built | Deferred from P6. |
| `aio/crawler-access` | built | AI user agents on samples; llms.txt. |
| `aio/machine-readable-content` | built | JSON-LD presence, one H1, heading skips. |
| `aio/source-attribution` | built | Author and date signals (JSON-LD only). |
| `aeo/structured-data-validation` | built | Syntax errors kept separate from missing recommended properties. |
| `aeo/answer-coverage` | built (counts only) | FAQPage count; question-query join not done. |
| `aeo/faq-quality` | not built | Deferred from P6. |
| `analytics/organic-attribution` | built | GA4 sessions and pages for the period. |
| `analytics/ai-referral-traffic` | built | AI host list in `knowledge/ai-referrers.md`. |
| `performance/cwv-diagnosis` | built | Field first, then lab; local fallback is lab only. |
| `ecommerce/merchant-feed-health` | written (deferred) | Depends on P9. |
| `intelligence/evidence-validation` | built (in code) | `validateFindings`. |
| `intelligence/report-generation` | built (in code) | `buildSeoAuditReport` and `buildGeoReport`. |

## Commands

| Command | Runs | Status |
|---|---|---|
| `/sitemap-sync` | `crawl_discover_sitemap`, then `awesome-seo sitemap-ingest` | built |
| `/seo-audit` | Search Console, GA4, Bing, Yandex, sitemap; `awesome-seo seo-audit` | built |
| `/crawl-run` | `crawl_fetch_pages`, then `awesome-seo crawl-ingest` | built |
| `/geo-audit` | `crawl_check_access` saved to `data/access/`, then `awesome-seo geo-audit --access` (all GEO, AIO, AEO sections) | built |
| `/aio-audit` | same report; AIO sections | built |
| `/aeo-audit` | same report; AEO sections | built |
| `/perf-audit` | PSI, CrUX, local fallback | built |
| `/ecommerce-audit` | Merchant issues | deferred (P9) |
| `/approve-action` | list, approve, reject, execute, verify, record | built |
| `/connections-check` | status check for every connection | not built (P12) |
