import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestCrawlJsonl } from "../ingest/crawl.js";
import { ingestSitemapJsonl } from "../ingest/sitemap.js";
import { deriveCrawlObservations, ingestAccessReport } from "../ingest/geo.js";
import { buildGeoReport } from "./geo-audit.js";

const RUN = readFileSync(new URL("../../tests/fixtures/geo/site-run.jsonl", import.meta.url), "utf8");
const ACCESS = readFileSync(new URL("../../tests/fixtures/geo/access.json", import.meta.url), "utf8");
const SITE_ID = "site-1";
const ORIGIN = "https://example.com";

let dir: string;
let store: Store;
let runId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-geo-"));
  store = openStore(join(dir, "geo.sqlite"));
  upsertSite(store, { id: SITE_ID, name: "Example", canonicalOrigin: ORIGIN, sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
  runId = JSON.parse(RUN.split("\n")[0] as string).run_id as string;
  ingestCrawlJsonl(store, SITE_ID, RUN, null);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const metricRows = (metric: string) =>
  store.sqlite
    .prepare("SELECT entity_id AS url, value FROM observations WHERE source = 'crawl' AND metric = ?")
    .all(metric) as { url: string; value: number }[];
const count = () => (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'crawl'").get() as { n: number }).n;

describe("deriveCrawlObservations", () => {
  it("writes measured page values and keeps syntax errors apart from missing properties", () => {
    deriveCrawlObservations(store, SITE_ID, runId);

    const syntax = metricRows("jsonld_syntax_errors").filter((r) => r.value > 0).map((r) => r.url);
    expect(syntax).toEqual([`${ORIGIN}/bad-jsonld.html`]);
    expect(metricRows("missing_recommended_props").find((r) => r.url === `${ORIGIN}/jsonld.html`)?.value).toBeGreaterThan(0);
    expect(metricRows("robots_blocked").find((r) => r.url === `${ORIGIN}/private/secret.html`)?.value).toBe(1);
    expect(metricRows("h1_count").find((r) => r.url === `${ORIGIN}/index.html`)?.value).toBe(1);
    expect(metricRows("heading_skip").find((r) => r.url === `${ORIGIN}/bad-jsonld.html`)?.value).toBe(1);
  });

  it("is idempotent: deriving the same run again does not add observations", () => {
    deriveCrawlObservations(store, SITE_ID, runId);
    const first = count();

    deriveCrawlObservations(store, SITE_ID, runId);

    expect(count()).toBe(first);
  });

  it("does not record a value for robots-unknown pages", () => {
    store.sqlite.prepare("UPDATE crawl_results SET robots_allowed = NULL WHERE final_url = ?").run(`${ORIGIN}/private/secret.html`);

    deriveCrawlObservations(store, SITE_ID, runId);

    expect(metricRows("robots_blocked").some((r) => r.url === `${ORIGIN}/private/secret.html`)).toBe(false);
  });
});

describe("ingestAccessReport", () => {
  it("records AI crawler blocks with the sampled URLs as evidence", () => {
    ingestAccessReport(store, SITE_ID, ACCESS);

    const gpt = store.sqlite
      .prepare("SELECT value, dimensions_json FROM observations WHERE metric = 'ai_blocked_urls' AND dimensions_json LIKE '%GPTBot%'")
      .get() as { value: number; dimensions_json: string };
    expect(gpt.value).toBe(9);
    expect(JSON.parse(gpt.dimensions_json).sample_size).toBe(9);
    expect(metricRows("robots_readable")[0]?.value).toBe(1);
    expect(metricRows("llms_txt_valid")[0]?.value).toBe(1);
  });

  it("rejects an access report that does not match the expected shape", () => {
    expect(() => ingestAccessReport(store, SITE_ID, JSON.stringify({ data: { siteRoot: "x" } }))).toThrow();
  });
});

describe("buildGeoReport", () => {
  it("reports measured and inferred findings, each with evidence, and lists syntax errors separately", () => {
    deriveCrawlObservations(store, SITE_ID, runId);
    ingestAccessReport(store, SITE_ID, ACCESS);

    const report = buildGeoReport(store, { siteId: SITE_ID, origin: ORIGIN, runId });

    expect(report).toContain("AI crawler GPTBot is blocked on 9 of 9 sampled URLs");
    expect(report).toMatch(/### 1 page\(s\) with invalid JSON-LD[\s\S]*Basis: measured/);
    expect(report).toMatch(/### \d+ page\(s\) under 300 words[\s\S]*Basis: inferred/);
    expect(report).toContain("Syntax errors (JSON-LD does not parse):\n- https://example.com/bad-jsonld.html");
    expect(report).toContain("## Evidence check");
    expect(report).toMatch(/Dropped: 0\./);
  });

  it("says crawler access was not checked when no access report was ingested", () => {
    deriveCrawlObservations(store, SITE_ID, runId);

    const report = buildGeoReport(store, { siteId: SITE_ID, origin: ORIGIN, runId });

    expect(report).toContain("AI crawler access: not checked.");
    expect(report).toContain("- AI crawler access and llms.txt: not checked.");
    expect(report).not.toContain("AI crawler GPTBot is blocked");
  });

  it("says the crawl covers fewer URLs than the sitemap when the run was capped", () => {
    // Given: the sitemap lists 12 URLs, but the run fetched only 9
    const sitemapLines = Array.from({ length: 12 }, (_, i) =>
      JSON.stringify({ run_id: "sm-1", collected_at: "2026-11-05T09:00:00.000Z", url: `https://example.com/p${i}`, lastmod: null, sitemap_url: "https://example.com/sitemap.xml" }),
    ).join("\n");
    ingestSitemapJsonl(store, SITE_ID, sitemapLines);
    deriveCrawlObservations(store, SITE_ID, runId);

    // When
    const report = buildGeoReport(store, { siteId: SITE_ID, origin: ORIGIN, runId });

    // Then
    expect(report).toContain("- Crawl covers 9 of 12 sitemap URL(s) (URL cap 500). Findings describe the fetched pages only.");
  });

  it("warns that the sitemap may be truncated when its URL count equals the URL cap", () => {
    // Given: 12 sitemap URLs ingested and the site cap is 12 (discovery stopped at the cap)
    store.sqlite.prepare("UPDATE sites SET url_cap = 12").run();
    const sitemapLines = Array.from({ length: 12 }, (_, i) =>
      JSON.stringify({ run_id: "sm-1", collected_at: "2026-11-05T09:00:00.000Z", url: `https://example.com/p${i}`, lastmod: null, sitemap_url: "https://example.com/sitemap.xml" }),
    ).join("\n");
    ingestSitemapJsonl(store, SITE_ID, sitemapLines);
    deriveCrawlObservations(store, SITE_ID, runId);

    // When
    const report = buildGeoReport(store, { siteId: SITE_ID, origin: ORIGIN, runId });

    // Then
    expect(report).toContain("- Sitemap: 12 URLs equals the URL cap (12). The sitemap may be truncated, so findings cover only the discovered URLs.");
  });

  it("does not count a product page without a byline as missing an author or a date", () => {
    // Given: a product page with a Product node and no author or date
    const productRun = JSON.stringify({
      run_id: "product-run", fetched_at: "2026-11-05T10:00:00.000Z", url: "https://example.com/urun", status: 200,
      final_url: "https://example.com/urun", redirect_chain: [], content_type: "text/html", title: "Urun",
      meta_description: null, canonical: "https://example.com/urun", lang: "tr", hreflang: [],
      headings: [{ level: 1, text: "Urun" }], word_count: 400, content_hash: "sha256:y",
      structured_data: [{ syntax: "json-ld", type: "Product", item: { "@context": "https://schema.org", "@type": "Product", name: "Urun" } }],
      jsonld_syntax_errors: 0, robots_allowed: true, raw_html_path: null, errors: [],
    });
    ingestCrawlJsonl(store, SITE_ID, productRun, null);
    deriveCrawlObservations(store, SITE_ID, "product-run");

    // When / Then: no author or date observation is written for it
    const count = (metric: string) =>
      (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'crawl' AND metric = ? AND entity_id = ?").get(metric, "https://example.com/urun") as { n: number }).n;
    expect(count("has_author")).toBe(0);
    expect(count("has_date")).toBe(0);
  });

  it("reads author, date and FAQPage signals from nodes inside a JSON-LD @graph", () => {
    // Given: one page whose author, date and FAQPage are nested in "@graph" (the layout BulmacaLig uses)
    const graphRun = JSON.stringify({
      run_id: "graph-run", fetched_at: "2026-11-05T10:00:00.000Z", url: "https://example.com/faq", status: 200,
      final_url: "https://example.com/faq", redirect_chain: [], content_type: "text/html", title: "FAQ",
      meta_description: null, canonical: "https://example.com/faq", lang: "tr", hreflang: [],
      headings: [{ level: 1, text: "SSS" }], word_count: 400, content_hash: "sha256:x",
      structured_data: [{ syntax: "json-ld", type: null, item: { "@context": "https://schema.org", "@graph": [
        { "@type": "Article", author: { "@id": "https://example.com/#org" }, datePublished: "2026-01-01" },
        { "@type": "FAQPage", mainEntity: [] },
      ] } }],
      jsonld_syntax_errors: 0, robots_allowed: true, raw_html_path: null, errors: [],
    });
    ingestCrawlJsonl(store, SITE_ID, graphRun, null);
    deriveCrawlObservations(store, SITE_ID, "graph-run");

    // When / Then: the page is read as having an author, a date and FAQPage
    const value = (metric: string) =>
      (store.sqlite.prepare("SELECT value FROM observations WHERE source = 'crawl' AND metric = ? AND entity_id = ?").get(metric, "https://example.com/faq") as { value: number }).value;
    expect(value("has_author")).toBe(1);
    expect(value("has_date")).toBe(1);
    expect(value("has_faqpage")).toBe(1);
    expect(value("structured_items")).toBe(1); // the count stays the number of top-level blocks
  });

  it("reports the measured page counts from the run", () => {
    deriveCrawlObservations(store, SITE_ID, runId);

    const report = buildGeoReport(store, { siteId: SITE_ID, origin: ORIGIN, runId });

    expect(report).toContain("- Pages with a crawl record: 9");
    expect(report).toContain("- Pages with FAQPage markup: 0 of 9.");
  });
});

describe("re-deriving after a rule change", () => {
  it("removes an author value stored by an earlier derivation when the page is no longer an article", () => {
    // Given: a product page whose author observation was stored by an earlier derivation
    const productRun = JSON.stringify({
      run_id: "stale-run", fetched_at: "2026-11-05T10:00:00.000Z", url: "https://example.com/p", status: 200,
      final_url: "https://example.com/p", redirect_chain: [], content_type: "text/html", title: "P",
      meta_description: null, canonical: "https://example.com/p", lang: "tr", hreflang: [],
      headings: [{ level: 1, text: "P" }], word_count: 400, content_hash: "sha256:z",
      structured_data: [{ syntax: "json-ld", type: "Product", item: { "@context": "https://schema.org", "@type": "Product", name: "P" } }],
      jsonld_syntax_errors: 0, robots_allowed: true, raw_html_path: null, errors: [],
    });
    ingestCrawlJsonl(store, SITE_ID, productRun, null);
    store.sqlite.prepare(
      "INSERT INTO observations (id, site_id, source, entity_type, entity_id, metric, value, collected_at, freshness, dimensions_json, provenance_json) VALUES (?, ?, 'crawl', 'page', ?, 'has_author', 0, '2026-11-05T10:00:00.000Z', 'snapshot', '{}', '{}')",
    ).run(createHash("sha256").update([SITE_ID, "crawl", "has_author", "page", "https://example.com/p", "stale-run"].join("|")).digest("hex"), SITE_ID, "https://example.com/p");

    // When: the page is derived again under the current rules
    deriveCrawlObservations(store, SITE_ID, "stale-run");

    // Then: the stale has_author value is gone
    const left = store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'crawl' AND metric = 'has_author' AND entity_id = ?").get("https://example.com/p") as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("access results stored more than once", () => {
  it("lists each AI crawler once, using the most recently ingested access result", () => {
    // Given: a crawl run and two access results for the same site (40 and 9 sampled URLs in the fixture shape)
    deriveCrawlObservations(store, SITE_ID, runId);
    ingestAccessReport(store, SITE_ID, ACCESS);
    const newer = JSON.parse(ACCESS);
    newer.data.sampleSize = 5;
    for (const agent of newer.data.agents) {
      agent.blocked = 0;
      agent.blocked_urls = [];
    }
    ingestAccessReport(store, SITE_ID, JSON.stringify(newer));

    // When
    const report = buildGeoReport(store, { siteId: SITE_ID, origin: ORIGIN, runId });

    // Then: GPTBot appears once, with the newer sample size
    const gpt = report.split("\n").filter((l) => l.startsWith("- GPTBot:"));
    expect(gpt).toEqual(["- GPTBot: blocked 0 of 5"]);
    expect(report.match(/- GPTBot:/g)?.length).toBe(1);
  });
});
