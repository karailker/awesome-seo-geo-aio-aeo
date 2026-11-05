---
name: technical-audit
description: Checks crawlability, indexability, canonical and hreflang consistency, status codes, redirect chains, and duplicate titles for sitemap URLs from a crawl run. Use for technical SEO audits of one site after /crawl-run.
---

## Purpose
Report technical facts about the crawled URLs: status, redirects, robots access, canonical, hreflang, title, and heading structure. Report what was measured. Do not invent a value for a URL that was not fetched.

## When to use
- After `/crawl-run` has been ingested for the site.
- Not for: Search Console performance (see `seo/query-analysis`), AI crawler access (see `aio/crawler-access`, later), or pages that were never crawled.

## Inputs
- `origin`, and the latest crawl run stored in `crawl_runs`.

## Tools
- `pnpm crawl:ingest` (stores the run).
- `crawl_check_access` (AI crawler rules; separate skill).
- `crawl_extract_structured_data` for a single URL to inspect.

## Method
1. Counts: URLs fetched, status 200, robots-blocked, errors by code.
2. Redirect chains: URLs with one or more hops, and the final status.
3. Canonical: missing canonical, and canonical pointing to a different URL than the final URL.
4. Titles: missing titles, and titles shared by more than one URL.
5. Hreflang: alternates listed, with each alternate URL noted. Do not judge reciprocity unless every alternate was crawled.
6. Headings: pages with no `h1`.

## Evidence rules
- Each listed issue cites the URLs and the `crawl_results` row ids it came from.
- A URL that robots blocked is "not fetched", never "missing".

## Output schema
Sections: Counts, Redirects, Canonical, Titles, Hreflang, Headings. Each lists counts first, then up to 20 URLs.

## Quality checks
- Counts add up: fetched + robots-blocked + errors equals the URL count of the run.
- The run status is `partial` when any URL failed, and the report says so.

## Missing and failed data
- `ROBOTS_UNAVAILABLE`: robots status is unknown for the site. Say so; do not treat blocked as fetched or missing.
- `NOT_HTML` and `EXTRACT_FAILED`: no on-page fields for that URL. Say so.
