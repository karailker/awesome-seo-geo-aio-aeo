// P6 report: GEO (citation readiness), AIO (machine-readable content and AI crawler access),
// AEO (structured data validation, answer coverage). Measured facts and inferred findings are
// labeled. Every finding cites observation ids; findings that fail the evidence gate are dropped.
import { validateFindings, type Finding } from "../analysis/evidence.js";
import type { Store } from "../db/store.js";

// Project-defined thresholds (not Google ranking factors; see docs/SCORING.md when written).
export const THIN_CONTENT_WORDS = 300;
const LIST_CAP = 20;

type Obs = { id: string; entityId: string; metric: string; value: number; dims: string | null };

export type GeoReportInput = { siteId: string; origin: string; runId: string };

function pageObs(store: Store, siteId: string, runId: string): Obs[] {
  return store.sqlite
    .prepare(
      `SELECT id, entity_id AS entityId, metric, value, dimensions_json AS dims FROM observations
       WHERE site_id = ? AND source = 'crawl' AND entity_type = 'page' AND json_extract(dimensions_json, '$.run_id') = ?`,
    )
    .all(siteId, runId) as Obs[];
}

function siteObs(store: Store, siteId: string): Obs[] {
  return store.sqlite
    .prepare(
      `SELECT id, entity_id AS entityId, metric, value, dimensions_json AS dims FROM observations
       WHERE site_id = ? AND source = 'crawl' AND entity_type = 'site'`,
    )
    .all(siteId) as Obs[];
}

const pick = (rows: Obs[], metric: string, pred: (v: number) => boolean) =>
  rows.filter((r) => r.metric === metric && pred(r.value));

const list = (items: string[]) => {
  const shown = items.slice(0, LIST_CAP).map((u) => `- ${u}`);
  if (items.length > LIST_CAP) shown.push(`- ... and ${items.length - LIST_CAP} more`);
  return shown.length > 0 ? shown.join("\n") : "- none";
};

function finding(
  id: string,
  title: string,
  severity: Finding["severity"],
  description: string,
  rows: Obs[],
  basis: "measured" | "inferred",
  confidence: Finding["confidence"] = "high",
): Finding {
  return {
    id,
    title,
    severity,
    confidence,
    description,
    affectedCount: new Set(rows.map((r) => r.entityId)).size,
    evidenceIds: rows.map((r) => r.id).slice(0, 400),
    basis,
  };
}

