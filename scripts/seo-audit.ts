// Prints the Search Console and sitemap audit for one period as Markdown.
// Optionally ingests a google_gsc_search_analytics JSONL file first.
// Usage: pnpm seo:audit --origin https://example.com --start 2026-09-01 --end 2026-10-31 [--gsc data/live/pages.jsonl]
// Requires a built core (pnpm -r build) and a seeded site (pnpm db:seed). Path override: AWESOME_SEO_DB.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildSeoAuditReport, ingestGscJsonl, normalizeUrl, openStore } from "../packages/core/dist/index.js";

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    gsc: { type: "string", multiple: true },
  },
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
if (!values.origin || !values.start || !values.end || !DATE.test(values.start) || !DATE.test(values.end)) {
  console.error("Usage: pnpm seo:audit --origin https://example.com --start YYYY-MM-DD --end YYYY-MM-DD [--gsc file.jsonl]");
  process.exit(1);
}

const origin = new URL(normalizeUrl(values.origin)).origin;
const dbPath = process.env.AWESOME_SEO_DB ?? "data/awesome-seo.sqlite";
const store = openStore(dbPath);
try {
  const site = store.sqlite
    .prepare("SELECT id FROM sites WHERE canonical_origin = ?")
    .get(origin) as { id: string } | undefined;
  if (!site) {
    console.error(`No seeded site for ${origin}. Run pnpm db:seed first.`);
    process.exit(1);
  }
  for (const file of values.gsc ?? []) {
    ingestGscJsonl(store, site.id, readFileSync(file, "utf8"));
  }
  console.log(
    buildSeoAuditReport(store, { siteId: site.id, origin, periodStart: values.start, periodEnd: values.end }),
  );
} finally {
  store.close();
}
