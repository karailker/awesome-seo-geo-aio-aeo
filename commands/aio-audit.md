---
description: AIO audit (AI discoverability): AI crawler access, llms.txt, machine-readable content, heading structure. Runs the same report as /geo-audit and shows the AIO sections. Read-only.
argument-hint: "[origin] (default: the seeded site)"
---

Run the AIO audit for `$ARGUMENTS`. Read-only.

1. Follow steps 1 to 3 of `/geo-audit` (database, crawl run, access check). The access check is required for AIO: without it, the crawler-access section is "not checked".
2. Run `pnpm geo:audit --origin <origin> --access <file>.json`.
3. Show these sections only: Measured (robots and llms.txt lines), Findings whose id starts with `aio-` or `aio-ai-blocked`, Crawler access (AI user agents), Evidence check. Mention the report path.
4. Keep the measured/inferred basis for each finding. A blocked AI crawler is measured from robots.txt for the sampled URLs, not for the whole site.
