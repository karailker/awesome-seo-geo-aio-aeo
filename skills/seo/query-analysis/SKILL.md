---
name: query-analysis
description: Query performance from Search Console for one period: queries close to the first page with meaningful impressions (striking distance). Use for SEO audits of query data. Not for AI platform citations or prompt testing.
---

## Purpose
Find queries where the site ranks at positions 8 to 20 with at least 100 impressions in the period. These are close to the first page and have demand.

## When to use
- Search-only audits (`/seo-audit`) with Search Console query data.
- Not for: queries with fewer than 100 impressions, AI answer engines, or trends across periods (single period only).

## Inputs
- `origin` (string), `start` and `end` (YYYY-MM-DD).
- A JSONL file of query-dimension rows from `google_gsc_search_analytics` (`dimensions: ["query"]`).

## Tools
1. `google_gsc_search_analytics` with `dimensions: ["query"]`, `row_limit: 25000`.
2. `pnpm seo:audit --gsc <file>`: ingests the rows and applies the rule in `packages/core/src/report/seo-audit.ts`.

## Method
- Average position is taken from Search Console. Do not recompute it.
- Filter: position between 8 and 20 inclusive, impressions at least 100.
- Report the count and the observation ids. Do not list queries the report does not show.

## Evidence rules
- Each finding cites the `position` and `impressions` observation ids of the matched queries.
- Thresholds are project-defined. Say so in the report.

## Output schema
The `## Findings` section of the SEO audit report. Finding id `gsc-striking-distance-queries`.

## Quality checks
- Rows come from one property and one date range.
- The report's evidence check keeps every finding.

## Missing and failed data
- No query rows for the period: say "Search Console: not available" and report no query findings.
- Row limit reached: the tool warns. Say the result is truncated.
