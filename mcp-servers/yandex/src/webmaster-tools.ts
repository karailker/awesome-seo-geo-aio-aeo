// Tool handlers for Yandex Webmaster. Token from YANDEX_WEBMASTER_TOKEN. Each returns the ToolResult envelope.
import type { ToolResult } from "@awesome-seo/core";
import { checkHostId, hostPath, userId, webmasterGet, WebmasterError } from "./webmaster.js";

export const WEBMASTER_TOKEN_VAR = "YANDEX_WEBMASTER_TOKEN";
type Env = NodeJS.ProcessEnv;

function ok<T>(data: T, warnings: string[] = []): ToolResult<T> {
  return { ok: true, data, source: "yandex_webmaster", collectedAt: new Date().toISOString(), warnings, errors: [] };
}
function fail(err: unknown): ToolResult<never> {
  const e = err instanceof WebmasterError ? err : new WebmasterError("UPSTREAM_ERROR", "Unexpected error", false);
  return { ok: false, source: "yandex_webmaster", collectedAt: new Date().toISOString(), warnings: [], errors: [{ code: e.code, message: e.message, retryable: e.retryable }] };
}
function token(env: Env): string {
  const t = env[WEBMASTER_TOKEN_VAR];
  if (!t) throw new WebmasterError("AUTH_EXPIRED", `${WEBMASTER_TOKEN_VAR} is not set`, false);
  return t;
}

// Unverified hosts can return data, but it may be partial. Say so every time.
const VERIFY_NOTE = "Host ownership is not verified in Yandex Webmaster: data may be partial or empty.";

export async function listHosts(env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  try {
    const t = token(env);
    const uid = await userId(fetchImpl, t);
    const body = (await webmasterGet(fetchImpl, t, `/user/${uid}/hosts`)) as { hosts?: { host_id: string; ascii_host_url: string; verified?: { verified?: boolean } }[] };
    return ok((body.hosts ?? []).map((h) => ({ hostId: h.host_id, url: h.ascii_host_url, verified: h.verified?.verified === true })));
  } catch (err) {
    return fail(err);
  }
}

export async function hostSummary(input: { host_id: string }, env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  try {
    checkHostId(input.host_id);
    const t = token(env);
    const uid = await userId(fetchImpl, t);
    const body = (await webmasterGet(fetchImpl, t, `${hostPath(uid, input.host_id)}/summary`)) as Record<string, unknown>;
    return ok(body, [VERIFY_NOTE]);
  } catch (err) {
    return fail(err);
  }
}

export async function searchQueries(input: { host_id: string; limit: number }, env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  try {
    checkHostId(input.host_id);
    const t = token(env);
    const uid = await userId(fetchImpl, t);
    const q = new URLSearchParams({ order_by: "TOTAL_SHOWS", query_indicator: "TOTAL_SHOWS", offset: "0", limit: String(input.limit) });
    const body = (await webmasterGet(fetchImpl, t, `${hostPath(uid, input.host_id)}/search-queries/popular?${q}`)) as {
      count?: number;
      queries?: { query_text: string; indicators: Record<string, number> }[];
    };
    return ok({ count: body.count ?? 0, queries: (body.queries ?? []).map((x) => ({ query: x.query_text, indicators: x.indicators })) }, [VERIFY_NOTE]);
  } catch (err) {
    return fail(err);
  }
}

export async function indexing(input: { host_id: string }, env: Env = process.env, fetchImpl: typeof fetch = fetch) {
  try {
    checkHostId(input.host_id);
    const t = token(env);
    const uid = await userId(fetchImpl, t);
    const base = hostPath(uid, input.host_id);
    const history = (await webmasterGet(fetchImpl, t, `${base}/search-urls/in-search/history`)) as { history?: { date: string; value: number }[] };
    const sitemaps = (await webmasterGet(fetchImpl, t, `${base}/sitemaps`)) as { sitemaps?: { sitemap_url: string; errors_count?: number }[] };
    const quota = (await webmasterGet(fetchImpl, t, `${base}/recrawl/quota`)) as { daily_quota?: number; quota_remainder?: number };
    return ok(
      {
        inSearchHistory: history.history ?? [],
        sitemaps: (sitemaps.sitemaps ?? []).map((s) => ({ url: s.sitemap_url, errors: s.errors_count ?? 0 })),
        recrawlQuota: { daily: quota.daily_quota ?? null, remainder: quota.quota_remainder ?? null },
      },
      [VERIFY_NOTE],
    );
  } catch (err) {
    return fail(err);
  }
}
