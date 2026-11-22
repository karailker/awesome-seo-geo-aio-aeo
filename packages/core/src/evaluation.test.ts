// Evaluation (docs/EVALUATION.md): runs the GEO and SEO reports on the golden dataset and compares the findings with
// the hand-written expected sets. Reports precision and recall per finding category, checks that every finding has
// evidence, and checks that a second run gives identical results. Run with: corepack pnpm evaluate
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "./db/store.js";
import { ingestCrawlJsonl } from "./ingest/crawl.js";
import { deriveCrawlObservations, ingestAccessReport } from "./ingest/geo.js";
import { ingestGscJsonl } from "./ingest/gsc.js";
import { buildGeoAudit } from "./report/geo-audit.js";
import { buildSeoAudit } from "./report/seo-audit.js";
import type { Finding } from "./analysis/evidence.js";

type GoldenPage = {
  path: string;
  words: number | null;
  headings: number[];
  structured?: { type: string | null; item: Record<string, unknown> }[];
  status?: number | null;
  contentType?: string;
  rendered?: boolean;
  jsonldErrors?: number;
  robots?: boolean;
  errors?: { code: string; message: string; retryable: boolean }[];
};
type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };
type Golden = {
  origin: string;
  pages: GoldenPage[];
  access: { agents: unknown[]; sampleSize: number; llmsTxt: { present: boolean; valid: boolean } };
  gsc: { period: [string, string]; pages: GscRow[]; queries: GscRow[] };
  expected: { geo: Record<string, string[]>; seo: Record<string, string[]> };
};

const GOLDEN = JSON.parse(readFileSync(new URL("../tests/evaluation/golden.json", import.meta.url), "utf8")) as Golden;
const SITE_ID = "golden-site";
const RUN = "golden-run";
const THRESHOLD = 1; // the rules are deterministic: any miss or extra finding is a defect (docs/EVALUATION.md)

const crawlRecord = (p: GoldenPage): string =>
  JSON.stringify({
    run_id: RUN, fetched_at: "2026-11-05T10:00:00.000Z", url: GOLDEN.origin + p.path, status: p.status === undefined ? 200 : p.status,
    final_url: GOLDEN.origin + p.path, redirect_chain: [], content_type: p.contentType ?? "text/html", title: "T", meta_description: null,
    canonical: GOLDEN.origin + p.path, lang: "en", hreflang: [], headings: p.headings.map((level) => ({ level, text: "h" })),
    word_count: p.words, content_hash: `sha256:${p.path}`, structured_data: (p.structured ?? []).map((s) => ({ syntax: "json-ld", ...s })),
    jsonld_syntax_errors: p.jsonldErrors ?? 0, robots_allowed: p.robots ?? true, raw_html_path: null, rendered: p.rendered ?? false, errors: p.errors ?? [],
  });

const gscLine = (dimension: "page" | "query", r: GscRow): string =>
  JSON.stringify({
    run_id: "golden-gsc", collected_at: "2026-11-05T10:00:00.000Z", site: "sc-domain:golden.example", period_start: GOLDEN.gsc.period[0],
    period_end: GOLDEN.gsc.period[1], dimensions: { [dimension]: r.key }, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
  });

type Result = { geo: Record<string, string[]>; seo: Record<string, string[]>; reports: string[]; evidence: { id: string; count: number }[]; dropped: string[] };

