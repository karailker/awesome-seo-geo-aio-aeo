---
name: answer-coverage
description: Answer readiness: FAQPage markup on pages and question-form queries from Search Console. Use for AEO audits. In this version the join between queries and pages is not done; the report gives counts only.
---

## Purpose
Show how many pages have FAQPage markup and how many question-form queries appear in Search Console data.

## When to use
- `/aeo-audit` after a crawl run and, when available, Search Console data.
- Not for: whether an AI assistant answers the question (out of scope for v1).

## Inputs
- Crawl observations `has_faqpage`.
- Search Console query observations already ingested (optional).

## Tools
- `pnpm geo:audit --origin <origin>`.

## Method
1. Count pages with FAQPage markup (measured).
2. Count question-form queries in the ingested Search Console data (planned; the report says it is not joined yet).

## Evidence rules
- Counts are measured. No finding is produced in this version.

## Output schema
Section "Answer coverage (AEO)".

## Quality checks
- The count of pages is stated with the total crawled.

## Missing and failed data
- No Search Console data: say so. Do not infer question queries.
