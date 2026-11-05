---
name: structured-data-validation
description: Structured data validation with syntax errors reported separately from missing recommended properties. Use for AEO audits of JSON-LD, microdata, and RDFa on crawled pages.
---

## Purpose
Separate two kinds of problem: markup that does not parse (syntax errors) and valid markup that lacks recommended properties. They need different fixes and must not be counted together.

## When to use
- `/aeo-audit` after a crawl run.
- Not for: Google rich-result eligibility (a separate test), or microdata and RDFa property checks (not in this version).

## Inputs
- Crawl records: `jsonld_syntax_errors` per page and the structured data items.

## Tools
- `pnpm geo:audit --origin <origin>`.
- `crawl_extract_structured_data` for one URL.

## Method
1. Syntax errors: JSON-LD blocks that fail strict JSON parsing (measured, counted per page). Extraction is lenient, so some invalid blocks still appear as items. The count is the signal for syntax errors.
2. Missing recommended properties: for Article, NewsArticle, BlogPosting (headline, datePublished, author, image), Product (name, image, offers), and FAQPage (mainEntity), count the absent properties on each item (measured). The list is project-defined and VERIFY-marked.

## Evidence rules
- Syntax-error findings and missing-property findings are separate findings with separate evidence.

## Output schema
Section "Structured data validation" with two lists: syntax errors, and missing recommended properties.

## Quality checks
- The two lists never share a finding.
- Pages that were not extracted are not listed as clean.

## Missing and failed data
- `jsonld_syntax_errors` null (not extracted): the page is absent from both lists, and the report says so.
