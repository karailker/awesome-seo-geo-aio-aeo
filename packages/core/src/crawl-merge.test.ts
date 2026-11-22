import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeCrawl, urlsNeedingRender } from "./crawl-merge.js";
import { openStore, upsertSite, type Store } from "./db/store.js";
import { ingestCrawlJsonl } from "./ingest/crawl.js";

const rec = (run: string, path: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    run_id: run, fetched_at: "2026-11-05T10:00:00.000Z", url: `https://example.com${path}`, status: 200, final_url: `https://example.com${path}`,
    redirect_chain: [], content_type: "text/html", title: "T", meta_description: null, canonical: `https://example.com${path}`, lang: "tr", hreflang: [],
    headings: [{ level: 1, text: "H" }], word_count: 300, content_hash: `sha256:${path}`, structured_data: [], jsonld_syntax_errors: 0,
    robots_allowed: true, raw_html_path: null, rendered: false, errors: [], ...over,
  });

describe("mergeCrawl", () => {
  it("replaces the base record of a URL with the patch record and keeps the rest, under a new run id", () => {
    const base = [rec("base", "/a"), rec("base", "/shell", { word_count: 0, headings: [] }), rec("base", "/b")].join("\n");
    const patch = [rec("patch", "/shell", { word_count: 540, rendered: true })].join("\n");

    const merged = mergeCrawl(base, patch, "base-rendered").split("\n").map((l) => JSON.parse(l));

    expect(merged.map((r) => r.url)).toEqual(["https://example.com/a", "https://example.com/shell", "https://example.com/b"]);
    expect(merged.every((r) => r.run_id === "base-rendered")).toBe(true);
    expect(merged.find((r) => r.url.endsWith("/shell"))).toMatchObject({ word_count: 540, rendered: true });
    expect(merged.find((r) => r.url.endsWith("/a"))).toMatchObject({ rendered: false });
  });

  it("does not replace a page with a patch record that failed", () => {
    const base = rec("base", "/shell", { word_count: 0, headings: [] });
    const patch = rec("patch", "/shell", { status: null, errors: [{ code: "RENDER_FAILED", message: "no chrome", retryable: false }], word_count: null });

    const merged = JSON.parse(mergeCrawl(base, patch, "m"));

    expect(merged).toMatchObject({ word_count: 0, rendered: false });
  });
});

describe("urlsNeedingRender", () => {
  let dir: string;
  let store: Store;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "core-render-"));
    store = openStore(join(dir, "r.sqlite"));
    upsertSite(store, { id: "s1", name: "Example", canonicalOrigin: "https://example.com", sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists fetched HTML pages with no text that were not rendered, not text files or already rendered pages", () => {
    ingestCrawlJsonl(store, "s1", [
      rec("run-1", "/ok"),
      rec("run-1", "/shell", { word_count: 0, headings: [] }),
      rec("run-1", "/rendered-empty", { word_count: 0, headings: [], rendered: true }),
      rec("run-1", "/file.txt", { word_count: null, content_type: "text/plain", errors: [{ code: "NOT_HTML", message: "not HTML", retryable: false }] }),
      rec("run-1", "/gone", { status: 404, word_count: null, errors: [{ code: "NOT_FOUND", message: "HTTP 404", retryable: false }] }),
    ].join("\n"), null);

    expect(urlsNeedingRender(store, "s1", "run-1")).toEqual(["https://example.com/shell"]);
  });
});
