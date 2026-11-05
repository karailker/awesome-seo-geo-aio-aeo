---
name: cwv-diagnosis
description: Core Web Vitals diagnosis for sampled URLs. Separates lab from field data, names the metric that drives a poor result, and lists the PageSpeed opportunities. Use for /perf-audit or when the user asks why a page is slow.
---

## Purpose
Say which metric is poor, whether the evidence is lab or field, and what the page-level opportunities are. Keep lab and field apart.

## When to use
- After `performance_psi_run` and `performance_crux_query` for sampled URLs.
- Not for: whole-site performance (needs a larger sample and a plan for quota), or prompt-based AI measurements.

## Inputs
- URLs and their PSI results (`lab_*`, `field_*`, `opportunities`).
- CrUX results for the same URLs or the origin.

## Tools
- `performance_psi_run` (mobile by default).
- `performance_crux_query` (URL or origin).

## Method
1. Field first. For each URL with `field_*` values, compare p75 LCP, INP, CLS, and FCP with the thresholds below. Name the failing metric.
2. Lab next. If field data is null, say so and report lab values as lab only. Do not present them as user experience.
3. Opportunities: list the top three PSI opportunities by estimated savings for the URL. Say they are Lighthouse estimates.
4. Diagnosis: one sentence per URL naming the driving metric, the evidence type (field or lab), and the opportunity that most likely affects it.

Thresholds (project-defined, from the public Core Web Vitals guidance; not Google ranking factors): LCP at most 2500 ms good, above 4000 ms poor; INP at most 200 ms good, above 500 ms poor; CLS at most 0.1 good, above 0.25 poor. FCP is informational only. VERIFY these against current documentation before a published report.

## Evidence rules
- Each diagnosis cites the `performance_psi_run` or `performance_crux_query` result, with its URL, strategy, and date.
- Field values need the CrUX period from the response. State it.
- A diagnosis from lab data alone is labeled "lab only".

## Output schema
Per URL: lab row, field row (or "no field data"), driving metric, evidence type, top opportunities.

## Quality checks
- Lab and field values appear in separate columns, under separate headings.
- Every "no field data" line also says why, if the tool gave a reason.
- The sample is stated: URLs, strategy, and count.

## Missing and failed data
- `AUTH_MISSING`: the key variable is not set.
- `PERMISSION_DENIED`: the API is not enabled for the key's project, or the key's restrictions block it.
- `QUOTA_EXCEEDED`: the daily quota is used up. Report the URLs not checked.
- Not in CrUX dataset: field values are null, not zero.
