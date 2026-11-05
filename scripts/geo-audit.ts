// Prints the GEO / AIO / AEO audit for a crawl run as Markdown.
// Optionally ingests a crawl_check_access JSON result first. Derives observations for the run.
// Usage: pnpm geo:audit --origin https://example.com [--run <run_id>] [--access data/access/<file>.json]
// Requires a built core (pnpm -r build), a seeded site, and an ingested crawl run. Path override: AWESOME_SEO_DB.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildGeoReport, deriveCrawlObservations, ingestAccessReport, normalizeUrl, openStore } from "../packages/core/dist/index.js";

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    run: { type: "string" },
    access: { type: "string" },
  },
});

if (!values.origin) {
  console.error("Usage: pnpm geo:audit --origin https://example.com [--run <run_id>] [--access file.json]");
  process.exit(1);
}

const origin = new URL(normalizeUrl(values.origin)).origin;
const dbPath = process.env.AWESOME_SEO_DB ?? "data/awesome-seo.sqlite";
const store = openStore(dbPath);
try {
  const site = store.sqlite.prepare("SELECT id FROM sites WHERE canonical_origin = ?").get(origin) as { id: string } | undefined;
  if (!site) {
    console.error(`No seeded site for ${origin}. Run pnpm db:seed first.`);
    process.exit(1);
  }
  const run = values.run
    ? (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE id = ? AND site_id = ?").get(values.run, site.id) as { id: string } | undefined)
    : (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE site_id = ? ORDER BY started_at DESC LIMIT 1").get(site.id) as { id: string } | undefined);
  if (!run) {
    console.error("No crawl run found for this site. Run /crawl-run first.");
    process.exit(1);
  }
  if (values.access) ingestAccessReport(store, site.id, readFileSync(values.access, "utf8"));
  deriveCrawlObservations(store, site.id, run.id);
  console.log(buildGeoReport(store, { siteId: site.id, origin, runId: run.id }));
} finally {
  store.close();
}
