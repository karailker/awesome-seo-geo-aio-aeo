// PageSpeed Insights (docs/MCP.md performance section). Lab and field values are kept apart:
// lab_* comes from the Lighthouse run, field_* comes from CrUX data that PSI returns for the URL.
// VERIFY: endpoint version v5 and the daily quota (25000 requests per day per project) are from the
// public PSI documentation. Re-check before relying on them.
import { fromApiStatus, PerfError } from "./errors.js";

export const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const TIMEOUT_MS = 170_000; // PSI runs Lighthouse on Google's side and can take over a minute

export type Strategy = "mobile" | "desktop";

// Lab metric name -> Lighthouse audit id. Values are ms, except CLS (unitless).
const LAB_AUDITS: [string, string][] = [
  ["lab_lcp_ms", "largest-contentful-paint"],
  ["lab_fcp_ms", "first-contentful-paint"],
  ["lab_cls", "cumulative-layout-shift"],
  ["lab_tbt_ms", "total-blocking-time"],
  ["lab_speed_index_ms", "speed-index"],
];

// CrUX metric key (as PSI returns it) -> field metric name. p75 percentiles.
const FIELD_METRICS: { key: string; name: string; scale: number }[] = [
  { key: "LARGEST_CONTENTFUL_PAINT_MS", name: "field_lcp_p75_ms", scale: 1 },
  { key: "FIRST_CONTENTFUL_PAINT_MS", name: "field_fcp_p75_ms", scale: 1 },
  { key: "INTERACTION_TO_NEXT_PAINT", name: "field_inp_p75_ms", scale: 1 },
  { key: "CUMULATIVE_LAYOUT_SHIFT_SCORE", name: "field_cls_p75", scale: 0.01 }, // CrUX sends CLS x100
];

export type Opportunity = { id: string; title: string; savingsMs: number | null };

export type PsiMapped = {
  lab: Record<string, number | null> & { lab_performance_score: number | null };
  field: Record<string, number | null> & { field_category: string | null };
  fieldAvailable: boolean;
  opportunities: Opportunity[];
};

export async function runPsi(
  fetchImpl: typeof fetch,
  key: string,
  url: string,
  strategy: Strategy,
): Promise<unknown> {
  const params = new URLSearchParams({ url, strategy, category: "performance", key });
  let res: Response;
  try {
    res = await fetchImpl(`${PSI_ENDPOINT}?${params.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new PerfError("TIMEOUT", "PageSpeed Insights request timed out", true);
    }
    throw new PerfError("UPSTREAM_ERROR", "PageSpeed Insights request failed", true);
  }
  if (!res.ok) throw fromApiStatus(res.status, "PageSpeed Insights");
  return res.json();
}

type Json = Record<string, any>;

export function mapPsi(raw: Json): PsiMapped {
  const audits: Json = raw?.lighthouseResult?.audits ?? {};
  const score = raw?.lighthouseResult?.categories?.performance?.score;

  const lab: PsiMapped["lab"] = {
    lab_performance_score: typeof score === "number" ? Math.round(score * 100) : null,
  } as PsiMapped["lab"];
  for (const [name, auditId] of LAB_AUDITS) {
    const value = audits[auditId]?.numericValue;
    lab[name] = typeof value === "number" ? value : null;
  }

  const metrics: Json = raw?.loadingExperience?.metrics ?? {};
  const field: PsiMapped["field"] = {
    field_category: raw?.loadingExperience?.overall_category ?? null,
  } as PsiMapped["field"];
  for (const m of FIELD_METRICS) {
    const p75 = metrics[m.key]?.percentile;
    field[m.name] = typeof p75 === "number" ? p75 * m.scale : null;
  }

  const opportunities: Opportunity[] = Object.values(audits)
    .filter((a: Json) => a?.details?.type === "opportunity" && typeof a.score === "number" && a.score < 0.9)
    .map((a: Json) => ({
      id: String(a.id),
      title: String(a.title),
      savingsMs: typeof a.details.overallSavingsMs === "number" ? a.details.overallSavingsMs : null,
    }))
    .sort((x, y) => (y.savingsMs ?? 0) - (x.savingsMs ?? 0))
    .slice(0, 10);

  return {
    lab,
    field,
    fieldAvailable: Object.keys(metrics).length > 0,
    opportunities,
  };
}
