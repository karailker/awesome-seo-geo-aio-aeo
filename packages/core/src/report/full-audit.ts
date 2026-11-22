// One report for the whole site: the technical audit, the GEO / AIO / AEO audit and the SEO audit, with a single
// ranked "Needs attention" list and a single "Missing data" list. Nothing is added to the evidence: every item is
// a finding of one of the three reports (with its evidence) or a counted fact from the technical audit. Severities
// and confidence are the ones those reports already give.
import type { Finding } from "../analysis/evidence.js";
import type { Store } from "../db/store.js";
import { buildGeoAudit } from "./geo-audit.js";
import { buildSeoAudit } from "./seo-audit.js";
import { buildTechnicalAudit } from "./technical-audit.js";

const MAX_LISTED = 25;
const RANK = { high: 0, medium: 1, low: 2, info: 3 } as const;

export type AttentionItem = { severity: keyof typeof RANK; source: "technical" | "geo" | "seo"; text: string; affected: number };

export type FullAuditInput = {
  siteId: string;
  origin: string;
  runId: string;
  extraRunIds?: string[];
  mode: "quick" | "deep";
  periodStart?: string;
  periodEnd?: string;
  searchPages?: string[];
};

// The lines of a report's "## Missing data" section.
function missingLines(report: string): string[] {
  const start = report.indexOf("## Missing data");
  if (start === -1) return [];
  const next = report.indexOf("\n## ", start + 1);
  return report
    .slice(start, next === -1 ? undefined : next)
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
}

const fromFinding = (source: "geo" | "seo", f: Finding): AttentionItem => ({
  severity: f.severity,
  source,
  affected: f.affectedCount,
  text: `${f.title} (${source}; confidence ${f.confidence}${f.basis ? `, ${f.basis}` : ""}; ${f.evidenceIds.length} observation(s) as evidence)`,
});

export function buildFullAudit(store: Store, input: FullAuditInput): { report: string; attention: AttentionItem[] } {
  const technical = buildTechnicalAudit(store, { siteId: input.siteId, origin: input.origin, runId: input.runId, extraRunIds: input.extraRunIds, searchPages: input.searchPages });
  const geo = buildGeoAudit(store, { siteId: input.siteId, origin: input.origin, runId: input.runId });
  const hasPeriod = Boolean(input.periodStart && input.periodEnd);
  const seo = hasPeriod
    ? buildSeoAudit(store, { siteId: input.siteId, origin: input.origin, periodStart: input.periodStart as string, periodEnd: input.periodEnd as string })
    : null;

  const attention: AttentionItem[] = [
    ...technical.facts.map((f) => ({ severity: f.severity, source: "technical" as const, affected: f.count, text: `${f.count} ${f.title} (technical; counted from crawl rows)` })),
    ...geo.findings.map((f) => fromFinding("geo", f)),
    ...(seo ? seo.findings.map((f) => fromFinding("seo", f)) : []),
  ].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.affected - a.affected || a.text.localeCompare(b.text));

  const missing = new Map<string, string>();
  const add = (source: string, line: string) => {
    if (!missing.has(line)) missing.set(line, `- (${source}) ${line}`);
  };
  for (const l of missingLines(technical.report)) add("technical", l);
  for (const l of missingLines(geo.report)) add("geo", l);
  if (seo) for (const l of missingLines(seo.report)) add("seo", l);
  else add("seo", "Search Console, GA4, Bing and Yandex: no period given, so the search part was not built.");

  const runs = [input.runId, ...(input.extraRunIds ?? [])];
  const listed = attention.slice(0, MAX_LISTED).map((a) => `- [${a.severity}] ${a.text}`);
  if (attention.length > MAX_LISTED) listed.push(`- ... and ${attention.length - MAX_LISTED} more`);

  const head = [
    `# Site audit: ${input.origin}`,
    "",
    "## Scope",
    `- Mode: ${input.mode}.${input.mode === "quick" ? " The results describe a sample of the site, not all of it." : ""}`,
    `- Crawl run${runs.length > 1 ? "s" : ""}: ${runs.join(", ")}`,
    hasPeriod ? `- Search period: ${input.periodStart} to ${input.periodEnd}.` : "- Search period: none.",
    "- Severities are project-defined and are not Google, Bing, Yandex or AI platform ranking factors. Each item comes from one of the three reports below.",
    "",
    "## Needs attention",
    ...(listed.length > 0 ? listed : ["- Nothing met a threshold."]),
    "",
    "## Missing data",
    ...(missing.size > 0 ? [...missing.values()] : ["- none"]),
    "",
    "---",
    "",
  ];
  return { report: [...head, technical.report, "---", "", geo.report, ...(seo ? ["---", "", seo.report] : [])].join("\n"), attention };
}
