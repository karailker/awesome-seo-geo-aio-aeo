// SEO audit report for one period, Search Console only (ROADMAP P3). English output.
// Every finding cites observation ids; findings that fail the evidence gate are dropped and listed.
import { validateFindings, type Finding } from "../analysis/evidence.js";
import { reconcileSitemapWith, SOURCE_LABEL, type Reconciliation, type SearchSource } from "../analysis/reconcile.js";
import { isAiReferrer } from "../analysis/ai-referrers.js";
import type { Store } from "../db/store.js";

// Project-defined thresholds, not official ranking factors (CLAUDE.md rule 10). Move to docs/SCORING.md when written.
export const ZERO_CLICK_MIN_IMPRESSIONS = 50;
export const STRIKING_MIN_POSITION = 8;
export const STRIKING_MAX_POSITION = 20;
export const STRIKING_MIN_IMPRESSIONS = 100;

const LIST_CAP = 20;

export type ReportInput = {
  siteId: string;
  origin: string;
  periodStart: string;
  periodEnd: string;
};

type Cell = { id: string; value: number };
type Entity = Partial<Record<"clicks" | "impressions" | "ctr" | "position", Cell>>;

function loadEntities(store: Store, input: ReportInput): { pages: Map<string, Entity>; queries: Map<string, Entity>; rowCount: number; lastCollected: string | null } {
  const rows = store.sqlite
    .prepare(
      `SELECT id, entity_type AS entityType, entity_id AS entityId, metric, value, collected_at AS collectedAt
       FROM observations WHERE site_id = ? AND source = 'gsc' AND period_start = ? AND period_end = ?`,
    )
    .all(input.siteId, input.periodStart, input.periodEnd) as {
    id: string;
    entityType: string;
    entityId: string;
    metric: "clicks" | "impressions" | "ctr" | "position";
    value: number;
    collectedAt: string;
  }[];

  const pages = new Map<string, Entity>();
  const queries = new Map<string, Entity>();
  let lastCollected: string | null = null;
  for (const row of rows) {
    if (lastCollected === null || row.collectedAt > lastCollected) lastCollected = row.collectedAt;
    const target = row.entityType === "page" ? pages : row.entityType === "query" ? queries : null;
    if (!target) continue;
    const entity = target.get(row.entityId) ?? {};
    entity[row.metric] = { id: row.id, value: row.value };
    target.set(row.entityId, entity);
  }
  return { pages, queries, rowCount: rows.length, lastCollected };
}

function findingsFrom(pages: Map<string, Entity>, queries: Map<string, Entity>): Finding[] {
  const zeroClick: { url: string; ids: string[] }[] = [];
  for (const [url, e] of pages) {
    if (e.impressions && e.clicks && e.impressions.value >= ZERO_CLICK_MIN_IMPRESSIONS && e.clicks.value === 0) {
      zeroClick.push({ url, ids: [e.impressions.id, e.clicks.id] });
    }
  }

  const striking: { q: string; ids: string[] }[] = [];
  for (const [q, e] of queries) {
    if (
      e.position && e.impressions &&
      e.position.value >= STRIKING_MIN_POSITION && e.position.value <= STRIKING_MAX_POSITION &&
      e.impressions.value >= STRIKING_MIN_IMPRESSIONS
    ) {
      striking.push({ q, ids: [e.position.id, e.impressions.id] });
    }
  }

  const findings: Finding[] = [];
  if (zeroClick.length > 0) {
    findings.push({
      id: "gsc-zero-click-pages",
      title: `${zeroClick.length} page(s) with at least ${ZERO_CLICK_MIN_IMPRESSIONS} impressions and zero clicks`,
      severity: "medium",
      confidence: "high",
      description: "Pages appear in search results but received no clicks in the period. Project threshold; direct Search Console data.",
      affectedCount: zeroClick.length,
      evidenceIds: zeroClick.flatMap((p) => p.ids),
    });
  }
  if (striking.length > 0) {
    findings.push({
      id: "gsc-striking-distance-queries",
      title: `${striking.length} query(ies) ranking at positions ${STRIKING_MIN_POSITION}-${STRIKING_MAX_POSITION} with ${STRIKING_MIN_IMPRESSIONS}+ impressions`,
      severity: "low",
      confidence: "high",
      description: "Queries close to the first page with meaningful demand. Project threshold; direct Search Console data.",
      affectedCount: striking.length,
      evidenceIds: striking.flatMap((q) => q.ids),
    });
  }
  return findings;
}

