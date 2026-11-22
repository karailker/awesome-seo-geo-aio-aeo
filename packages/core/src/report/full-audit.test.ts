import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestCrawlJsonl } from "../ingest/crawl.js";
import { deriveCrawlObservations, ingestAccessReport } from "../ingest/geo.js";
import { ingestGscJsonl } from "../ingest/gsc.js";
import { buildFullAudit } from "./full-audit.js";

const RUN = readFileSync(new URL("../../tests/fixtures/geo/site-run.jsonl", import.meta.url), "utf8");
const ACCESS = readFileSync(new URL("../../tests/fixtures/geo/access.json", import.meta.url), "utf8");
const GSC = readFileSync(new URL("../../tests/fixtures/gsc/period-run.jsonl", import.meta.url), "utf8");
const SITE_ID = "site-1";
const ORIGIN = "https://example.com";
const runId = JSON.parse(RUN.split("\n")[0] as string).run_id as string;

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-full-"));
  store = openStore(join(dir, "full.sqlite"));
  upsertSite(store, { id: SITE_ID, name: "Example", canonicalOrigin: ORIGIN, sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
  ingestCrawlJsonl(store, SITE_ID, RUN, null);
  ingestAccessReport(store, SITE_ID, ACCESS);
  deriveCrawlObservations(store, SITE_ID, runId);
  ingestGscJsonl(store, SITE_ID, GSC);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const base = { siteId: SITE_ID, origin: ORIGIN, runId, mode: "deep" as const, periodStart: "2026-10-01", periodEnd: "2026-10-31" };
const section = (text: string, heading: string) => {
  const start = text.indexOf(`## ${heading}`);
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next === -1 ? undefined : next);
};

describe("buildFullAudit", () => {
  it("puts the findings and facts of every report in one ranked list, highest severity first", () => {
    const { report, attention } = buildFullAudit(store, base);

    const ranks = attention.map((a) => ({ high: 0, medium: 1, low: 2, info: 3 })[a.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(attention.some((a) => a.source === "geo")).toBe(true);
    expect(attention.some((a) => a.source === "seo")).toBe(true);
    expect(attention.some((a) => a.source === "technical")).toBe(true);
    expect(section(report, "Needs attention")).toMatch(/^- \[(high|medium|low|info)\] /m);
  });

  it("states the mode and the run, and says a quick check describes a sample", () => {
    const deep = buildFullAudit(store, base).report;
    const quick = buildFullAudit(store, { ...base, mode: "quick" }).report;

    expect(section(deep, "Scope")).toContain("- Mode: deep.");
    expect(section(quick, "Scope")).toContain("- Mode: quick. The results describe a sample of the site, not all of it.");
    expect(section(deep, "Scope")).toContain(`- Crawl run: ${runId}`);
  });

  it("collects the Missing data lines of every report once, with the report each came from", () => {
    const report = buildFullAudit(store, base).report;
    const missing = section(report, "Missing data");

    expect(missing).toMatch(/- \(seo\) Bing Webmaster: no data for this site\./);
    expect(missing.match(/Bing Webmaster: no data for this site\./g)?.length).toBe(1);
  });

  it("says the SEO part is missing when no period is given, and still reports the crawl", () => {
    const { report, attention } = buildFullAudit(store, { ...base, periodStart: undefined, periodEnd: undefined });

    expect(section(report, "Missing data")).toContain("- (seo) Search Console, GA4, Bing and Yandex: no period given, so the search part was not built.");
    expect(attention.some((a) => a.source === "seo")).toBe(false);
    expect(attention.some((a) => a.source === "geo")).toBe(true);
  });

  it("includes the full reports after the summary", () => {
    const { report } = buildFullAudit(store, base);

    expect(report).toContain("# Technical audit: https://example.com");
    expect(report).toContain("# GEO / AIO / AEO audit: https://example.com");
    expect(report).toContain("# SEO audit: https://example.com");
  });
});
