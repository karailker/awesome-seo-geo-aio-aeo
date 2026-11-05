import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertPage, upsertSite, type Store } from "../db/store.js";
import { ingestCrawlJsonl } from "./crawl.js";

const RUN = readFileSync(new URL("../../tests/fixtures/crawl/site-run.jsonl", import.meta.url), "utf8");
const SITE_ID = "site-1";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-crawl-"));
  store = openStore(join(dir, "crawl.sqlite"));
  upsertSite(store, {
    id: SITE_ID,
    name: "Example",
    canonicalOrigin: "https://example.com",
    sitemapUrl: null,
    urlCap: 500,
    createdAt: "2026-11-05T09:00:00.000Z",
  });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = (sql: string) => (store.sqlite.prepare(sql).get() as { n: number }).n;

describe("ingestCrawlJsonl", () => {
  it("stores the run and one result per URL, marking the run partial when any URL failed", () => {
    const result = ingestCrawlJsonl(store, SITE_ID, RUN, "data/crawl/run.jsonl");

    expect(result).toMatchObject({ lines: 8, ingested: 8, skipped: 0, alreadyIngested: false });
    expect(count("SELECT COUNT(*) AS n FROM crawl_runs")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM crawl_results")).toBe(8);
    const run = store.sqlite.prepare("SELECT status, url_count, jsonl_path FROM crawl_runs").get();
    expect(run).toEqual({ status: "partial", url_count: 8, jsonl_path: "data/crawl/run.jsonl" });
  });

  it("maps robots, status, and extracted fields into crawl_results", () => {
    ingestCrawlJsonl(store, SITE_ID, RUN, null);

    const secret = store.sqlite
      .prepare(
        `SELECT r.robots_allowed, r.status, r.title, r.errors_json FROM crawl_results r
         JOIN pages p ON p.id = r.page_id WHERE p.url = ?`,
      )
      .get("https://example.com/private/secret.html") as { robots_allowed: number; status: number | null; title: string | null; errors_json: string };
    expect(secret.robots_allowed).toBe(0);
    expect(secret.status).toBeNull();
    expect(secret.title).toBeNull();
    expect(JSON.parse(secret.errors_json)[0].code).toBe("ROBOTS_DISALLOWED");

    const home = store.sqlite
      .prepare("SELECT title, lang, word_count, content_hash, headings_json FROM crawl_results WHERE status = 200 AND title = 'Home page'")
      .get() as { title: string; lang: string; word_count: number; content_hash: string; headings_json: string };
    expect(home.lang).toBe("en");
    expect(home.word_count).toBe(10);
    expect(home.content_hash).toMatch(/^sha256:/);
    expect(JSON.parse(home.headings_json)).toEqual([
      { level: 1, text: "Welcome" },
      { level: 2, text: "About us" },
    ]);
  });

  it("keeps pages discovered by sitemap as source sitemap and links results to them", () => {
    upsertPage(store, {
      id: "sitemap-page",
      siteId: SITE_ID,
      url: "https://example.com/index.html",
      source: "sitemap",
      lastmod: "2026-10-01",
      firstSeenAt: "2026-11-01T00:00:00.000Z",
      lastSeenAt: "2026-11-01T00:00:00.000Z",
    });

    ingestCrawlJsonl(store, SITE_ID, RUN, null);

    const page = store.sqlite
      .prepare("SELECT id, source, lastmod, first_seen_at FROM pages WHERE url = ?")
      .get("https://example.com/index.html");
    expect(page).toEqual({
      id: "sitemap-page",
      source: "sitemap",
      lastmod: "2026-10-01",
      first_seen_at: "2026-11-01T00:00:00.000Z",
    });
    const linked = store.sqlite.prepare("SELECT COUNT(*) AS n FROM crawl_results WHERE page_id = 'sitemap-page'").get() as { n: number };
    expect(linked.n).toBe(1);
  });

  it("skips a run that is already stored, so re-running the same file changes nothing", () => {
    ingestCrawlJsonl(store, SITE_ID, RUN, null);

    const again = ingestCrawlJsonl(store, SITE_ID, RUN, null);

    expect(again.alreadyIngested).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM crawl_results")).toBe(8);
  });

  it("stores a second run of the same URLs as a new run without duplicating pages", () => {
    ingestCrawlJsonl(store, SITE_ID, RUN, null);
    const second = RUN.replaceAll(/"run_id": "[^"]+"/g, '"run_id": "run-2"');

    ingestCrawlJsonl(store, SITE_ID, second, null);

    expect(count("SELECT COUNT(*) AS n FROM crawl_runs")).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM crawl_results")).toBe(16);
    expect(count("SELECT COUNT(*) AS n FROM pages WHERE source = 'crawl'")).toBe(8);
  });

  it("skips invalid lines and reports them", () => {
    const withBad = `not json\n${RUN}`;

    const result = ingestCrawlJsonl(store, SITE_ID, withBad, null);

    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/^line 1: not valid JSON/);
    expect(result.ingested).toBe(8);
  });
});
