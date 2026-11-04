# Agents and skills

## Agents

| Agent | Purpose | Inputs | MCP servers used | Outputs |
|---|---|---|---|---|
| `seo-orchestrator` | Plans the run, selects domain agents, runs independent work in parallel, synthesizes | user request, command scope | none directly | audit run plan, synthesized findings |
| `search-analyst` | Search performance and indexing analysis | site, date range | google, bing, yandex | observations, search findings |
| `traffic-analyst` | Traffic, attribution, AI referral analysis | site, date range | google (GA4), yandex (Metrica) | observations, traffic findings |
| `visibility-analyst` | GEO, AIO, AEO: crawl access, structure, structured data, answer readiness | site, sitemap URLs | crawl | crawl observations, GEO/AIO/AEO findings |
| `performance-analyst` | Lab and field performance | sitemap URLs (sampled), strategy | performance | observations, performance findings |
| `evidence-auditor` | Verifies evidence coverage, consistency, confidence labels | audit run ID | core (read) | pass/fail report, corrections list |

Rules for all agents:
- Read the relevant skill before doing domain work.
- Never call write tools. Create an `action_proposal` through core instead.
- Report missing sources explicitly. Do not infer values for missing sources.
- Write intermediate results through core. Return summaries to the orchestrator, not raw data dumps.
- Prefer sampling and caps for large URL sets; state the sample in the output.

## Skill standard

Each skill lives in `skills/<domain>/<name>/` with:

```
<name>/
├── SKILL.md          # required
├── references/       # methodology notes, checklists, source lists
├── scripts/          # optional, deterministic helpers
├── schemas/          # optional, output JSON schema
└── examples/         # optional, sample output
```

`SKILL.md` must include these sections in this order:

1. **Purpose**: what the skill determines.
2. **When to use**: triggering conditions and cases where it should not be used.
3. **Inputs**: required and optional, with types.
4. **Tools**: MCP tools to call, in order of use.
5. **Method**: step-by-step analysis.
6. **Evidence rules**: what observations must be attached to each finding; minimum sample sizes.
7. **Output schema**: reference to a JSON schema or a template.
8. **Quality checks**: conditions that must hold before the output is trusted.
9. **Missing and failed data**: what to report and how confidence changes.

Frontmatter:

```yaml
---
name: technical-audit
description: Checks crawlability, indexability, canonicalization, and basic on-page technical signals for sitemap URLs. Use for technical SEO audits of a single site.
---
```

The `description` field is what triggers the skill, so keep it specific.

## Skill inventory (v1)

### seo/
- `technical-audit`: crawl results, canonical and indexability consistency, status codes, redirects
- `indexation-analysis`: GSC inspection and index status vs. sitemap
- `query-analysis`: query performance, cannibalization signals, position bands
- `sitemap-reconciliation`: sitemap vs. GSC, Bing, Yandex URL sets

### geo/
- `citation-readiness`: how well pages expose citable facts, authorship, dates, and sources. Measures structure, not AI platform citations (no prompt testing in v1).
- `entity-consistency`: name, organization, and product entity consistency across pages and structured data

### aio/
- `crawler-access`: robots rules for AI user agents, `llms.txt` status, blocked vs. allowed sampled URLs
- `machine-readable-content`: structured data presence, content extraction clarity, heading hierarchy
- `source-attribution`: author, date, and publisher signals

### aeo/
- `answer-coverage`: whether pages answer common question forms found in GSC queries
- `structured-data-validation`: syntax errors vs. missing recommended properties, separately reported
- `faq-quality`: FAQ and Q&A markup quality and coverage

### analytics/
- `organic-attribution`: organic sessions and conversions by landing page, date range stated
- `ai-referral-traffic`: referral sessions from AI sources, using the source list in `knowledge/ai-referrers.md`

### performance/
- `cwv-diagnosis`: separates lab from field, identifies the metric driving poor status, lists opportunities

### ecommerce/
- `merchant-feed-health`: product issues grouped by type, linked to products and URLs

### intelligence/
- `evidence-validation`: checks that every finding has evidence and that confidence labels match the evidence
- `opportunity-scoring`: applies the project-defined scoring method in `docs/SCORING.md`
- `report-generation`: English report template with fixed sections

## Commands

| Command | Runs |
|---|---|
| `/seo-audit` | search-analyst, traffic-analyst (if connected), evidence-auditor |
| `/geo-audit` | visibility-analyst (GEO), evidence-auditor |
| `/aio-audit` | visibility-analyst (AIO), evidence-auditor |
| `/aeo-audit` | visibility-analyst (AEO), evidence-auditor |
| `/perf-audit` | performance-analyst, evidence-auditor |
| `/ecommerce-audit` | merchant skill via search-analyst, evidence-auditor (from P9) |
| `/sitemap-sync` | crawl discovery and core ingest |
| `/crawl-run` | crawl fetch, extract, ingest |
| `/connections-check` | status check for every connection |
| `/approve-action` | approval of a pending proposal |