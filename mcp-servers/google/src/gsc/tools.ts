// Tool handlers for the google MCP (docs/MCP.md, Search Console section). Each returns the ToolResult envelope.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDataOutput, type ToolResult } from "@karailker/awesome-seo-core";
import { GscError } from "./errors.js";
import { SEARCH_ANALYTICS_MAX_ROWS, type GscClient, type SearchAnalyticsQuery } from "./client.js";

const SOURCE = "gsc";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DELAY_WARNING = "Search Console data is delayed; the most recent days may be incomplete."; // VERIFY: typical delay

export type ClientProvider = () => Promise<GscClient>;

function ok<T>(data: T, warnings: string[] = []): ToolResult<T> {
  return { ok: true, data, source: SOURCE, collectedAt: new Date().toISOString(), warnings, errors: [] };
}

function fail(err: unknown): ToolResult<never> {
  const e = err instanceof GscError ? err : new GscError("UPSTREAM_ERROR", "Unexpected error", false);
  return {
    ok: false,
    source: SOURCE,
    collectedAt: new Date().toISOString(),
    warnings: [],
    errors: [{ code: e.code, message: e.message, retryable: e.retryable }],
  };
}

async function run<T>(fn: () => Promise<ToolResult<T>>): Promise<ToolResult<T> | ToolResult<never>> {
  try {
    return await fn();
  } catch (err) {
    return fail(err);
  }
}

export function listProperties(getClient: ClientProvider) {
  return run(async () => ok(await (await getClient()).listSites()));
}

export function inspectUrl(getClient: ClientProvider, input: { site: string; url: string }) {
  return run(async () => {
    if (!/^https?:\/\//.test(input.url)) throw new GscError("INVALID_INPUT", "url must be an http(s) URL", false);
    // VERIFY: URL Inspection quota is 2000 per property per day and 600 per minute.
    return ok(await (await getClient()).inspectUrl(input.site, input.url), [
      "URL Inspection quota: 2000 per property per day (VERIFY).",
    ]);
  });
}

export function listSitemaps(getClient: ClientProvider, input: { site: string }) {
  return run(async () => ok(await (await getClient()).listSitemaps(input.site)));
}

// Writes one JSONL line per row to output_path (under the data directory). core ingests it.
export function searchAnalytics(
  getClient: ClientProvider,
  input: {
    site: string;
    start_date: string;
    end_date: string;
    dimensions: string[];
    row_limit: number;
    output_path: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  return run(async () => {
    if (!DATE.test(input.start_date) || !DATE.test(input.end_date) || input.start_date > input.end_date) {
      throw new GscError("INVALID_INPUT", "start_date and end_date must be YYYY-MM-DD with start_date <= end_date", false);
    }
    if (new Set(input.dimensions).size !== input.dimensions.length || input.dimensions.length === 0) {
      throw new GscError("INVALID_INPUT", "dimensions must be a non-empty list without duplicates", false);
    }
    if (input.row_limit < 1 || input.row_limit > SEARCH_ANALYTICS_MAX_ROWS) {
      throw new GscError("INVALID_INPUT", `row_limit must be between 1 and ${SEARCH_ANALYTICS_MAX_ROWS}`, false);
    }
    let target: string;
    try {
      target = resolveDataOutput(input.output_path, ".jsonl", env);
    } catch (err) {
      throw new GscError("INVALID_INPUT", (err as Error).message, false);
    }

    const query: SearchAnalyticsQuery = {
      startDate: input.start_date,
      endDate: input.end_date,
      dimensions: input.dimensions,
      rowLimit: input.row_limit,
    };
    const rows = await (await getClient()).searchAnalytics(input.site, query);

    const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 4)}`;
    const collectedAt = new Date().toISOString();
    const lines = rows.map((row) => {
      const dimensions = Object.fromEntries(input.dimensions.map((name, i) => [name, row.keys[i] ?? ""]));
      return JSON.stringify({
        run_id: runId,
        collected_at: collectedAt,
        site: input.site,
        period_start: input.start_date,
        period_end: input.end_date,
        dimensions,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      });
    });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, lines.map((l) => `${l}\n`).join(""), "utf8");

    const warnings = [DELAY_WARNING];
    if (rows.length >= input.row_limit) warnings.push(`Row limit reached (${input.row_limit}); results are truncated.`);
    return ok({ runId, outputPath: target, rowCount: rows.length }, warnings);
  });
}

// Write (P10). Runs only after the approval gate passed (hooks/scripts/validate-approval.sh).
export async function submitSitemap(getClient: ClientProvider, input: { site: string; feedpath: string }) {
  try {
    if (!/^https?:\/\//.test(input.feedpath)) throw new GscError("INVALID_INPUT", "feedpath must be an http(s) URL", false);
    const startedAt = new Date().toISOString();
    await (await getClient()).submitSitemap(input.site, input.feedpath);
    const finishedAt = new Date().toISOString();
    return ok({ site: input.site, feedpath: input.feedpath, submitted: true, startedAt, finishedAt }, ["Submission accepted. Verify with google_gsc_list_sitemaps."]);
  } catch (err) {
    return fail(err);
  }
}