export function buildGeoReport(store: Store, input: GeoReportInput): string {
  const pages = pageObs(store, input.siteId, input.runId);
  const sites = siteObs(store, input.siteId);
  const pageCount = new Set(pages.map((p) => p.entityId)).size;
  const runRow = store.sqlite
    .prepare("SELECT url_count AS n, status AS status, started_at AS started FROM crawl_runs WHERE id = ?")
    .get(input.runId) as { n: number; status: string; started: string } | undefined;

  const sitemapCount = (store.sqlite
    .prepare("SELECT COUNT(*) AS n FROM pages WHERE site_id = ? AND source = 'sitemap'")
    .get(input.siteId) as { n: number }).n;
  const urlCap = (store.sqlite.prepare("SELECT url_cap AS cap FROM sites WHERE id = ?").get(input.siteId) as { cap: number } | undefined)?.cap ?? 0;
  const partialCrawl = runRow !== undefined && sitemapCount > runRow.n;

  const accessAgents = sites.filter((s) => s.metric === "ai_blocked_urls");
  const robotsRow = sites.find((s) => s.metric === "robots_readable");
  const llms = sites.find((s) => s.metric === "llms_txt_valid");
  const accessChecked = accessAgents.length > 0 || robotsRow !== undefined;

  // Findings
  const thin = pick(pages, "word_count", (v) => v < THIN_CONTENT_WORDS);
  const noAuthor = pick(pages, "has_author", (v) => v === 0);
  const noDate = pick(pages, "has_date", (v) => v === 0);
  const badH1 = pages.filter((p) => p.metric === "h1_count" && p.value !== 1);
  const skipped = pick(pages, "heading_skip", (v) => v === 1);
  const syntax = pick(pages, "jsonld_syntax_errors", (v) => v > 0);
  const missingProps = pick(pages, "missing_recommended_props", (v) => v > 0);
  const blockedAgents = accessAgents.filter((a) => a.value > 0);

  const candidates: Finding[] = [];
  if (thin.length) candidates.push(finding("geo-thin-content", `${new Set(thin.map((t) => t.entityId)).size} page(s) under ${THIN_CONTENT_WORDS} words`, "low",
    "Word count is a proxy for citable content depth. Project threshold; the count itself is measured.", thin, "inferred", "medium"));
  if (noAuthor.length) candidates.push(finding("geo-no-author-signal", "Pages without an author in structured data", "low",
    "No JSON-LD item on the page has an author property. Presence check.", noAuthor, "measured"));
  if (noDate.length) candidates.push(finding("geo-no-date-signal", "Pages without a date in structured data", "low",
    "No JSON-LD item has datePublished or dateModified. Presence check.", noDate, "measured"));
  for (const a of blockedAgents) {
    const dims = JSON.parse(a.dims ?? "{}") as { user_agent?: string; sample_size?: number };
    candidates.push(finding(`aio-ai-blocked-${dims.user_agent}`,
      `AI crawler ${dims.user_agent} is blocked on ${a.value} of ${dims.sample_size} sampled URLs`, "medium",
      "robots.txt disallows this user agent for the sampled URLs. Measured from the access check.", [a], "measured"));
  }
  if (llms && llms.value === 0) candidates.push(finding("aio-llms-txt", "llms.txt missing or not valid", "low",
    "The file is absent or its first non-empty line is not an H1 title. Measured.", [llms], "measured", "high"));
  if (badH1.length) candidates.push(finding("aio-h1-count", `${new Set(badH1.map((b) => b.entityId)).size} page(s) without exactly one H1`, "low",
    "Heading structure check. Measured.", badH1, "measured"));
  if (skipped.length) candidates.push(finding("aio-heading-skip", `${new Set(skipped.map((s) => s.entityId)).size} page(s) skip heading levels`, "low",
    "A heading jumps more than one level, e.g. h1 to h3. Measured.", skipped, "measured"));
  if (syntax.length) candidates.push(finding("aeo-jsonld-syntax", `${new Set(syntax.map((s) => s.entityId)).size} page(s) with invalid JSON-LD`, "medium",
    "A JSON-LD block is not valid JSON. This is a syntax error, separate from missing recommended properties. Measured.", syntax, "measured"));
  if (missingProps.length) candidates.push(finding("aeo-missing-recommended", `${new Set(missingProps.map((m) => m.entityId)).size} page(s) missing recommended schema properties`, "low",
    "Recommended properties for the detected types are absent (list in RECOMMENDED). Missing properties, not errors. Measured.", missingProps, "measured"));

  const { valid, problems } = validateFindings(store, input.siteId, candidates);

  const sections: string[] = [
    `# GEO / AIO / AEO audit: ${input.origin}`,
    "",
    "## Scope",
    `- Site: ${input.origin}`,
    `- Crawl run: ${input.runId}${runRow ? ` (${runRow.n} URL(s), status ${runRow.status}, started ${runRow.started})` : " (not found)"}`,
    "- Measured: direct presence and counts from crawl records and the access check. Inferred: findings that use a project threshold, labeled as such.",
    "- Not included: prompt-based AI answer testing (out of scope for v1, docs/ARCHITECTURE.md D6); entity consistency and FAQ quality (not yet implemented).",
    "",
    "## Measured",
    `- Pages with a crawl record: ${pageCount}`,
    `- Pages with structured data (any type): ${new Set(pick(pages, "structured_items", (v) => v > 0).map((p) => p.entityId)).size}`,
    `- Pages with FAQPage markup: ${new Set(pick(pages, "has_faqpage", (v) => v === 1).map((p) => p.entityId)).size}`,
    `- Pages with exactly one H1: ${new Set(pages.filter((p) => p.metric === "h1_count" && p.value === 1).map((p) => p.entityId)).size}`,
    accessChecked
      ? `- robots.txt readable: ${robotsRow?.value === 1 ? "yes" : "no"}. llms.txt valid: ${llms ? (llms.value === 1 ? "yes" : "no") : "not checked"}.`
      : "- AI crawler access: not checked. Run crawl_check_access and ingest its output.",
    "",
    "## Findings",
  ];
  if (valid.length === 0) sections.push("No findings met the thresholds.");
  for (const f of valid) {
    sections.push(
      `### ${f.title}`,
      `- Severity: ${f.severity}. Confidence: ${f.confidence}. Basis: ${f.basis}. Affected: ${f.affectedCount}.`,
      `- ${f.description}`,
      `- Evidence: ${f.evidenceIds.length} observation(s), first: ${f.evidenceIds.slice(0, 3).join(", ")}.`,
      "",
    );
  }

  sections.push(
    "## Structured data validation",
    "Syntax errors (JSON-LD does not parse):",
    list([...new Set(syntax.map((s) => s.entityId))]),
    "",
    "Missing recommended properties (valid JSON, property absent):",
    list([...new Set(missingProps.map((m) => m.entityId))]),
    "",
    "## Crawler access (AI user agents)",
    accessChecked
      ? [
          `robots.txt: ${robotsRow?.value === 1 ? "readable" : "unavailable (access unknown, not treated as allowed)"}.`,
          ...accessAgents.map((a) => {
            const d = JSON.parse(a.dims ?? "{}") as { user_agent?: string; sample_size?: number; blocked_urls?: string[] };
            const sample = (d.blocked_urls ?? []).slice(0, 3).join(", ");
            return `- ${d.user_agent}: blocked ${a.value} of ${d.sample_size}${sample ? `; e.g. ${sample}` : ""}`;
          }),
        ].join("\n")
      : "Not checked.",
    "",
    "## Answer coverage (AEO)",
    `- Pages with FAQPage markup: ${new Set(pick(pages, "has_faqpage", (v) => v === 1).map((p) => p.entityId)).size} of ${pageCount}.`,
    "- Question-form Search Console queries: see the Search Console report (not joined in this version).",
    "",
    "## Evidence check",
    `- Candidate findings: ${candidates.length}. Kept: ${valid.length}. Dropped: ${candidates.length - valid.length}.`,
    ...problems.map((p) => `- Dropped: ${p}`),
    "",
    "## Missing data",
    ...(pageCount === 0 ? ["- No crawl records for this run."] : []),
    ...(partialCrawl ? [`- Crawl covers ${runRow.n} of ${sitemapCount} sitemap URL(s) (URL cap ${urlCap}). Findings describe the fetched pages only.`] : []),
    ...(accessChecked ? [] : ["- AI crawler access and llms.txt: not checked."]),
    "",
    "## Limitations",
    "- Thresholds are project-defined. They are not Google or AI platform ranking factors.",
    "- Author and date signals are read from JSON-LD only. Microdata and visible bylines are not checked.",
    "- Prompt-based AI visibility is out of scope for v1.",
    "",
  );
  return sections.join("\n");
}
