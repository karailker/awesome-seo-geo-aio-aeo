---
name: citation-readiness
description: Measures how well pages expose citable facts: word count depth, author and date signals in JSON-LD, one H1 per page. Use for GEO audits of crawled pages. Measures structure only, not AI platform citations.
---

## Purpose
Show which pages have the structural signals that make facts easy to cite: depth of content, an author, and a date. This is structure, not whether an AI platform cites the page.

## When to use
- `/geo-audit` after a crawl run.
- Not for: prompt-based citation tests (out of scope for v1), or pages that were not crawled.

## Inputs
- A crawl run ingested into `crawl_runs` and `crawl_results`, and the derived observations (`npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo geo-audit`).

## Tools
- `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo geo-audit --origin <origin>`.
- `crawl_extract_structured_data` for one URL to inspect what was read.

## Method
1. Word count per page (visible text, scripts excluded). Below 300 words is flagged as thin (project threshold, inferred).
2. Author signal: a JSON-LD item has an `author` property. Presence check (measured).
3. Date signal: a JSON-LD item has `datePublished` or `dateModified`. Presence check (measured).
4. Heading structure: one H1 per page (measured).

## Evidence rules
- Each finding cites the observation ids for the pages it lists.
- Thin content is inferred and labeled as such. Presence checks are measured.

## Output schema
Findings `geo-thin-content`, `geo-no-author-signal`, `geo-no-date-signal` in the report.

## Quality checks
- Only status 200 pages are counted for content metrics.
- Author and date are read from JSON-LD only. Say so in the report.

## Missing and failed data
- Robots-blocked or failed pages: not counted, and not treated as missing content.
- A page with no JSON-LD has no author or date signal in this check. Say so; do not guess a byline from visible text.
