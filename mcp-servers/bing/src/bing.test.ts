import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bingDate } from "./bing.js";
import { pageStats, searchStats, submitUrl, urlInfo } from "./tools.js";

const live = JSON.parse(readFileSync(new URL("../tests/fixtures/bing-live.json", import.meta.url), "utf8"));
const KEY = "bing-test-key-value-0001";
const env = { BING_WEBMASTER_API_KEY: KEY } as NodeJS.ProcessEnv;

// Serves recorded responses by method name; the key must be in the query, not in the URL path.
function fake(map: Record<string, unknown>, status = 200) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const method = url.pathname.split("/").pop() ?? "";
    if (status !== 200) return new Response("{}", { status });
    if (!(method in map)) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ d: map[method] }), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("Bing dates", () => {
  it("converts the /Date(ms)/ form to a UTC calendar date", () => {
    expect(bingDate("/Date(1793577600000)/")).toBe("2026-11-02");
    expect(() => bingDate("2026-11-01")).toThrow(/Unexpected date format/);
  });
});

describe("Bing tools", () => {
  it("returns daily rank and traffic rows sorted by date, limited to the range", async () => {
    const { impl } = fake({ GetRankAndTrafficStats: [
      { __type: "x", Date: "/Date(1793577600000)/", Impressions: 5, Clicks: 1 },
      { __type: "x", Date: "/Date(1793491200000)/", Impressions: 7, Clicks: 2 },
    ] });

    const all = await searchStats({ site: "https://bulmacalig.com/" }, env, impl);
    const one = await searchStats({ site: "https://bulmacalig.com/", start_date: "2026-11-02", end_date: "2026-11-02" }, env, impl);

    expect((all.data as { rows: { date: string }[] }).rows.map((x) => x.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect((one.data as { rows: { date: string }[] }).rows.map((x) => x.date)).toEqual(["2026-11-02"]);
  });

  it("sends the key as a query parameter, and never includes it in errors", async () => {
    const { impl, calls } = fake({}, 403);

    const r = await searchStats({ site: "https://bulmacalig.com/" }, env, impl);

    expect(calls[0]).toContain(`apikey=${KEY}`);
    expect(r.errors[0]?.code).toBe("PERMISSION_DENIED");
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("reports a missing key without a request", async () => {
    const { impl, calls } = fake({});

    const r = await pageStats({ site: "https://bulmacalig.com/" }, {} as NodeJS.ProcessEnv, impl);

    expect(r.errors[0]?.code).toBe("AUTH_MISSING");
    expect(calls).toHaveLength(0);
  });

  it("maps recorded page stats with page URLs and the observed period", async () => {
    const { impl } = fake({ GetPageStats: live.page_stats });

    const r = await pageStats({ site: "https://bulmacalig.com/" }, env, impl);

    const d = r.data as { rows: { page: string; impressions: number }[]; period: { start: string; end: string } };
    expect(d.rows[0]?.page).toBe("https://www.bulmacalig.com/");
    expect(d.period.start <= d.period.end).toBe(true);
  });

  it("returns URL info with dates converted", async () => {
    const { impl } = fake({ GetUrlInfo: live.url_info });

    const r = await urlInfo({ site: "https://bulmacalig.com/", url: "https://www.bulmacalig.com/" }, env, impl);

    const info = (r.data as { info: Record<string, unknown> }).info;
    expect(info).not.toHaveProperty("__type");
    expect(info.Url).toBe(live.url_info.Url);
  });

  it("rejects a non-http site before any request", async () => {
    const { impl, calls } = fake({});

    const r = await searchStats({ site: "file:///etc/passwd" }, env, impl);

    expect(r.errors[0]?.code).toBe("INVALID_INPUT");
    expect(calls).toHaveLength(0);
  });

  it("writes page JSONL under the data directory", async () => {
    const data = mkdtempSync(join(tmpdir(), "bing-"));
    const { impl } = fake({ GetPageStats: live.page_stats });
    const prev = process.env.AWESOME_SEO_DATA_DIR;
    process.env.AWESOME_SEO_DATA_DIR = data;
    try {
      const r = await pageStats({ site: "https://bulmacalig.com/", output_path: "bing/pages.jsonl" }, { ...env, AWESOME_SEO_DATA_DIR: data }, impl);
      expect(r.ok).toBe(true);
      const line = JSON.parse(readFileSync(join(data, "bing", "pages.jsonl"), "utf8").split("\n")[0] as string);
      expect(line.dimensions.page).toBe("https://www.bulmacalig.com/");
      expect(line.metrics).toHaveProperty("impressions");
    } finally {
      process.env.AWESOME_SEO_DATA_DIR = prev;
      rmSync(data, { recursive: true, force: true });
    }
  });

  it("submits a URL through SubmitUrl with the site and URL as parameters", async () => {
    const calls: string[] = [];
    const impl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ d: true }), { status: 200 });
    }) as typeof fetch;

    const r = await submitUrl({ site: "https://bulmacalig.com/", url: "https://www.bulmacalig.com/kare" }, env, impl);

    expect(calls[0]).toContain("/SubmitUrl?");
    expect(calls[0]).toContain(`apikey=${KEY}`);
    expect(r).toMatchObject({ ok: true, data: { submitted: true } });
  });
});
