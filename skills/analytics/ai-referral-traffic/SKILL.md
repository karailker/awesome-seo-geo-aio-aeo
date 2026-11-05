---
name: ai-referral-traffic
description: Sessions from AI assistant hosts (ChatGPT, Perplexity, Gemini, Claude, Copilot and others) from GA4 session-source data, using the project list in knowledge/ai-referrers.md. Use for AI referral findings in SEO audits.
---

## Purpose
Count how many sessions arrive from AI assistants, and from which hosts, for one period.

## When to use
- `/seo-audit` after a GA4 session-source report is ingested for the period.
- Not for: prompt-based tests of AI answers (out of scope for v1), or Google and Bing search traffic (search cannot be separated from AI features here).

## Inputs
- `knowledge/ai-referrers.md` (the host list).
- GA4 `sessionSource` rows for the period.

## Tools
- `google_ga4_run_report` with `dimensions: ["sessionSource"]`, `metrics: ["sessions", "totalUsers"]`.
- `pnpm seo:audit --ga4 <file>`.

## Method
1. A source counts as AI referral if it equals a listed host or is a subdomain of one (core: `isAiReferrer`).
2. Report total AI referral sessions and the sources, each with its count (measured).
3. The finding `ga4-ai-referral-sessions` is informational. It does not claim the sessions were caused by a citation.

## Evidence rules
- The finding cites the observations of the matched source rows.
- The host list is project-defined. Say so.

## Output schema
The "## Traffic (GA4)" lines for AI referral, and the finding in `## Findings`.

## Quality checks
- The count of AI sessions equals the sum of the listed sources.
- Hosts not in the list are not counted, even if they look like AI tools. Mention them only if asked.

## Missing and failed data
- No session-source rows: "Not available: no GA4 session-source data for this period."
- A new AI host appears: add it to `knowledge/ai-referrers.md` and to `AI_REFERRER_HOSTS` in core, in the same change.
