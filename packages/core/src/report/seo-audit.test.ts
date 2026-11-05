import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateFindings, type Finding } from "../analysis/evidence.js";
import { reconcileSitemapWithGsc } from "../analysis/reconcile.js";
import { ingestGscJsonl } from "../ingest/gsc.js";
import { openStore, upsertPage, upsertSite, type Store } from "../db/store.js";
import { buildSeoAuditReport } from "./seo-audit.js";

const GSC = readFileSync(new URL("../../tests/fixtures/gsc/period-run.jsonl", import.meta.url), "utf8");
const SITE_ID = "site-1";
const PERIOD = { periodStart: "2026-10-01", periodEnd: "2026-10-31" };
const INPUT = { siteId: SITE_ID, origin: "https://example.com", ...PERIOD };

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-report-"));
  store = openStore(join(dir, "report.sqlite"));
  upsertSite(store, {
    id: SITE_ID,
    name: "Example",
    canonicalOrigin: "https://example.com",
    sitemapUrl: null,
    urlCap: 500,
    createdAt: "2026-11-05T09:00:00.000Z",
  });
  for (const path of ["a", "b", "d"]) {
    upsertPage(store, {
      id: `page-${path}`,
      siteId: SITE_ID,
      url: `https://example.com/${path}`,
      source: "sitemap",
      lastmod: null,
      firstSeenAt: "2026-11-05T10:00:00.000Z",
      lastSeenAt: "2026-11-05T10:00:00.000Z",
    });
  }
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const countObservations = () =>
  (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations").get() as { n: number }).n;

describe("ingestGscJsonl", () => {
  it("writes four observations per row and keeps them when re-ingested", () => {
    const first = ingestGscJsonl(store, SITE_ID, GSC);
    expect(first).toMatchObject({ lines: 6, ingested: 6, skipped: 0 });
    expect(countObservations()).toBe(24);

    ingestGscJsonl(store, SITE_ID, GSC);
    expect(countObservations()).toBe(24);
  });

  it("updates a value when the same period is re-collected", () => {
    ingestGscJsonl(store, SITE_ID, GSC);
    const updated = GSC.replace('"clicks":15', '"clicks":21');

    ingestGscJsonl(store, SITE_ID, updated);

    const row = store.sqlite
      .prepare("SELECT value FROM observations WHERE source = 'gsc' AND entity_id = ? AND metric = 'clicks'")
      .get("https://example.com/b") as { value: number };
    expect(row.value).toBe(21);
  });
});

describe("reconcileSitemapWithGsc", () => {
  it("lists URLs present in only one of sitemap and Search Console", () => {
    ingestGscJsonl(store, SITE_ID, GSC);

    const recon = reconcileSitemapWithGsc(store, SITE_ID, PERIOD.periodStart, PERIOD.periodEnd);

    expect(recon.sitemapOnly).toEqual(["https://example.com/d"]);
    expect(recon.gscOnly).toEqual(["https://example.com/c"]);
    expect(recon.both).toBe(2);
  });
});

describe("buildSeoAuditReport", () => {
  it("reports findings with evidence and drops none that cite valid observations", () => {
    ingestGscJsonl(store, SITE_ID, GSC);

    const report = buildSeoAuditReport(store, INPUT);

    expect(report).toContain("### 1 page(s) with at least 50 impressions and zero clicks");
    expect(report).toContain("### 1 query(ies) ranking at positions 8-20 with 100+ impressions");
    expect(report).toContain("Candidate findings: 2. Kept: 2. Dropped: 0.");
    expect(report).toContain("In sitemap, no Search Console page data for this period (1):");
    expect(report).toContain("https://example.com/d");
  });

  it("flags a sitemap that hit the URL cap as possibly truncated", () => {
    store.sqlite.prepare("UPDATE sites SET url_cap = 3").run(); // beforeEach ingests 3 sitemap pages

    const report = buildSeoAuditReport(store, INPUT);

    expect(report).toContain("3 URLs equals the URL cap (3). The sitemap may be truncated");
  });

  it("states Search Console is not available and reports no findings without rows", () => {
    const report = buildSeoAuditReport(store, INPUT);

    expect(report).toContain("Search Console: not available for this period.");
    expect(report).toContain("No findings: Search Console data is not available.");
    expect(report).toContain("Not available: Search Console page data is missing for this period.");
  });
});

describe("validateFindings (evidence gate)", () => {
  const base: Finding = {
    id: "f",
    title: "t",
    severity: "low",
    confidence: "high",
    description: "d",
    affectedCount: 1,
    evidenceIds: [],
  };

  it("drops findings without evidence and findings citing unknown observations", () => {
    ingestGscJsonl(store, SITE_ID, GSC);
    const realId = (store.sqlite.prepare("SELECT id FROM observations LIMIT 1").get() as { id: string }).id;

    const { valid, problems } = validateFindings(store, SITE_ID, [
      { ...base, id: "none", evidenceIds: [] },
      { ...base, id: "ghost", evidenceIds: ["does-not-exist"] },
      { ...base, id: "good", evidenceIds: [realId] },
    ]);

    expect(valid.map((f) => f.id)).toEqual(["good"]);
    expect(problems).toEqual(["none: no evidence", "ghost: 1 evidence id(s) not found for this site"]);
  });
});
