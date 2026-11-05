---
name: machine-readable-content
description: Machine-readable page structure for AI and search systems: JSON-LD presence, heading hierarchy (one H1, no skipped levels), and visible word count. Use for AIO audits of crawled pages.
---

## Purpose
Show whether pages expose clear structure: structured data, a single H1, and no skipped heading levels.

## When to use
- `/aio-audit` after a crawl run.
- Not for: visual layout or rendering (JavaScript rendering is deferred), or content quality judgments.

## Inputs
- The crawl run's derived observations.

## Tools
- `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo geo-audit --origin <origin>`.

## Method
1. Count of JSON-LD items per page (measured).
2. H1 count per page: exactly one is expected (measured).
3. Heading levels: flag a jump of more than one level, e.g. h1 to h3 (measured).

## Evidence rules
- Each finding cites the page observations it lists.

## Output schema
Findings `aio-h1-count` and `aio-heading-skip`.

## Quality checks
- Only status 200 pages.
- Headings come from the page's visible text. Hidden text and scripts are excluded.

## Missing and failed data
- Non-HTML and failed pages: no structure values. Say so.
