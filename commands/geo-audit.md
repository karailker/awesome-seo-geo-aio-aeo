---
description: GEO, AIO, and AEO audit of the latest crawl run. Measured facts and inferred findings are labeled; every finding cites observations. Read-only.
argument-hint: "[origin] (default: the seeded site)"
---

Run the GEO/AIO/AEO audit for `$ARGUMENTS`. Read-only. Rules: `docs/ROADMAP.md` P6, `docs/SECURITY-AND-APPROVAL.md`.

1. Make sure the database is current (`pnpm db:migrate`) and the site is seeded. If not, stop and say so.
2. The crawl run must exist: if `pnpm geo:audit` reports no crawl run, tell the user to run `/crawl-run` first. Do not crawl here.
3. Check AI crawler access on the same sample as the run. Take up to 50 URLs from the latest crawl output under `data/crawl/`. Call `mcp__plugin_awesome-seo_crawl__crawl_check_access` with `site_root` set to the origin and `sample_urls` set to those URLs. Save the full result as `data/access/<host>-<UTC timestamp>.json` (`mkdir -p data/access` first). If the call fails, record it as missing data and continue without `--access`.
4. Run `pnpm geo:audit --origin <origin> --access data/access/<file>.json > data/reports/geo-audit-<host>-<date>.md` (drop `--access` if step 3 failed). Then show the user the report path and the summary.
5. Report the measured section first, then the findings. Quote the report's wording. Do not add conclusions the report does not state. Do not present project thresholds as ranking factors.
