---
description: Technical audit of the latest crawl run: counts, redirects, canonical, titles, hreflang alternates and headings. Every listed URL cites its crawl row. Read-only.
argument-hint: "<origin>"
---

Run the technical audit for `$ARGUMENTS`. Read-only: no approval needed. Rules: `skills/seo/technical-audit/SKILL.md`.

1. Parse `origin`. Stop if it is missing.
2. Make sure the database is current (`npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo migrate`) and the site is seeded (`npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo seed --origin <origin>`). If not, stop and say so.
3. A crawl run must be stored. If `technical-audit` reports no crawl run, tell the user to run `/crawl-run` first.
4. If Search Console page files exist under `data/gsc/`, pass them with `--gsc <file>` so the report can list pages the crawl did not check. Run `mkdir -p data/reports` and then `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo technical-audit --origin <origin> [--gsc data/gsc/<file>.jsonl ...] > data/reports/technical-audit-<host>-<date>.md`.
5. Show the user the report path and the counts from the Counts section. Quote the report's own wording. Do not add conclusions the report does not state. Say which crawl run the report covers and that it may be partial.
