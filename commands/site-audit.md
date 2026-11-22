---
description: Full deep audit of the whole site in one command: every connected source, a full crawl with rendering of script-built pages, Search Console URLs, change since the last run, performance sample, one combined report checked by the evidence auditor. Read-only.
argument-hint: "[origin] (default: origin from awesome-seo.json)"
---

Run the full site audit for `$ARGUMENTS`. Read-only: no write tool is called and no approval is needed. It can take 10 to 25 minutes (one request per second per host), so say so before the crawl. Rules: `docs/SECURITY-AND-APPROVAL.md`, `docs/AGENTS-AND-SKILLS.md`. For a fast sample use `/site-check`.

1. Settings, connections and database: do steps 1 to 3 of `/site-check`.
2. Sitemap and full crawl. Discover the sitemap (`mcp__plugin_awesome-seo_crawl__crawl_discover_sitemap`), ingest it, crawl with `mcp__plugin_awesome-seo_crawl__crawl_fetch_pages` using `url_cap` from the settings (default 500), then `crawl-ingest`. Note the run id. If the sitemap holds more URLs than the cap, say the audit covers the first N.
3. Access. Call `mcp__plugin_awesome-seo_crawl__crawl_check_access` and keep the JSON.
4. Search, period = the last 28 days ending 3 days ago. Pull Search Console pages and queries, GA4 sources and pages, Bing (`bing_search_stats`, `bing_page_stats`) and Yandex (`yandex_webmaster_search_queries`, `yandex_webmaster_indexing`, `yandex_webmaster_in_search_urls` and `yandex_metrica_report` when enabled) with `output_path` under `data/`. A failed call is missing data; never fill in values. When the settings enable Merchant, also run what `/ecommerce-audit` does.
5. Search Console URLs the crawl did not check: run `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo gsc-urls --origin <origin> <gsc pages file>`; crawl the listed URLs with `crawl_fetch_pages`, ingest that run too, and pass both runs to the report with repeated `--run`.
6. Script-built pages. Run `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo render-urls --origin <origin> --run <run id>`. If it lists pages, crawl them with `crawl_fetch_pages` and `render: true` (needs Chrome; if `crawl_health` shows none, say these pages stay unrendered and are listed under Missing data), then `awesome-seo crawl-merge --base <crawl file> --patch <rendered file> --out <merged file> --run-id <run id>-rendered`, `crawl-ingest` the merged file and use its run id from here on.
7. Change since last time. If an earlier run for this site exists, run `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo diff --origin <origin> --from <earlier run> --to <run id>` and keep the output. Say if the run sizes differ much.
8. Performance. `performance_psi_run` (`strategy: "mobile"`) for up to 5 URLs spread across URL paths, `performance_crux_query` for the origin and those URLs. Keep lab and field values separate.
9. Report. `mkdir -p data/reports`, then `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo audit --origin <origin> --mode deep --run <run id> [--run <gsc run id>] --start <start> --end <end> --access ... --gsc ... --ga4 ... --bing ... --yandex ... > data/reports/site-audit-<host>-<date>.md`.
10. Check. Ask the `evidence-auditor` agent to check the report. If it reports a FAIL, fix the cause (or say what cannot be fixed) and rebuild.
11. Show the report path, the "Needs attention" list, the "Missing data" list, the change since last time and the performance values with their lab or field label. Quote the report's own wording. Do not add conclusions the reports do not state.
