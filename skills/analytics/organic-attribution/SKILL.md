---
name: organic-attribution
description: Organic search sessions and page-level sessions from GA4 for one period, with the date range stated. Use for traffic findings in SEO audits when GA4 is connected.
---

## Purpose
Show how much traffic arrives from search and which pages receive it, from GA4 aggregates.

## When to use
- `/seo-audit` when a GA4 session-source or page report is ingested for the period.
- Not for: user-level journeys, conversions attribution beyond GA4's own model, or periods without data.

## Inputs
- `property_id` (GA4, numeric), `start_date`, `end_date`.

## Tools
- `google_ga4_get_metadata` to confirm dimension and metric names.
- `google_ga4_run_report` with `dimensions: ["sessionDefaultChannelGroup"]` or `["pagePath"]`, and `metrics: ["sessions", "totalUsers"]`.
- `pnpm seo:audit --ga4 <file>` ingests the JSONL.

## Method
1. Sessions by session default channel group, for the period (measured).
2. Top landing or page paths by sessions (measured). Paths are stored as full URLs.
3. Do not compare periods unless both are ingested. Say "single period" otherwise.

## Evidence rules
- Each number cites its GA4 observation. Findings need evidence ids.

## Output schema
Traffic section in the SEO audit report: "## Traffic (GA4)".

## Quality checks
- The GA4 property and both dates are in the report.
- Totals match the sum of the rows shown.

## Missing and failed data
- `PERMISSION_DENIED`: the service account lacks access to the property. Say so.
- No rows: "Not available". Do not estimate.
