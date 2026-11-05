// GA4 tool handlers. Each returns the ToolResult envelope. Writes JSONL under the data directory for core ingest.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDataOutput, type ToolResult } from "@karailker/awesome-seo-core";
import { GscError } from "../gsc/errors.js";
import { GA4_MAX_ROWS, refusePersonalDimensions, type Ga4Client } from "./api.js";

const SOURCE = "ga4";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROPERTY = /^\d+$/;
export type Ga4ClientProvider = () => Promise<Ga4Client>;

const ok = <T>(data: T, warnings: string[] = []): ToolResult<T> => ({
  ok: true, data, source: SOURCE, collectedAt: new Date().toISOString(), warnings, errors: [],
});
const fail = (err: unknown): ToolResult<never> => {
  const e = err instanceof GscError ? err : new GscError("UPSTREAM_ERROR", "Unexpected error", false);
  return { ok: false, source: SOURCE, collectedAt: new Date().toISOString(), warnings: [], errors: [{ code: e.code, message: e.message, retryable: e.retryable }] };
};

export async function ga4Metadata(getClient: Ga4ClientProvider, input: { property_id: string }) {
  try {
    if (!PROPERTY.test(input.property_id)) throw new GscError("INVALID_INPUT", "property_id must be numeric", false);
    const meta = await (await getClient()).metadata(input.property_id);
    return ok({
      propertyId: input.property_id,
      dimensions: (meta.dimensions ?? []).map((d) => d.apiName),
      metrics: (meta.metrics ?? []).map((m) => m.apiName),
    });
  } catch (err) {
    return fail(err);
  }
}

export async function ga4RunReport(
  getClient: Ga4ClientProvider,
  input: { property_id: string; start_date: string; end_date: string; dimensions: string[]; metrics: string[]; limit: number; output_path: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    if (!PROPERTY.test(input.property_id)) throw new GscError("INVALID_INPUT", "property_id must be numeric", false);
    if (!DATE.test(input.start_date) || !DATE.test(input.end_date) || input.start_date > input.end_date) {
      throw new GscError("INVALID_INPUT", "start_date and end_date must be YYYY-MM-DD with start_date <= end_date", false);
    }
    if (input.metrics.length === 0) throw new GscError("INVALID_INPUT", "at least one metric", false);
    refusePersonalDimensions(input.dimensions);
    if (input.limit < 1 || input.limit > GA4_MAX_ROWS) throw new GscError("INVALID_INPUT", `limit must be 1 to ${GA4_MAX_ROWS}`, false);
    let target: string;
    try {
      target = resolveDataOutput(input.output_path, ".jsonl", env);
    } catch (err) {
      throw new GscError("INVALID_INPUT", (err as Error).message, false);
    }

    const res = await (await getClient()).runReport(input.property_id, {
      dateRanges: [{ startDate: input.start_date, endDate: input.end_date }],
      dimensions: input.dimensions.map((name) => ({ name })),
      metrics: input.metrics.map((name) => ({ name })),
      limit: input.limit,
    });
    const dimNames = input.dimensions;
    const metNames = input.metrics;
    const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 4)}`;
    const collectedAt = new Date().toISOString();
    const lines = (res.rows ?? []).map((row) =>
      JSON.stringify({
        run_id: runId,
        collected_at: collectedAt,
        property_id: input.property_id,
        period_start: input.start_date,
        period_end: input.end_date,
        dimensions: Object.fromEntries(dimNames.map((n, i) => [n, row.dimensionValues[i]?.value ?? ""])),
        metrics: Object.fromEntries(metNames.map((n, i) => [n, Number(row.metricValues[i]?.value ?? 0)])),
      }),
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, lines.map((l) => `${l}\n`).join(""), "utf8");

    const rowCount = res.rows?.length ?? 0;
    const warnings = ["GA4 data is aggregated and may lag by about a day (VERIFY)."];
    if ((res.rowCount ?? rowCount) > rowCount) warnings.push(`Row limit reached: ${rowCount} of ${res.rowCount} rows written.`);
    return ok({ runId, outputPath: target, rowCount }, warnings);
  } catch (err) {
    return fail(err);
  }
}
