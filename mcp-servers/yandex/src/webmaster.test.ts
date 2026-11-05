import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addSitemap, hostSummary, indexing, inSearchUrls, listHosts, searchQueries } from "./webmaster-tools.js";

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

  it("pages through in-search samples and writes one JSONL line per URL", async () => {
    const data = (await import("node:fs")).mkdtempSync((await import("node:os")).tmpdir() + "/yw-");
    const pages: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/in-search/samples")) {
        const offset = Number(url.searchParams.get("offset"));
        const limit = Number(url.searchParams.get("limit"));
        pages.push(`${offset}/${limit}`);
        const all = Array.from({ length: 150 }, (_, i) => ({ url: `https://www.bulmacalig.com/p${i}`, last_access: "2026-10-08T00:00:00+03:00" }));
        return new Response(JSON.stringify({ count: 150, samples: all.slice(offset, offset + limit) }), { status: 200 });
      }
      return new Response(JSON.stringify(url.pathname.endsWith("/user/") ? { user_id: rec.user_id } : {}), { status: 200 });
    }) as typeof fetch;

    const r = await inSearchUrls({ host_id: HOST, output_path: "yandex/in.jsonl" }, { ...env, AWESOME_SEO_DATA_DIR: data }, impl);

    expect(r.data).toMatchObject({ count: 150 });
    expect(pages).toEqual(["0/100", "100/100"]);
    const lines = (await import("node:fs")).readFileSync(data + "/yandex/in.jsonl", "utf8").trim().split("\n");
    expect(lines).toHaveLength(150);
    (await import("node:fs")).rmSync(data, { recursive: true, force: true });
  });

  it("adds a sitemap with a POST to the host's sitemaps path, with the URL in the body", async () => {
    const seen: { method: string; path: string; body: string | null }[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      seen.push({ method: init?.method ?? "GET", path: url.pathname, body: init?.body ? String(init.body) : null });
      return url.pathname === "/v4/user/" ? new Response(JSON.stringify({ user_id: rec.user_id }), { status: 200 }) : new Response(null, { status: 204 });
    }) as typeof fetch;

    const r = await addSitemap({ host_id: HOST, sitemap_url: "https://www.bulmacalig.com/sitemap.xml" }, env, impl);

    const post = seen.find((s) => s.method === "POST");
    expect(post?.path).toBe(`/v4/user/${rec.user_id}/hosts/${HOST}/sitemaps`);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ url: "https://www.bulmacalig.com/sitemap.xml" });
    expect(r).toMatchObject({ ok: true, data: { submitted: true } });
  });
});
