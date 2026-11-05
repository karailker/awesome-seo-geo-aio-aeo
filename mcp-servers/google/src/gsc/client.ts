// Search Console API calls used in P3: sites, search analytics, URL inspection, sitemaps.
// VERIFY: endpoints, row limit (25000 per request), and inspection quotas (2000 per property per day,
// 600 per minute) are taken from the public Search Console API documentation. Re-check before relying on them.
import { GscError, fromHttpStatus } from "./errors.js";
import type { TokenProvider } from "./auth.js";

const SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const REQUEST_TIMEOUT_MS = 30_000;

export const SEARCH_ANALYTICS_MAX_ROWS = 25_000; // VERIFY: per-request row limit

export type SiteEntry = { siteUrl: string; permissionLevel: string };

export type AnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchAnalyticsQuery = {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit: number;
};

export class GscClient {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch,
  ) {}

  private async call<T>(method: "GET" | "POST" | "PUT", url: string, body?: unknown): Promise<T> {
    const token = await this.tokens.getToken();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new GscError("TIMEOUT", "Search Console API request timed out", true);
      }
      throw new GscError("UPSTREAM_ERROR", "Search Console API request failed", true);
    }
    if (!res.ok) throw fromHttpStatus(res.status);
    if (res.status === 204) return undefined as T; // e.g. sitemap PUT returns no body
    return (await res.json()) as T;
  }

  async listSites(): Promise<SiteEntry[]> {
    const body = await this.call<{ siteEntry?: SiteEntry[] }>("GET", SITES_URL);
    return body.siteEntry ?? [];
  }

  async searchAnalytics(site: string, query: SearchAnalyticsQuery): Promise<AnalyticsRow[]> {
    const url = `${SITES_URL}/${encodeURIComponent(site)}/searchAnalytics/query`;
    const body = await this.call<{ rows?: AnalyticsRow[] }>("POST", url, query);
    return body.rows ?? [];
  }

  async inspectUrl(site: string, inspectionUrl: string): Promise<unknown> {
    return this.call<unknown>("POST", INSPECT_URL, { inspectionUrl, siteUrl: site });
  }

  // Write (P10): submits a sitemap. Only reachable through the approval gate. Needs the webmasters scope.
  async submitSitemap(site: string, feedpath: string): Promise<void> {
    await this.call<unknown>("PUT", `${SITES_URL}/${encodeURIComponent(site)}/sitemaps/${encodeURIComponent(feedpath)}`);
  }

  async listSitemaps(site: string): Promise<unknown> {
    return this.call<unknown>("GET", `${SITES_URL}/${encodeURIComponent(site)}/sitemaps`);
  }
}
