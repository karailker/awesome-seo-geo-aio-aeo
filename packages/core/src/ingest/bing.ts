// Ingests bing_search_stats and bing_page_stats JSONL into observations (source 'bing', freshness 'daily').
// Rows with a page dimension are page entities (URL as Bing returns it). Other rows are site-level.
// Ids are deterministic: re-ingest updates values in place.
import { createHash } from "node:crypto";
import { z } from "zod";
import { observations } from "../db/schema.js";
import { withTransaction, type Store } from "../db/store.js";
import { parseJsonl } from "./jsonl.js";

const BingLineSchema = z.object({
  run_id: z.string().min(1),
  collected_at: z.string().min(1),
  site: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  dimensions: z.record(z.string()),
  metrics: z.record(z.number().finite()),
});
type BingLine = z.infer<typeof BingLineSchema>;

export type BingIngestResult = { lines: number; ingested: number; skipped: number; errors: string[] };

const id = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex");

export function ingestBingJsonl(store: Store, siteId: string, jsonl: string): BingIngestResult {
  const { lines, rows, skipped, errors } = parseJsonl(jsonl, BingLineSchema);
  withTransaction(store, () => {
    for (const line of rows) {
      const entity = entityOf(line, siteId);
      const dims = JSON.stringify(Object.entries(line.dimensions).sort(([a], [b]) => a.localeCompare(b)));
      for (const [metric, value] of Object.entries(line.metrics)) {
        store.db
          .insert(observations)
          .values({
            id: id(siteId, "bing", metric, entity.type, entity.id, line.period_start, line.period_end, dims),
            siteId,
            source: "bing",
            entityType: entity.type,
            entityId: entity.id,
            metric,
            value,
            unit: null,
            periodStart: line.period_start,
            periodEnd: line.period_end,
            collectedAt: line.collected_at,
            freshness: "daily",
            dimensionsJson: JSON.stringify(line.dimensions),
            provenanceJson: JSON.stringify({ run_id: line.run_id, tool: "bing_page_stats" }),
          })
          .onConflictDoUpdate({ target: observations.id, set: { value, collectedAt: line.collected_at } })
          .run();
      }
    }
  });
  return { lines, ingested: rows.length, skipped, errors };
}

function entityOf(line: BingLine, siteId: string): { type: "page" | "site"; id: string } {
  const page = line.dimensions.page;
  return page !== undefined ? { type: "page", id: page } : { type: "site", id: siteId };
}
