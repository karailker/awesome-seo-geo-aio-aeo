// Ingests yandex_metrica_report JSONL into observations (source 'yandex_metrica', freshness 'daily').
// Rows without a page dimension are site-level. Ids are deterministic: re-ingest updates in place.
import { createHash } from "node:crypto";
import { z } from "zod";
import { observations } from "../db/schema.js";
import { withTransaction, type Store } from "../db/store.js";
import { parseJsonl } from "./jsonl.js";

const MetricaLineSchema = z.object({
  run_id: z.string().min(1),
  collected_at: z.string().min(1),
  counter_id: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  dimensions: z.record(z.union([z.string(), z.null()])),
  metrics: z.record(z.union([z.number().finite(), z.null()])),
});

export type MetricaIngestResult = { lines: number; ingested: number; skipped: number; errors: string[] };

const id = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex");

export function ingestMetricaJsonl(store: Store, siteId: string, jsonl: string): MetricaIngestResult {
  const { lines, rows, skipped, errors } = parseJsonl(jsonl, MetricaLineSchema);
  withTransaction(store, () => {
    for (const line of rows) {
      const dims = JSON.stringify(Object.entries(line.dimensions).sort(([a], [b]) => a.localeCompare(b)));
      for (const [metric, value] of Object.entries(line.metrics)) {
        if (value === null) continue;
        const row = {
          id: id(siteId, "yandex_metrica", metric, line.counter_id, line.period_start, line.period_end, dims),
          siteId,
          source: "yandex_metrica",
          entityType: "site",
          entityId: line.counter_id,
          metric,
          value,
          unit: null,
          periodStart: line.period_start,
          periodEnd: line.period_end,
          collectedAt: line.collected_at,
          freshness: "daily",
          dimensionsJson: JSON.stringify(line.dimensions),
          provenanceJson: JSON.stringify({ run_id: line.run_id, counter_id: line.counter_id, tool: "yandex_metrica_report" }),
        };
        store.db
          .insert(observations)
          .values(row)
          .onConflictDoUpdate({ target: observations.id, set: { value, collectedAt: line.collected_at } })
          .run();
      }
    }
  });
  return { lines, ingested: rows.length, skipped, errors };
}
