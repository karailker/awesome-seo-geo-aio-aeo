// Ingests google_ga4_run_report JSONL into observations (source 'ga4', freshness 'daily').
// pagePath values become full URLs (origin + path) so they can be matched to sitemap pages.
// Ids are deterministic: re-ingesting the same period updates values in place.
import { createHash } from "node:crypto";
import { z } from "zod";
import { observations } from "../db/schema.js";
import { withTransaction, type Store } from "../db/store.js";
import { parseJsonl } from "./jsonl.js";

const Ga4LineSchema = z.object({
  run_id: z.string().min(1),
  collected_at: z.string().min(1),
  property_id: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  dimensions: z.record(z.string()),
  metrics: z.record(z.number().finite()),
});
type Ga4Line = z.infer<typeof Ga4LineSchema>;

export type Ga4IngestResult = { lines: number; ingested: number; skipped: number; errors: string[] };

const id = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex");

export function ingestGa4Jsonl(store: Store, siteId: string, origin: string, jsonl: string): Ga4IngestResult {
  const { lines, rows, skipped, errors } = parseJsonl(jsonl, Ga4LineSchema);

  withTransaction(store, () => {
    for (const line of rows) {
      const entity = entityOf(line, siteId, origin);
      const dims = JSON.stringify(Object.entries(line.dimensions).sort(([a], [b]) => a.localeCompare(b)));
      for (const [metric, value] of Object.entries(line.metrics)) {
        store.db
          .insert(observations)
          .values({
            id: id(siteId, "ga4", metric, entity.type, entity.id, line.period_start, line.period_end, dims),
            siteId,
            source: "ga4",
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
            provenanceJson: JSON.stringify({ run_id: line.run_id, property_id: line.property_id, tool: "google_ga4_run_report" }),
          })
          .onConflictDoUpdate({
            target: observations.id,
            set: { value, collectedAt: line.collected_at, provenanceJson: JSON.stringify({ run_id: line.run_id, property_id: line.property_id, tool: "google_ga4_run_report" }) },
          })
          .run();
      }
    }
  });

  return { lines, ingested: rows.length, skipped, errors };
}

function entityOf(line: Ga4Line, siteId: string, origin: string): { type: "page" | "site"; id: string } {
  const path = line.dimensions.pagePath;
  if (path !== undefined) return { type: "page", id: new URL(path, origin).toString() };
  return { type: "site", id: siteId };
}
