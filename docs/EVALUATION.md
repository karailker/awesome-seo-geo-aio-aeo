# Evaluation

Question answered: do the reports flag what they should and nothing else? Run it with one command:

```bash
corepack pnpm evaluate
```

It prints precision and recall for every finding category and fails when any category is below the threshold.

## What it runs

- **Dataset:** `packages/core/tests/evaluation/golden.json`. A made-up site with 20 crawled pages, an AI crawler access result, 5 Search Console pages and 6 queries. Every page is either one a rule must flag or a true negative a rule must leave alone (an article with its author inside `@graph`, a product page without a byline, a JavaScript shell with no static text, a text file, a 404, a robots-blocked URL, values exactly on a threshold).
- **Expected findings:** written by hand in the same file, from the rules in this repository's documentation, not produced by the code under test. Each finding id lists the pages (or queries, or `SITE`) it must cover.
- **Runner:** `packages/core/src/evaluation.test.ts`. It ingests the dataset into a temporary database, runs the real GEO and SEO report builders, turns each finding's evidence ids back into the pages or queries they cite, and compares the sets.

## Metrics

Per finding category: true positives (flagged and expected), false positives (flagged, not expected), false negatives (expected, not flagged). Precision is TP / (TP + FP), recall is TP / (TP + FN).

## Thresholds

Precision 1.00 and recall 1.00 for every category. The checks are deterministic rules over fixed input, so one miss or one extra finding is a defect, not noise. A category that returns a finding the dataset does not expect fails with precision 0.

Also checked:

- **Evidence coverage:** every finding cites at least one observation, and the evidence gate drops none.
- **Reproducibility:** a second run on a fresh database gives identical findings and identical report text.

## Adding a case

1. Add a page (or a Search Console row) to `golden.json` with a `note` saying why it is a positive or a true negative.
2. Add it to the matching list under `expected` when a rule must flag it.
3. Run `corepack pnpm evaluate`. A new real defect shows up as a category below 1.00. Fix the code, not the expectation, unless the rule itself was wrong.

## What it does not cover

- The rules are checked on a made-up site. It says nothing about how often a rule is right on real sites; spot-check live reports (for example against the raw crawl file) after rule changes.
- Findings that need live APIs (Merchant issues, PageSpeed, CrUX, Bing and Yandex data) are covered by their server tests and live checks, not by this dataset.
- The technical audit lists facts and has no findings, so it has no precision or recall. It is covered by fixture tests.
