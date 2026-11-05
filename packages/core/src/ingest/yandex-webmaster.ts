// Ingests yandex_webmaster_in_search_urls JSONL into observations (source 'yandex_webmaster').
// This is a snapshot: each URL is in search on the collection date (period_start = period_end = that day).
// Ids are deterministic: re-ingest updates in place.
import { createHash } from "node:crypto";
import { z } from "zod";
import { observations } from "../db/schema.js";
import { withTransaction, type Store } from "../db/store.js";
import { parseJsonl } from "./jsonl.js";

const LineSchema = z.object({
  run_id: z.string().min(1),
  collected_at: z.string().min(1),
  host_id: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  dimensions: z.record(z.string().nullable()),
  metrics: z.record(z.number().finite()),
});

export type YandexIngestResult = { lines: number; ingested: number; skipped: number; errors: string[] };

const id = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex");

export function ingestYandexWebmasterJsonl(store: Store, siteId: string, jsonl: string): YandexIngestResult {
  const { lines, rows, skipped, errors } = parseJsonl(jsonl, LineSchema);
  withTransaction(store, () => {
    for (const line of rows) {
      const url = line.dimensions.url;
      if (!url) continue;
      for (const [metric, value] of Object.entries(line.metrics)) {
        store.db
          .insert(observations)
          .values({
            id: id(siteId, "yandex_webmaster", metric, url, line.period_start),
            siteId,
            source: "yandex_webmaster",
            entityType: "page",
            entityId: url,
            metric,
            value,
            unit: null,
            periodStart: line.period_start,
            periodEnd: line.period_end,
            collectedAt: line.collected_at,
            freshness: "snapshot",
            dimensionsJson: JSON.stringify(line.dimensions),
            provenanceJson: JSON.stringify({ run_id: line.run_id, host_id: line.host_id, tool: "yandex_webmaster_in_search_urls" }),
          })
          .onConflictDoUpdate({ target: observations.id, set: { value, collectedAt: line.collected_at } })
          .run();
      }
    }
  });
  return { lines, ingested: rows.length, skipped, errors };
}
