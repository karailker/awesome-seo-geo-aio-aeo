---
name: crawler-access
description: Whether AI crawler user agents (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot and others) are allowed by robots.txt for sampled URLs, and whether llms.txt is present and valid. Use for AIO audits.
---

## Purpose
Show which AI crawlers robots.txt blocks, for which sampled URLs, and whether llms.txt is present and valid.

## When to use
- `/aio-audit` or `/geo-audit` when the user wants AI crawler access.
- Not for: whole-site coverage (this is a sample), or pages that robots.txt did not cover.

## Inputs
- The site origin and up to 200 sampled URLs (the same URLs as the crawl run, up to 50 in the command).

## Tools
- `crawl_check_access` (site_root, sample_urls). Save the result under `data/access/`.
- `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo geo-audit --access <file>` ingests the result as observations.

## Method
1. robots.txt is read once. If it cannot be read (5xx or network error), access is unknown for every agent. Never treat unknown as allowed.
2. For each agent, count sampled URLs that robots.txt disallows. List up to 20 blocked URLs.
3. llms.txt: present (HTTP 200) and valid (first non-empty line is an H1 title). The validity rule follows the llms.txt proposal. VERIFY against the current spec.

## Evidence rules
- Each blocked-agent finding cites the observation for that agent, with its blocked URLs in the observation dimensions.
- Findings are measured for the sampled URLs only. Say "sampled", not "site-wide".

## Output schema
Findings `aio-ai-blocked-<agent>` and `aio-llms-txt`. Section "Crawler access (AI user agents)".

## Quality checks
- The agent list in the tool is the one in the report. Vendor tokens are VERIFY-marked in code.
- Sample size is stated next to every count.

## Missing and failed data
- robots.txt unavailable: say "unknown", list no blocked counts.
- Access not checked: the report says so. Do not fill it in.