function runOnce(): Result {
  const dir = mkdtempSync(join(tmpdir(), "core-eval-"));
  const store: Store = openStore(join(dir, "eval.sqlite"));
  try {
    upsertSite(store, { id: SITE_ID, name: "Golden", canonicalOrigin: GOLDEN.origin, sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
    ingestCrawlJsonl(store, SITE_ID, GOLDEN.pages.map(crawlRecord).join("\n"), null);
    ingestAccessReport(store, SITE_ID, JSON.stringify({ data: { siteRoot: GOLDEN.origin, robots: "readable", sampleSize: GOLDEN.access.sampleSize, agents: GOLDEN.access.agents, llmsTxt: GOLDEN.access.llmsTxt } }));
    deriveCrawlObservations(store, SITE_ID, RUN);
    ingestGscJsonl(store, SITE_ID, [...GOLDEN.gsc.pages.map((r) => gscLine("page", r)), ...GOLDEN.gsc.queries.map((r) => gscLine("query", r))].join("\n"));

    const geo = buildGeoAudit(store, { siteId: SITE_ID, origin: GOLDEN.origin, runId: RUN });
    const seo = buildSeoAudit(store, { siteId: SITE_ID, origin: GOLDEN.origin, periodStart: GOLDEN.gsc.period[0], periodEnd: GOLDEN.gsc.period[1] });

    // A finding's affected set: the entities of the observations it cites.
    const entityOf = store.sqlite.prepare("SELECT entity_id AS e FROM observations WHERE id = ? AND site_id = ?");
    const sets = (findings: Finding[], strip: boolean): Record<string, string[]> =>
      Object.fromEntries(
        findings.map((f) => [
          f.id,
          [...new Set(f.evidenceIds.map((id) => (entityOf.get(id, SITE_ID) as { e: string }).e))]
            .map((e) => (e === GOLDEN.origin ? "SITE" : strip && e.startsWith(GOLDEN.origin) ? e.slice(GOLDEN.origin.length) : e))
            .sort(),
        ]),
      );

    return {
      geo: sets(geo.findings, true),
      seo: sets(seo.findings, false),
      reports: [geo.report, seo.report],
      evidence: [...geo.findings, ...seo.findings].map((f) => ({ id: f.id, count: f.evidenceIds.length })),
      dropped: [...geo.dropped, ...seo.dropped],
    };
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

type Score = { category: string; tp: number; fp: number; fn: number; precision: number; recall: number };

function score(expected: Record<string, string[]>, actual: Record<string, string[]>): Score[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort().map((category) => {
    const want = new Set(expected[category] ?? []);
    const got = new Set(actual[category] ?? []);
    const tp = [...got].filter((x) => want.has(x)).length;
    const fp = got.size - tp;
    const fn = want.size - tp;
    return { category, tp, fp, fn, precision: got.size === 0 ? (want.size === 0 ? 1 : 0) : tp / got.size, recall: want.size === 0 ? 1 : tp / want.size };
  });
}

const first = runOnce();
const scores = [...score(GOLDEN.expected.geo, first.geo), ...score(GOLDEN.expected.seo, first.seo)];

describe("evaluation on the golden dataset", () => {
  it("prints precision and recall per finding category", () => {
    const rows = scores.map((s) => `${s.category.padEnd(32)} tp ${s.tp}  fp ${s.fp}  fn ${s.fn}  precision ${s.precision.toFixed(2)}  recall ${s.recall.toFixed(2)}`);
    console.log(`\nEvaluation: ${scores.length} finding categories, ${GOLDEN.pages.length} pages, ${GOLDEN.gsc.pages.length} Search Console pages, ${GOLDEN.gsc.queries.length} queries\n${rows.join("\n")}\n`);
    expect(scores.length).toBeGreaterThan(0);
  });

  it.each(scores.map((s) => [s.category, s] as const))("%s: precision and recall are at least the documented threshold", (_category, s) => {
    expect({ precision: s.precision, recall: s.recall, fp: s.fp, fn: s.fn }).toEqual({ precision: THRESHOLD, recall: THRESHOLD, fp: 0, fn: 0 });
  });

  it("gives every finding at least one piece of evidence and drops none", () => {
    expect(first.evidence.length).toBeGreaterThan(0);
    expect(first.evidence.filter((e) => e.count === 0)).toEqual([]);
    expect(first.dropped).toEqual([]);
  });

  it("gives the same findings and the same reports when run again", () => {
    const second = runOnce();

    expect(second.geo).toEqual(first.geo);
    expect(second.seo).toEqual(first.seo);
    expect(second.reports).toEqual(first.reports);
  });
});
