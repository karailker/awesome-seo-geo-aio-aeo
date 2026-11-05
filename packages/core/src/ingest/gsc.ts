// Ingests google_gsc_search_analytics JSONL into observations (source='gsc', freshness='delayed').
// Each row becomes four observations: clicks, impressions, ctr, position.
// Re-ingesting the same period updates values in place; ids are deterministic.
import { createHash } from "node:crypto";
import { z } from "zod";
import { observations } from "../db/schema.js";
import { withTransaction, type Store } from "../db/store.js";
import { parseJsonl } from "./jsonl.js";

const GscLineSchema = z.object({
  run_id: z.string().min(1),
  collected_at: z.string().min(1),
  site: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  dimensions: z.record(z.string()),
  clicks: z.number().finite().nonnegative(),
  impressions: z.number().finite().nonnegative(),
  ctr: z.number().finite().min(0).max(1),
  position: z.number().finite().nonnegative(),
});
type GscLine = z.infer<typeof GscLineSchema>;

export type GscIngestResult = {
  lines: number;
  ingested: number; // rows ingested (each row yields four observations)
  skipped: number;
  errors: string[];
};

const METRICS: { name: "clicks" | "impressions" | "ctr" | "position"; unit: string | null }[] = [
  { name: "clicks", unit: null },
  { name: "impressions", unit: null },
  { name: "ctr", unit: "ratio" },
  { name: "position", unit: "average position" },
];

// A row keyed by page is a page entity; otherwise by query; otherwise the site.
function entityOf(line: GscLine, siteId: string): { type: "page" | "query" | "site"; id: string } {
  if (line.dimensions.page) return { type: "page", id: line.dimensions.page };
  if (line.dimensions.query) return { type: "query", id: line.dimensions.query };
  return { type: "site", id: siteId };
}

function observationId(siteId: string, metric: string, entityType: string, entityId: string, line: GscLine): string {
  const dims = JSON.stringify(Object.entries(line.dimensions).sort(([a], [b]) => a.localeCompare(b)));
  const key = [siteId, "gsc", metric, entityType, entityId, line.period_start, line.period_end, dims].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function ingestGscJsonl(store: Store, siteId: string, jsonl: string): GscIngestResult {
  const { lines, rows, skipped, errors } = parseJsonl(jsonl, GscLineSchema);

  withTransaction(store, () => {
    for (const line of rows) {
      const entity = entityOf(line, siteId);
      for (const m of METRICS) {
        const value = line[m.name];
        store.db
          .insert(observations)
          .values({
            id: observationId(siteId, m.name, entity.type, entity.id, line),
            siteId,
            source: "gsc",
            entityType: entity.type,
            entityId: entity.id,
            metric: m.name,
            value,
            unit: m.unit,
            periodStart: line.period_start,
            periodEnd: line.period_end,
            collectedAt: line.collected_at,
            freshness: "delayed",
            dimensionsJson: JSON.stringify(line.dimensions),
            provenanceJson: JSON.stringify({ run_id: line.run_id, tool: "google_gsc_search_analytics" }),
          })
          .onConflictDoUpdate({
            target: observations.id,
            set: { value, collectedAt: line.collected_at, provenanceJson: JSON.stringify({ run_id: line.run_id, tool: "google_gsc_search_analytics" }) },
          })
          .run();
      }
    }
  });

  return { lines, ingested: rows.length, skipped, errors };
}