function list(items: string[]): string {
  const shown = items.slice(0, LIST_CAP).map((u) => `- ${u}`);
  if (items.length > LIST_CAP) shown.push(`- ... and ${items.length - LIST_CAP} more`);
  return shown.length > 0 ? shown.join("\n") : "- none";
}

export function buildSeoAuditReport(store: Store, input: ReportInput): string {
  const { pages, queries, rowCount, lastCollected } = loadEntities(store, input);
  const gscAvailable = rowCount > 0;
  const sitemap = store.sqlite
    .prepare("SELECT COUNT(*) AS n, MAX(last_seen_at) AS seen FROM pages WHERE site_id = ? AND source = 'sitemap'")
    .get(input.siteId) as { n: number; seen: string | null };

  const traffic = ga4TrafficSection(store, input);
  const candidates = [...(gscAvailable ? findingsFrom(pages, queries) : []), ...(traffic.aiFinding ? [traffic.aiFinding] : [])];
  const { valid, problems } = validateFindings(store, input.siteId, candidates);
  const recons: Reconciliation[] = (["gsc", "bing", "yandex"] as SearchSource[]).map((src) => reconcileSitemapWith(store, input.siteId, src, input.periodStart, input.periodEnd));
  const recon = recons[0]!;

  const missing: string[] = [];
  if (!gscAvailable) missing.push("Search Console: no rows for this period. No findings from Search Console are reported.");
  if (sitemap.n === 0) missing.push("Sitemap: no URLs ingested. Run /sitemap-sync first.");
  const cap = store.sqlite.prepare("SELECT url_cap AS cap FROM sites WHERE id = ?").get(input.siteId) as { cap: number } | undefined;
  if (sitemap.n > 0 && cap && sitemap.n >= cap.cap) {
    missing.push(`Sitemap: ${sitemap.n} URLs equals the URL cap (${cap.cap}). The sitemap may be truncated, so reconciliation is partial.`);
  }
  if (gscAvailable && recon.sourcePageCount === 0) missing.push("Search Console: no page-level rows. Reconciliation is not possible.");

  const sections: string[] = [
    `# SEO audit: ${input.origin}`,
    "",
    "## Scope",
    `- Site: ${input.origin}`,
    `- Period: ${input.periodStart} to ${input.periodEnd}`,
    "- Sources in this report: Google Search Console, sitemap. Not included yet: GA4, Bing, Yandex, crawl, performance.",
    "",
    "## Data sources and date ranges",
    gscAvailable
      ? `- Search Console: ${rowCount} observations for ${input.periodStart} to ${input.periodEnd}. Freshness: delayed. Last collected: ${lastCollected}.`
      : "- Search Console: not available for this period.",
    sitemap.n > 0
      ? `- Sitemap: ${sitemap.n} URL(s), last seen ${sitemap.seen}.`
      : "- Sitemap: not available.",
    "",
    "## Missing data",
    ...(missing.length > 0 ? missing.map((m) => `- ${m}`) : ["- none"]),
    "",
    "## Findings",
  ];

  if (valid.length === 0) {
    sections.push(gscAvailable ? "No findings met the project thresholds." : "No findings: Search Console data is not available.");
  }
  for (const f of valid) {
    sections.push(
      `### ${f.title}`,
      `- Severity: ${f.severity}. Confidence: ${f.confidence}. Affected: ${f.affectedCount}.`,
      `- ${f.description}`,
      `- Evidence: ${f.evidenceIds.length} observation(s), first: ${f.evidenceIds.slice(0, 3).join(", ")}.`,
      "",
    );
  }

  sections.push(
    ...traffic.lines,
    "",
    "## Sitemap and search reconciliation",
    ...recons.flatMap((r) => {
      const label = SOURCE_LABEL[r.source];
      if (r.sourcePageCount === 0) return [`Not available: ${label} page data is missing for this period.`, ""];
      const when = r.snapshot ? ` (snapshot collected ${r.collectedOn})` : "";
      return [
        `### ${label}${when}`,
        `- Sitemap URLs: ${r.sitemapCount}. ${label} pages: ${r.sourcePageCount}. In both: ${r.both}.`,
        "",
        `In sitemap, no ${label} page data for this period (${r.sitemapOnly.length}):`,
        list(r.sitemapOnly),
        "",
        `In ${label}, not in sitemap (${r.sourceOnly.length}):`,
        list(r.sourceOnly),
        "",
      ];
    }),
    "## Evidence check",
    `- Candidate findings: ${candidates.length}. Kept: ${valid.length}. Dropped: ${candidates.length - valid.length}.`,
    ...problems.map((p) => `- Dropped: ${p}`),
    "",
    "## Limitations",
    "- Thresholds are project-defined. They are not Google ranking factors.",
    "- Search Console data is delayed and sampled for large sites. Totals may not match the Search Console UI.",
    "- Only one period is analyzed. No trend claims.",
    "",
  );
  return sections.join("\n");
}

