// Ingests crawl_discover_sitemap JSONL into pages with source='sitemap' (ROADMAP P2).
// One transaction per run. Re-ingesting the same JSONL changes nothing.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { upsertPage, withTransaction, type Store } from "../db/store.js";

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

const MAX_REPORTED_ERRORS = 5;

export function ingestSitemapJsonl(store: Store, siteId: string, jsonl: string): SitemapIngestResult {
  const result: SitemapIngestResult = { lines: 0, ingested: 0, skipped: 0, errors: [] };
  const rows: z.infer<typeof SitemapLineSchema>[] = [];

  jsonl.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") return;
    result.lines += 1;
    let problem: string | null = null;
    try {
      const parsed = SitemapLineSchema.safeParse(JSON.parse(raw));
      if (parsed.success) rows.push(parsed.data);
      else problem = parsed.error.issues[0]?.message ?? "invalid record";
    } catch {
      problem = "not valid JSON";
    }
    if (problem !== null) {
      result.skipped += 1;
      if (result.errors.length < MAX_REPORTED_ERRORS) result.errors.push(`line ${index + 1}: ${problem}`);
    }
  });

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
  result.ingested = rows.length;
  return result;
}
