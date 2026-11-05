// Tool handler for the yandex MCP. Token and counter come from the environment. Results are aggregates.
import type { ToolResult } from "@awesome-seo/core";
import { mapMetrica, MetricaError, runMetricaQuery, type MetricaQuery } from "./metrica.js";

export const METRICA_TOKEN_VAR = "YANDEX_METRICA_TOKEN";
export const METRICA_COUNTER_VAR = "YANDEX_METRICA_COUNTER_ID";

type Env = NodeJS.ProcessEnv;

export async function metricaReport(
  input: { counter_id?: string; date1: string; date2: string; metrics: string[]; dimensions: string[]; limit: number },
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
    if (mapped.sampleShare !== null && mapped.sampleShare < 1) {
      warnings.push(`Sampled data: sample share ${mapped.sampleShare}. Totals are estimates.`);
    }
    if (mapped.totalRows > mapped.rows.length) warnings.push(`Row limit reached: ${mapped.rows.length} of ${mapped.totalRows} rows returned.`);
    return {
      ok: true,
      data: { counterId, ...mapped },
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