// GA4 traffic for the period: total sessions by source and AI referral sessions. Measured.
export function ga4TrafficSection(store: Store, input: ReportInput): { lines: string[]; aiFinding: Finding | null } {
  const rows = store.sqlite
    .prepare(
      `SELECT id, value, json_extract(dimensions_json, '$.sessionSource') AS source FROM observations
       WHERE site_id = ? AND source = 'ga4' AND metric = 'sessions' AND period_start = ? AND period_end = ?
         AND json_extract(dimensions_json, '$.sessionSource') IS NOT NULL`,
    )
    .all(input.siteId, input.periodStart, input.periodEnd) as { id: string; value: number; source: string }[];
  const metrica = metricaLines(store, input);
  const bing = bingTrafficLines(store, input);
  if (rows.length === 0) {
    return { lines: ["## Traffic (GA4)", "Not available: no GA4 session-source data for this period.", ...metrica, ...bing], aiFinding: null };
  }
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const ai = rows.filter((r) => isAiReferrer(r.source));
  const aiTotal = ai.reduce((sum, r) => sum + r.value, 0);
  const lines = [
    "## Traffic (GA4)",
    `- Sessions in ${rows.length} source group(s) for ${input.periodStart} to ${input.periodEnd}: ${total}.`,
    `- AI referral sessions: ${aiTotal} from ${ai.length} source(s): ${ai.map((r) => `${r.source} (${r.value})`).join(", ") || "none"}.`,
  ];
  lines.push(...metrica, ...bing);
  const aiFinding: Finding | null =
    ai.length > 0
      ? {
          id: "ga4-ai-referral-sessions",
          title: `${aiTotal} AI referral session(s) in the period`,
          severity: "info",
          confidence: "high",
          description: "Sessions whose source is an AI assistant host (knowledge/ai-referrers.md). Direct GA4 data; the host list is project-defined.",
          affectedCount: ai.length,
          evidenceIds: ai.map((r) => r.id),
          basis: "measured",
        }
      : null;
  return { lines, aiFinding };
}

// Yandex Metrica traffic sources for the period (measured). Empty when nothing was ingested.
function metricaLines(store: Store, input: ReportInput): string[] {
  const rows = store.sqlite
    .prepare(
      `SELECT json_extract(dimensions_json, '$.ym:s:trafficSource') AS source, value FROM observations
       WHERE site_id = ? AND source = 'yandex_metrica' AND metric = 'ym:s:visits' AND period_start = ? AND period_end = ?`,
    )
    .all(input.siteId, input.periodStart, input.periodEnd) as { source: string | null; value: number }[];
  if (rows.length === 0) return [];
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return [
    `- Yandex Metrica: ${total} visits in ${rows.length} traffic source(s) for ${input.periodStart} to ${input.periodEnd}: ${rows
      .map((r) => `${r.source ?? "unknown"} (${r.value})`)
      .join(", ")}.`,
  ];
}

// Bing daily impressions and clicks for the period (site-level rows from bing_search_stats). Measured.
function bingTrafficLines(store: Store, input: ReportInput): string[] {
  const row = store.sqlite
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN metric = 'impressions' THEN value END), 0) AS impressions,
         COALESCE(SUM(CASE WHEN metric = 'clicks' THEN value END), 0) AS clicks,
         COUNT(DISTINCT json_extract(dimensions_json, '$.date')) AS days
       FROM observations
       WHERE site_id = ? AND source = 'bing' AND entity_type = 'site'
         AND json_extract(dimensions_json, '$.date') IS NOT NULL
         AND json_extract(dimensions_json, '$.date') BETWEEN ? AND ?`,
    )
    .get(input.siteId, input.periodStart, input.periodEnd) as { impressions: number; clicks: number; days: number };
  if (row.days === 0) return [];
  return [`- Bing Webmaster: ${row.impressions} impressions and ${row.clicks} clicks over ${row.days} day(s) in ${input.periodStart} to ${input.periodEnd}.`];
}
