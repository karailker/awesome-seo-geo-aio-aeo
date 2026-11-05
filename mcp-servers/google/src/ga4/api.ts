// GA4 Data API (docs/MCP.md, google server). Read-only scope. Errors reuse the Search Console error mapping.
// VERIFY: endpoints (analyticsdata v1beta), row limit (100000 per request) and quotas come from the public GA4 documentation.
import type { TokenProvider } from "../gsc/auth.js";
import { fromHttpStatus, GscError } from "../gsc/errors.js";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const BASE = "https://analyticsdata.googleapis.com/v1beta/properties";
const TIMEOUT_MS = 30_000;
export const GA4_MAX_ROWS = 100_000; // VERIFY: per-request limit

// Dimensions that identify individual users or sessions are refused (docs/SECURITY-AND-APPROVAL.md).
const PERSONAL_DIMENSION = /^(userId|clientId|sessionId|userPseudoId|deviceId|googleSignals)/i;

export type RunReportBody = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions: { name: string }[];
  metrics: { name: string }[];
  limit: number;
};

export class Ga4Client {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private async call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    const token = await this.tokens.getToken();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new GscError("TIMEOUT", "GA4 Data API request timed out", true);
      }
      throw new GscError("UPSTREAM_ERROR", "GA4 Data API request failed", true);
    }
    if (!res.ok) throw fromHttpStatus(res.status);
    return (await res.json()) as T;
  }

  metadata(propertyId: string): Promise<{ dimensions?: { apiName: string }[]; metrics?: { apiName: string }[] }> {
    return this.call("GET", `${BASE}/${propertyId}/metadata`);
  }

  runReport(propertyId: string, body: RunReportBody): Promise<{
    dimensionHeaders?: { name: string }[];
    metricHeaders?: { name: string }[];
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
    rowCount?: number;
  }> {
    return this.call("POST", `${BASE}/${propertyId}:runReport`, body);
  }
}

export function refusePersonalDimensions(names: string[]): void {
  const bad = names.find((n) => PERSONAL_DIMENSION.test(n));
  if (bad) throw new GscError("INVALID_INPUT", `Dimension ${bad} identifies individual users and is not allowed`, false);
}
