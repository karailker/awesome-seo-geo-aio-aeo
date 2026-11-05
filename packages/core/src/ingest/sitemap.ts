// Ingests crawl_discover_sitemap JSONL into pages with source='sitemap' (ROADMAP P2).
// One transaction per run. Re-ingesting the same JSONL changes nothing.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { upsertPage, withTransaction, type Store } from "../db/store.js";
import { parseJsonl } from "./jsonl.js";

const SitemapLineSchema = z.object({
  run_id: z.string().min(1),
  collected_at: z.string().min(1),
  url: z.string().url(),
  lastmod: z.string().nullable(),
  sitemap_url: z.string().url(),
});

export type SitemapIngestResult = {
  lines: number;
  ingested: number;
  skipped: number;
  errors: string[]; // first few line errors, for the report
};

export function ingestSitemapJsonl(store: Store, siteId: string, jsonl: string): SitemapIngestResult {
  const { lines, rows, skipped, errors } = parseJsonl(jsonl, SitemapLineSchema);

  withTransaction(store, () => {
    for (const row of rows) {
      upsertPage(store, {
        id: randomUUID(),
        siteId,
        url: row.url,
        source: "sitemap",
        lastmod: row.lastmod,
        firstSeenAt: row.collected_at,
        lastSeenAt: row.collected_at,
      });
    }
  });
  return { lines, ingested: rows.length, skipped, errors };
}
