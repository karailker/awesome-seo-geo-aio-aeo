// Yandex Metrica Stat API: aggregated reports only (docs/SECURITY-AND-APPROVAL.md: no individual user data).
// VERIFY: endpoint https://api-metrika.yandex.net/stat/v1/data, its response fields (data, totals,
// sample_share, data_lifetime) and row limits come from the public Metrica documentation. Re-check before reliance.
export const METRICA_ENDPOINT = "https://api-metrika.yandex.net/stat/v1/data";
const TIMEOUT_MS = 30_000;

// Dimensions that would return or pivot on individual visitors are refused.
const PERSONAL_DIMENSION = /clientid|userid|visitid|purchaseid|ym:s:clientid|ym:s:userid/i;

export type MetricaQuery = {
  counterId: string;
  metrics: string[];
  dimensions: string[];
  date1: string;
  date2: string;
  limit: number;
};

export class MetricaError extends Error {
  constructor(
    readonly code: "AUTH_EXPIRED" | "PERMISSION_DENIED" | "QUOTA_EXCEEDED" | "RATE_LIMITED" | "INVALID_INPUT" | "UPSTREAM_ERROR" | "TIMEOUT" | "NOT_FOUND",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function validateQuery(q: MetricaQuery): void {
  if (!/^\d+$/.test(q.counterId)) throw new MetricaError("INVALID_INPUT", "counter_id must be numeric", false);
  if (q.metrics.length === 0 || q.metrics.length > 20) throw new MetricaError("INVALID_INPUT", "1 to 20 metrics", false);
  if (q.dimensions.length > 5) throw new MetricaError("INVALID_INPUT", "at most 5 dimensions", false);
  for (const d of q.dimensions) {
    if (PERSONAL_DIMENSION.test(d)) throw new MetricaError("INVALID_INPUT", "individual-visitor dimensions are not allowed", false);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date1) || !/^\d{4}-\d{2}-\d{2}$/.test(q.date2) || q.date1 > q.date2) {
    throw new MetricaError("INVALID_INPUT", "date1 and date2 must be YYYY-MM-DD with date1 <= date2", false);
  }
  if (q.limit < 1 || q.limit > 10_000) throw new MetricaError("INVALID_INPUT", "limit must be 1 to 10000", false);
}

export async function runMetricaQuery(fetchImpl: typeof fetch, token: string, q: MetricaQuery): Promise<unknown> {
  validateQuery(q);
  const params = new URLSearchParams({
    ids: q.counterId,
    metrics: q.metrics.join(","),
    dimensions: q.dimensions.join(","),
    date1: q.date1,
    date2: q.date2,
    limit: String(q.limit),
    accuracy: "full",
  });
  let res: Response;
  try {
    res = await fetchImpl(`${METRICA_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `OAuth ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new MetricaError("TIMEOUT", "Yandex Metrica request timed out", true);
    }
    throw new MetricaError("UPSTREAM_ERROR", "Yandex Metrica request failed", true);
  }
  const message = `Yandex Metrica returned HTTP ${res.status}`;
  if (res.status === 400) throw new MetricaError("INVALID_INPUT", message, false);
  if (res.status === 401) throw new MetricaError("AUTH_EXPIRED", message, false);
  if (res.status === 403) throw new MetricaError("PERMISSION_DENIED", message, false);
  if (res.status === 404) throw new MetricaError("NOT_FOUND", message, false);
  if (res.status === 429) throw new MetricaError("RATE_LIMITED", message, true);
  if (!res.ok) throw new MetricaError("UPSTREAM_ERROR", message, res.status >= 500);
  return res.json();
}

type Json = Record<string, any>;

// Turns the Stat API response into rows keyed by dimension and metric names.
export function mapMetrica(raw: Json, q: MetricaQuery) {
  const rows = (raw.data ?? []).map((row: Json) => {
    const dims = Object.fromEntries(q.dimensions.map((name, i) => [name, row.dimensions?.[i]?.name ?? row.dimensions?.[i]?.id ?? null]));
    const mets = Object.fromEntries(q.metrics.map((name, i) => [name, typeof row.metrics?.[i] === "number" ? row.metrics[i] : null]));
    return { dimensions: dims, metrics: mets };
  });
  const totals = Object.fromEntries(q.metrics.map((name, i) => [name, typeof raw.totals?.[i] === "number" ? raw.totals[i] : null]));
  return {
    rows,
    totals,
    totalRows: typeof raw.total_rows === "number" ? raw.total_rows : rows.length,
    sampleShare: typeof raw.sample_share === "number" ? raw.sample_share : null,
  };
}
