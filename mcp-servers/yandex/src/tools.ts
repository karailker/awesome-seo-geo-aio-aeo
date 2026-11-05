// Tool handler for the yandex MCP. Token and counter come from the environment. Results are aggregates.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDataOutput, type ToolResult } from "@karailker/awesome-seo-core";
import { mapMetrica, MetricaError, runMetricaQuery, type MetricaQuery } from "./metrica.js";

export const METRICA_TOKEN_VAR = "YANDEX_METRICA_TOKEN";
export const METRICA_COUNTER_VAR = "YANDEX_METRICA_COUNTER_ID";

type Env = NodeJS.ProcessEnv;

export async function metricaReport(
  input: { counter_id?: string; date1: string; date2: string; metrics: string[]; dimensions: string[]; limit: number; output_path?: string },
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ToolResult<unknown>> {
  const source = "yandex_metrica";
  try {
    const counterId = input.counter_id ?? env[METRICA_COUNTER_VAR];
    if (!counterId) throw new MetricaError("INVALID_INPUT", "counter_id is not given and YANDEX_METRICA_COUNTER_ID is not set", false);
    const token = env[METRICA_TOKEN_VAR];
    if (!token) throw new MetricaError("AUTH_EXPIRED", `${METRICA_TOKEN_VAR} is not set`, false);
    const query: MetricaQuery = { counterId, metrics: input.metrics, dimensions: input.dimensions, date1: input.date1, date2: input.date2, limit: input.limit };
    const raw = await runMetricaQuery(fetchImpl, token, query);
    const mapped = mapMetrica(raw as Record<string, unknown>, query);
    const warnings: string[] = [];
    let outputPath: string | null = null;
    if (input.output_path) {
      try {
        outputPath = resolveDataOutput(input.output_path, ".jsonl", env);
      } catch (err) {
        throw new MetricaError("INVALID_INPUT", (err as Error).message, false);
      }
      // One JSONL line per row, same shape as the other sources. core ingests it.
      const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 4)}`;
      const collectedAt = new Date().toISOString();
      const lines = mapped.rows.map((row: { dimensions: Record<string, unknown>; metrics: Record<string, unknown> }) =>
        JSON.stringify({ run_id: runId, collected_at: collectedAt, counter_id: counterId, period_start: input.date1, period_end: input.date2, dimensions: row.dimensions, metrics: row.metrics }),
      );
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, lines.map((l: string) => `${l}\n`).join(""), "utf8");
    }
    if (mapped.sampleShare !== null && mapped.sampleShare < 1) {
      warnings.push(`Sampled data: sample share ${mapped.sampleShare}. Totals are estimates.`);
    }
    if (mapped.totalRows > mapped.rows.length) warnings.push(`Row limit reached: ${mapped.rows.length} of ${mapped.totalRows} rows returned.`);
    return {
      ok: true,
      data: { counterId, ...mapped, outputPath },
      source,
      collectedAt: new Date().toISOString(),
      period: { start: input.date1, end: input.date2 },
      warnings,
      errors: [],
    };
  } catch (err) {
    const e = err instanceof MetricaError ? err : new MetricaError("UPSTREAM_ERROR", "Unexpected error", false);
    return { ok: false, source, collectedAt: new Date().toISOString(), warnings: [], errors: [{ code: e.code, message: e.message, retryable: e.retryable }] };
  }
}
