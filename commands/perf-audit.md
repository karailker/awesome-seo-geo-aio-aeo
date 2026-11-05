---
description: Performance audit for a few sitemap URLs: PageSpeed Insights lab and CrUX field values, reported separately. Read-only.
argument-hint: "<url> [url ...] (default: up to 5 sampled sitemap URLs)"
---

Run the performance audit for `$ARGUMENTS`. Read-only. Rules: `docs/SECURITY-AND-APPROVAL.md`, `docs/AGENTS-AND-SKILLS.md`.

1. If `$ARGUMENTS` lists URLs, use them. Otherwise take up to 5 URLs from the latest sitemap snapshot under `data/snapshots/` (the most recent `/sitemap-sync` run). Spread the sample across URL paths, not only the homepage. Say which URLs were sampled.
2. For each URL, call `mcp__plugin_awesome-seo_performance__performance_psi_run` with `strategy: "mobile"`. Call `performance_psi_run` with `strategy: "desktop"` only if the user asks.
3. For each URL, call `mcp__plugin_awesome-seo_performance__performance_crux_query` with `url` (or `origin` for the site-level view).
4. If a call returns `AUTH_MISSING`, say the key variable is not set (`PAGESPEED_API_KEY`, `CRUX_API_KEY`). If it returns `PERMISSION_DENIED`, say the API is not enabled for that key's project. If it returns `QUOTA_EXCEEDED`, say the daily quota is used up. Record the error as missing data and continue with the rest.
5. Report with two separate tables: lab (`lab_*`: Lighthouse run, varies between runs) and field (`field_*`: CrUX p75, real users). Never mix them into one column or one score. Show `field_*` as null when CrUX has no data for the URL. Do not estimate it from lab values.
6. Use the `cwv-diagnosis` skill to name the metric that drives a poor result. List the top opportunities from PSI. Do not present the project's lab performance score as a Google ranking factor.
