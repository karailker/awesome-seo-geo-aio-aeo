---
name: indexation-analysis
description: Index status of sample URLs from the Search Console URL Inspection API, for URLs in the sitemap or the Search Console page list. Use when the user asks whether specific URLs are indexed. Samples only; not a full crawl.
---

## Purpose
Check the index status of a small sample of URLs with `google_gsc_inspect_url`, and report what Google returned.

## When to use
- The user names URLs, or asks about a few pages from the reconciliation list.
- Not for: whole-site indexing. That needs a sample plan and quota budget.

## Inputs
- `site` (property id, for example `sc-domain:example.com`).
- A list of URLs. Use at most 50 per run.

## Tools
1. `google_gsc_inspect_url` for each sampled URL.

## Method
- Sample the URLs. Prefer the sitemap-only list from reconciliation, then the most important pages.
- Report the verdict and coverage state that the API returns. Do not translate them into ranking claims.

## Evidence rules
- Each result is a direct API observation. Store it through core before citing it in a report. Until core ingest for inspection exists (not in P3), cite it as a tool result with its URL and the date checked.

## Output schema
A table: URL, verdict, coverage state, last crawl date, as returned.

## Quality checks
- Quota: the URL Inspection API allows 2000 requests per property per day and 600 per minute (VERIFY against current Google documentation before relying on it).
- Every URL in the table has a result or an error. None are guessed.

## Missing and failed data
- `PERMISSION_DENIED` or `AUTH_MISSING`: report it and stop. Do not guess the index state.
- `RATE_LIMITED` or `QUOTA_EXCEEDED`: report the URLs not checked.
