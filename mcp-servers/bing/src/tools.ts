// Bing tool handlers. Each returns the ToolResult envelope. JSONL output goes under the data directory for core ingest.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDataOutput, type ToolResult } from "@awesome-seo/core";
import { bingCall, bingDate, BingError } from "./bing.js";

export const BING_KEY_VAR = "BING_WEBMASTER_API_KEY";
type Env = NodeJS.ProcessEnv;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function ok<T>(data: T, warnings: string[] = []): ToolResult<T> {
  return { ok: true, data, source: "bing", collectedAt: new Date().toISOString(), warnings, errors: [] };
}
function fail(err: unknown): ToolResult<never> {
  const e = err instanceof BingError ? err : new BingError("UPSTREAM_ERROR", "Unexpected error", false);
  return { ok: false, source: "bing", collectedAt: new Date().toISOString(), warnings: [], errors: [{ code: e.code, message: e.message, retryable: e.retryable }] };
}
function key(env: Env): string {
  const k = env[BING_KEY_VAR];
  if (!k) throw new BingError("AUTH_MISSING", `${BING_KEY_VAR} is not set`, false);
  return k;
}
function siteUrl(site: string): string {
  try {
    const u = new URL(site);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    throw new BingError("INVALID_INPUT", "site must be an http(s) URL", false);
  }
}
function writeJsonl(path: string, env: Env, rows: unknown[]): string {
  const target = resolveDataOutput(path, ".jsonl", env);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, rows.map((x) => `${JSON.stringify(x)}\n`).join(""), "utf8");
  return target;
}

export async function searchStats(
  input: { site: string; start_date?: string; end_date?: string; output_path?: string },
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  try {
    const site = siteUrl(input.site);
    if ((input.start_date && !DATE.test(input.start_date)) || (input.end_date && !DATE.test(input.end_date))) {
      throw new BingError("INVALID_INPUT", "dates must be YYYY-MM-DD", false);
    }
    const raw = (await bingCall(fetchImpl, key(env), "GetRankAndTrafficStats", { siteUrl: site })) as { Date: string; Impressions: number; Clicks: number }[];
    const rows = raw
      .map((r) => ({ date: bingDate(r.Date), impressions: r.Impressions, clicks: r.Clicks }))
      .filter((r) => (!input.start_date || r.date >= input.start_date) && (!input.end_date || r.date <= input.end_date))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const period = rows.length ? { start: rows[0]!.date, end: rows[rows.length - 1]!.date } : null;
    let outputPath: string | null = null;
    if (input.output_path && period) {
      const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 4)}`;
      const collectedAt = new Date().toISOString();
      outputPath = writeJsonl(
        input.output_path,
        env,
        rows.map((r) => ({ run_id: runId, collected_at: collectedAt, site, period_start: period.start, period_end: period.end, dimensions: { date: r.date }, metrics: { impressions: r.impressions, clicks: r.clicks } })),
      );
    }
    return ok({ site, rows, outputPath });
  } catch (err) {
    return fail(err);
  }
}

export async function pageStats(input: { site: string; output_path?: string }, env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  try {
    const site = siteUrl(input.site);
    const raw = (await bingCall(fetchImpl, key(env), "GetPageStats", { siteUrl: site })) as {
      Query: string; Date: string; Impressions: number; Clicks: number; AvgImpressionPosition: number; AvgClickPosition: number;
    }[];
    const rows = raw.map((r) => ({
      page: r.Query, date: bingDate(r.Date), impressions: r.Impressions, clicks: r.Clicks,
      avgImpressionPosition: r.AvgImpressionPosition, avgClickPosition: r.AvgClickPosition,
    }));
    const dates = rows.map((r) => r.date).sort();
    const period = dates.length ? { start: dates[0]!, end: dates[dates.length - 1]! } : null;
    let outputPath: string | null = null;
    if (input.output_path && period) {
      const runId = `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 4)}`;
      const collectedAt = new Date().toISOString();
      outputPath = writeJsonl(
        input.output_path,
        env,
        rows.map((r) => ({ run_id: runId, collected_at: collectedAt, site, period_start: period.start, period_end: period.end, dimensions: { page: r.page, date: r.date }, metrics: { impressions: r.impressions, clicks: r.clicks, avg_impression_position: r.avgImpressionPosition, avg_click_position: r.avgClickPosition } })),
      );
    }
    return ok({ site, rows, outputPath, period });
  } catch (err) {
    return fail(err);
  }
}

export async function urlInfo(input: { site: string; url: string }, env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  try {
    const site = siteUrl(input.site);
    const url = siteUrl(input.url);
    const d = (await bingCall(fetchImpl, key(env), "GetUrlInfo", { siteUrl: site, url })) as Record<string, unknown>;
    const info = { ...d };
    delete info.__type;
    return ok({ site, url, info: { ...info, LastCrawledDate: info.LastCrawledDate ? bingDate(String(info.LastCrawledDate)) : null, DiscoveryDate: info.DiscoveryDate ? bingDate(String(info.DiscoveryDate)) : null } });
  } catch (err) {
    return fail(err);
  }
}

// Write (P10). Runs only after the approval gate passed. Bing's SubmitUrl is subject to a daily quota (VERIFY).
export async function submitUrl(input: { site: string; url: string }, env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  const startedAt = new Date().toISOString();
  try {
    const site = siteUrl(input.site);
    const url = siteUrl(input.url);
    const d = await bingCall(fetchImpl, key(env), "SubmitUrl", {}, { siteUrl: site, url });
    const finishedAt = new Date().toISOString();
    // Only an explicit true counts as accepted. The SubmitUrl response shape is not verified; confirm with bing_url_info.
    return ok({ site, url, submitted: d === true, response: d, startedAt, finishedAt }, ["Bing URL submission is subject to a daily quota (VERIFY). Confirm with bing_url_info."]);
  } catch (err) {
    // Failed calls still carry their timing, so the execution record can use real times.
    return { ...fail(err), startedAt, finishedAt: new Date().toISOString() };
  }
}
