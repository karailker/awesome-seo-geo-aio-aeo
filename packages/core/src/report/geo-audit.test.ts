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

  it("reports the measured page counts from the run", () => {
    deriveCrawlObservations(store, SITE_ID, runId);

    const report = buildGeoReport(store, { siteId: SITE_ID, origin: ORIGIN, runId });

    expect(report).toContain("- Pages with a crawl record: 9");
    expect(report).toContain("- Pages with FAQPage markup: 0 of 9.");
  });
});
