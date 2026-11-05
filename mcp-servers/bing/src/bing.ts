// Bing Webmaster API (JSON). Key from BING_WEBMASTER_API_KEY, sent as a query parameter (the API's only auth method).
// The key is never included in errors, logs, or written files.
// VERIFY: endpoints under https://ssl.bing.com/webmaster/api.svc/json/ (GetRankAndTrafficStats, GetPageStats,
// GetUrlInfo), the daily URL submission quota, and the response shape come from the public Bing Webmaster documentation.
export const BING_BASE = "https://ssl.bing.com/webmaster/api.svc/json/";
const TIMEOUT_MS = 30_000;

export class BingError extends Error {
  constructor(
    readonly code: "AUTH_MISSING" | "AUTH_EXPIRED" | "PERMISSION_DENIED" | "NOT_FOUND" | "RATE_LIMITED" | "INVALID_INPUT" | "UPSTREAM_ERROR" | "TIMEOUT",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

// Bing returns dates as "/Date(1793577600000)/" (milliseconds since epoch, UTC).
export function bingDate(value: string): string {
  const m = /\/Date\((-?\d+)\)\//.exec(value);
  if (!m) throw new BingError("UPSTREAM_ERROR", "Unexpected date format in Bing response", false);
  return new Date(Number(m[1])).toISOString().slice(0, 10);
}

// GET with query parameters, or POST with a JSON body when body is given (SubmitUrl requires POST; verified live).
export async function bingCall(fetchImpl: typeof fetch, key: string, method: string, params: Record<string, string>, postBody?: Record<string, string>): Promise<unknown> {
  const q = new URLSearchParams({ apikey: key, ...(postBody ? {} : params) });
  let res: Response;
  try {
    res = await fetchImpl(`${BING_BASE}${method}?${q.toString()}`, {
      method: postBody ? "POST" : "GET",
      headers: { accept: "application/json", ...(postBody ? { "content-type": "application/json; charset=utf-8" } : {}) },
      body: postBody ? JSON.stringify(postBody) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new BingError("TIMEOUT", "Bing Webmaster request timed out", true);
    }
    throw new BingError("UPSTREAM_ERROR", "Bing Webmaster request failed", true);
  }
  const message = `Bing Webmaster returned HTTP ${res.status} for ${method}`;
  if (res.status === 401) throw new BingError("AUTH_EXPIRED", message, false);
  if (res.status === 403) throw new BingError("PERMISSION_DENIED", message, false);
  if (res.status === 404) throw new BingError("NOT_FOUND", message, false);
  if (res.status === 429) throw new BingError("RATE_LIMITED", message, true);
  if (!res.ok) throw new BingError("UPSTREAM_ERROR", message, res.status >= 500);
  const body = (await res.json().catch(() => null)) as { d?: unknown; Message?: string } | null;
  if (!body || body.d === undefined) throw new BingError("UPSTREAM_ERROR", `Unexpected response for ${method}`, false);
  return body.d;
}
