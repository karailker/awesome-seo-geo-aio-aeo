import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hostSummary, indexing, listHosts, searchQueries } from "./webmaster-tools.js";

const rec = JSON.parse(readFileSync(new URL("../tests/fixtures/webmaster-live.json", import.meta.url), "utf8"));
const HOST = "https:www.bulmacalig.com:443";
const env = { YANDEX_WEBMASTER_TOKEN: "tok-value-for-tests" } as NodeJS.ProcessEnv;
const HOSTS = { hosts: [{ host_id: HOST, ascii_host_url: "https://www.bulmacalig.com/", verified: { verified: false } }] };

// Routes the recorded responses by path. Anything else is a 404.
function routed(overrides: Record<string, { status: number; body: unknown }> = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v4/, "") + url.search;
    calls.push(path);
    const hit = overrides[path.split("?")[0] as string];
    if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status });
    const table: Record<string, unknown> = {
      "/user/": { user_id: rec.user_id },
      [`/user/${rec.user_id}/hosts`]: HOSTS,
      [`/user/${rec.user_id}/hosts/${HOST}/summary`]: rec.summary,
      [`/user/${rec.user_id}/hosts/${HOST}/search-queries/popular`]: { count: rec.queries_count, queries: rec.queries },
      [`/user/${rec.user_id}/hosts/${HOST}/search-urls/in-search/history`]: { history: rec.in_search_history },
      [`/user/${rec.user_id}/hosts/${HOST}/sitemaps`]: { sitemaps: rec.sitemaps },
      [`/user/${rec.user_id}/hosts/${HOST}/recrawl/quota`]: rec.recrawl_quota,
    };
    const body = table[path.split("?")[0] as string];
    return body === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("Yandex Webmaster tools", () => {
  it("lists hosts with verification state", async () => {
    const { impl } = routed();

    const r = await listHosts(env, impl);

    expect(r.ok).toBe(true);
    expect(r.data).toEqual([{ hostId: HOST, url: "https://www.bulmacalig.com/", verified: false }]);
  });

  it("returns the host summary with an unverified-host warning", async () => {
    const { impl } = routed();

    const r = await hostSummary({ host_id: HOST }, env, impl);

    expect(r.data).toMatchObject({ searchable_pages_count: 29, excluded_pages_count: 461 });
    expect(r.warnings[0]).toContain("not verified");
  });

  it("maps popular queries with their indicators", async () => {
    const { impl } = routed();

    const r = await searchQueries({ host_id: HOST, limit: 5 }, env, impl);

    expect(r.data).toMatchObject({ count: 49 });
    expect((r.data as { queries: { query: string }[] }).queries[0]?.query).toBe("bulmaca sözlüğü");
  });

  it("combines in-search history, sitemaps, and the recrawl quota", async () => {
    const { impl } = routed();

    const r = await indexing({ host_id: HOST }, env, impl);

    const d = r.data as { inSearchHistory: unknown[]; sitemaps: { url: string; errors: number }[]; recrawlQuota: { daily: number } };
    expect(d.inSearchHistory.length).toBe(8);
    expect(d.sitemaps.every((s) => s.errors === 0)).toBe(true);
    expect(d.recrawlQuota.daily).toBe(150);
  });

  it("reports a missing token without a request", async () => {
    const { impl, calls } = routed();

    const r = await listHosts({} as NodeJS.ProcessEnv, impl);

    expect(r.errors[0]?.code).toBe("AUTH_EXPIRED");
    expect(calls).toHaveLength(0);
  });

  it("refuses a host ID with unexpected characters before any request", async () => {
    const { impl, calls } = routed();

    const r = await hostSummary({ host_id: "https://evil/../x" }, env, impl);

    expect(r.errors[0]?.code).toBe("INVALID_INPUT");
    expect(calls).toHaveLength(0);
  });

  it("maps 403 to PERMISSION_DENIED", async () => {
    const { impl } = routed({ "/user/": { status: 403, body: {} } });

    const r = await listHosts(env, impl);

    expect(r.errors[0]?.code).toBe("PERMISSION_DENIED");
  });
});
