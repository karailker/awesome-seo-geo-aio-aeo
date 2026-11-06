// Ingests crawl_discover_sitemap JSONL into pages with source='sitemap' (ROADMAP P2).
// One transaction per run. Re-ingesting the same JSONL changes nothing.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeUrl } from "../domain.js";
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
  ingested: number; // rows written (new or refreshed); a repeat of the same sitemap refreshes them
  created: number; // URLs not seen before for this site
  skipped: number;
  errors: string[]; // first few line errors, for the report
};

export function ingestSitemapJsonl(store: Store, siteId: string, jsonl: string): SitemapIngestResult {
  const { lines, rows, skipped, errors } = parseJsonl(jsonl, SitemapLineSchema);
  const known = new Set(
    (store.sqlite.prepare("SELECT url FROM pages WHERE site_id = ?").all(siteId) as { url: string }[]).map((r) => r.url),
  );
  const created = new Set(rows.map((r) => normalizeUrl(r.url)).filter((u) => !known.has(u))).size;

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
  return { lines, ingested: rows.length, created, skipped, errors };
}
