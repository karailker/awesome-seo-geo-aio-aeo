import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestCrawlJsonl } from "../ingest/crawl.js";
import { buildCrawlDiff, diffSitemaps } from "./diff.js";

const SITE_ID = "site-1";
const ORIGIN = "https://example.com";

function record(run: string, path: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    run_id: run, fetched_at: run === "run-a" ? "2026-11-01T10:00:00.000Z" : "2026-11-08T10:00:00.000Z", url: ORIGIN + path, status: 200,
    final_url: ORIGIN + path, redirect_chain: [], content_type: "text/html", title: `Title ${path}`, meta_description: null, canonical: ORIGIN + path,
    lang: "tr", hreflang: [], headings: [{ level: 1, text: "H" }], word_count: 400, content_hash: `sha256:${path}-1`, structured_data: [],
    jsonld_syntax_errors: 0, robots_allowed: true, raw_html_path: null, errors: [], ...over,
  });
}

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-diff-"));
  store = openStore(join(dir, "diff.sqlite"));
  upsertSite(store, { id: SITE_ID, name: "Example", canonicalOrigin: ORIGIN, sitemapUrl: null, urlCap: 500, createdAt: "2026-11-01T09:00:00.000Z" });
  // run-a: /same /content /title /gone /status /canon
  ingestCrawlJsonl(store, SITE_ID, ["/same", "/content", "/title", "/gone", "/status", "/canon"].map((p) => record("run-a", p)).join("\n"), null);
  // run-b: /same unchanged, /content new hash, /title new title, /status now 404, /canon new canonical, /fresh is new, /gone is absent
  ingestCrawlJsonl(store, SITE_ID, [
    record("run-b", "/same"),
    record("run-b", "/content", { content_hash: "sha256:/content-2" }),
    record("run-b", "/title", { title: "A new title" }),
    record("run-b", "/status", { status: 404, errors: [{ code: "NOT_FOUND", message: "HTTP 404", retryable: false }] }),
    record("run-b", "/canon", { canonical: ORIGIN + "/canon-new" }),
    record("run-b", "/fresh"),
  ].join("\n"), null);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const diff = () => buildCrawlDiff(store, { siteId: SITE_ID, origin: ORIGIN, fromRunId: "run-a", toRunId: "run-b" });
const section = (text: string, heading: string) => {
  const start = text.indexOf(`## ${heading}`);
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next === -1 ? undefined : next);
};

describe("buildCrawlDiff", () => {
  it("counts what changed between two runs", () => {
    const counts = section(diff(), "Counts");

    expect(counts).toContain("- In both runs: 5. Only in the newer run: 1. Only in the older run: 1.");
    expect(counts).toContain("- Status changed: 1. Content changed: 1. Title changed: 1. Canonical changed: 1.");
  });

  it("lists new and missing URLs without calling a missing URL removed", () => {
    const out = diff();

    expect(section(out, "Only in the newer run")).toContain("https://example.com/fresh");
    expect(section(out, "Only in the older run")).toContain("https://example.com/gone");
    expect(out).toContain("A URL present in only one run may come from a different URL set or cap, not from a change on the site.");
  });

  it("lists each change with both values and the row ids of both runs", () => {
    const out = diff();

    expect(section(out, "Status changes")).toMatch(/https:\/\/example\.com\/status — 200 → 404 \[rows [0-9a-f-]{36} → [0-9a-f-]{36}\]/);
    expect(section(out, "Content changes")).toContain("https://example.com/content");
    expect(section(out, "Title changes")).toContain('"Title /title" → "A new title"');
    expect(section(out, "Canonical changes")).toContain("https://example.com/canon-new");
  });

  it("does not report an unchanged URL", () => {
    expect(diff()).not.toContain("https://example.com/same —");
  });

  it("warns when the two runs cover very different numbers of URLs", () => {
    ingestCrawlJsonl(store, SITE_ID, Array.from({ length: 30 }, (_, i) => record("run-c", `/bulk-${i}`)).join("\n"), null);

    const out = buildCrawlDiff(store, { siteId: SITE_ID, origin: ORIGIN, fromRunId: "run-a", toRunId: "run-c" });

    expect(section(out, "Scope")).toContain("The runs cover different numbers of URLs (6 and 30)");
  });
});

describe("diffSitemaps", () => {
  const line = (url: string, lastmod: string | null = null) => JSON.stringify({ run_id: "s", collected_at: "2026-11-01T00:00:00Z", url, lastmod, sitemap_url: "https://example.com/sitemap.xml" });

  it("returns the URLs added, removed and whose lastmod changed", () => {
    const older = [line("https://example.com/a", "2026-01-01"), line("https://example.com/b"), line("https://example.com/c", "2026-01-01")].join("\n");
    const newer = [line("https://example.com/a", "2026-02-02"), line("https://example.com/c", "2026-01-01"), line("https://example.com/d")].join("\n");

    const result = diffSitemaps(older, newer);

    expect(result.added).toEqual(["https://example.com/d"]);
    expect(result.removed).toEqual(["https://example.com/b"]);
    expect(result.lastmodChanged).toEqual([{ url: "https://example.com/a", from: "2026-01-01", to: "2026-02-02" }]);
  });
});
