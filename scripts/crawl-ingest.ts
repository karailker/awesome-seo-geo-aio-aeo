// Ingests a crawl_fetch_pages JSONL file into crawl_runs and crawl_results for a seeded site.
// Usage: pnpm crawl:ingest --origin https://example.com data/snapshots/<run>.jsonl
// Requires a built core (pnpm -r build) and a seeded site (pnpm db:seed). Path override: AWESOME_SEO_DB.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ingestCrawlJsonl, normalizeUrl, openStore } from "../packages/core/dist/index.js";

const { values, positionals } = parseArgs({
  options: { origin: { type: "string" } },
  allowPositionals: true,
});

const jsonlPath = positionals[0];
if (!values.origin || !jsonlPath) {
  console.error("Usage: pnpm crawl:ingest --origin https://example.com <file.jsonl>");
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
  const result = ingestCrawlJsonl(store, site.id, readFileSync(jsonlPath, "utf8"), jsonlPath);
  console.log(JSON.stringify({ ok: true, db: dbPath, origin, file: jsonlPath, ...result }));
} finally {
  store.close();
}
