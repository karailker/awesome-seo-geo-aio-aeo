---
description: AEO audit (Answer Engine Optimization: answer readiness): structured data validation (syntax errors separate from missing recommended properties), FAQ markup, answer coverage. Read-only.
argument-hint: "[origin] (default: the seeded site)"
---

Run the AEO audit for `$ARGUMENTS`. Read-only.

1. Follow steps 1 and 2 of `/geo-audit` (database and crawl run). The access check is not needed for AEO.
2. Run `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo geo-audit --origin <origin>`.
3. Show these sections: Structured data validation (two lists: syntax errors, and missing recommended properties), Answer coverage, Findings whose id starts with `aeo-`, Evidence check. Mention the report path.
4. Keep syntax errors and missing recommended properties separate. A syntax error means the markup does not parse. A missing property means the markup is valid but incomplete. Do not merge them into one count.
5. Answer coverage: the report lists question-form Search Console queries only as a count from ingested data. Say the join is not done yet.
