---
name: source-attribution
description: Author and publication date signals in structured data (JSON-LD) for crawled pages. Use for AIO audits when the user asks who wrote a page and when it was published.
---

## Purpose
Show whether pages declare an author and a date in structured data. Those are the signals that let a reader or an AI system attribute a fact.

## When to use
- `/aio-audit` or `/geo-audit` after a crawl run.
- Not for: visible bylines, microdata-only pages (not checked in this version), or judging the author's expertise.

## Inputs
- The crawl run's derived observations (`has_author`, `has_date`).

## Tools
- `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo geo-audit --origin <origin>`.

## Method
1. `has_author`: a JSON-LD item has an `author` property (measured).
2. `has_date`: a JSON-LD item has `datePublished` or `dateModified` (measured).

## Evidence rules
- Findings `geo-no-author-signal` and `geo-no-date-signal` cite the observations of the pages they list.

## Output schema
The findings above, in the GEO section.

## Quality checks
- Say that only JSON-LD is read.

## Missing and failed data
- No JSON-LD on a page: no author and date signal, reported as absent for the check, not as absent from the page.
