---
name: evidence-validation
description: Checks that every finding in an audit report cites observations of the same site, and that confidence labels match the evidence. Use before an audit report is delivered, or when reviewing a report.
---

## Purpose
Enforce "no evidence, no finding" (CLAUDE.md rule 6) and the evaluation gates in `docs/SECURITY-AND-APPROVAL.md`.

## When to use
- Every SEO audit run. The report already applies the core gate. This skill explains what it checks and how a reviewer confirms it.
- Not for: writing findings. Use the domain skills for that.

## Inputs
- A report and its findings (`Finding` objects from `packages/core/src/analysis/evidence.ts`).
- The site id and the observation table.

## Tools
- `validateFindings(store, siteId, findings)` in core. It is called by the report builder.

## Method
1. A finding with no evidence id is dropped, with reason "no evidence".
2. A finding with an evidence id that is not an observation of the same site is dropped, with reason "evidence id(s) not found".
3. Kept findings are shown, and the counts are stated in `## Evidence check`.
4. Confidence: `high` only for direct Search Console observations with a stated date range. Inferred results are `low`.

## Evidence rules
- The gate itself is the evidence rule. It needs no extra data.

## Output schema
The `## Evidence check` section: candidate count, kept count, dropped count, one line per dropped finding.

## Quality checks
- Kept plus dropped equals candidates.
- Each kept finding appears in `## Findings` with the same id count.

## Missing and failed data
- If no Search Console rows exist, there are no candidates. Say "Candidate findings: 0".
