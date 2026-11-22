import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "./db/store.js";
import { readSearchPages, uncrawledUrls } from "./gsc-urls.js";
import { ingestCrawlJsonl } from "./ingest/crawl.js";

const line = (page: unknown) => JSON.stringify({ run_id: "r", collected_at: "2026-11-05T00:00:00Z", site: "sc-domain:example.com", period_start: "2026-11-01", period_end: "2026-11-05", dimensions: { page }, clicks: 1, impressions: 5, ctr: 0.2, position: 3 });

describe("readSearchPages", () => {
  it("returns each page once, normalised, and skips lines that are not Search Console page rows", () => {
    const text = [line("https://example.com/a#top"), line("https://example.com/a"), line("ftp://example.com/x"), "not json", JSON.stringify({ dimensions: { query: "q" } }), line("https://www.example.com/b")].join("\n");

    expect(readSearchPages([text])).toEqual(["https://example.com/a", "https://www.example.com/b"]);
  });
});

describe("uncrawledUrls", () => {
  let dir: string;
  let store: Store;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "core-gscurls-"));
    store = openStore(join(dir, "g.sqlite"));
    upsertSite(store, { id: "s1", name: "Example", canonicalOrigin: "https://example.com", sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps only the URLs that no crawl run of the site fetched", () => {
    // Given: one crawled page
    const crawled = JSON.stringify({
      run_id: "run-1", fetched_at: "2026-11-05T10:00:00.000Z", url: "https://example.com/a", status: 200, final_url: "https://example.com/a",
      redirect_chain: [], content_type: "text/html", title: "A", meta_description: null, canonical: "https://example.com/a", lang: "tr", hreflang: [],
      headings: [], word_count: 1, content_hash: "x", structured_data: [], jsonld_syntax_errors: 0, robots_allowed: true, raw_html_path: null, errors: [],
    });
    ingestCrawlJsonl(store, "s1", crawled, null);

    // When
    const result = uncrawledUrls(store, "s1", ["https://example.com/a", "https://example.com/b", "https://www.example.com/c"]);

    // Then
    expect(result).toEqual(["https://example.com/b", "https://www.example.com/c"]);
  });
});
