// Technical audit of one crawl run (skill seo/technical-audit). Reports what was fetched and measured: counts,
// redirects, canonical, titles, hreflang alternates, and headings. Each listed URL cites its crawl_results row id.
// A URL that robots blocked is "not fetched", never "missing". Nothing is inferred from URLs that were not fetched.
import type { Store } from "../db/store.js";
import { normalizeUrl } from "../domain.js";

export const LIST_CAP = 20;

type Row = {
  id: string;
  url: string;
  status: number | null;
  finalUrl: string | null;
  redirect: string | null;
  title: string | null;
  canonical: string | null;
  hreflang: string | null;
  headings: string | null;
  words: number | null;
  rendered: number | null;
  errors: string | null;
};

// searchPages: page URLs from Search Console. Those missing from the crawl run were never checked.
// extraRunIds: more crawl runs to report together (for example a crawl of Search Console URLs). A URL fetched in
// several runs is reported once, from the latest fetch.
export type TechnicalInput = { siteId: string; origin: string; runId: string; extraRunIds?: string[]; searchPages?: string[] };

type Problem = { url: string; rowId: string; detail: string };

function rowsFor(store: Store, runIds: string[]): Row[] {
  const marks = runIds.map(() => "?").join(",");
  const rows = store.sqlite
    .prepare(
      `SELECT r.id AS id, p.url AS url, r.status AS status, r.final_url AS finalUrl, r.redirect_chain_json AS redirect,
              r.title AS title, r.canonical AS canonical, r.hreflang_json AS hreflang, r.headings_json AS headings, r.word_count AS words,
              r.errors_json AS errors, r.rendered AS rendered, r.fetched_at AS fetchedAt
       FROM crawl_results r JOIN pages p ON p.id = r.page_id WHERE r.run_id IN (${marks}) ORDER BY p.url, r.fetched_at DESC`,
    )
    .all(...runIds) as (Row & { fetchedAt: string })[];
  // one row per URL: the latest fetch
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

const parseArray = <T>(raw: string | null): T[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
};

// NOT_HTML is recorded on a URL that was fetched (for example a text file). It is not a failure.
const INFORMATIONAL_CODES = ["NOT_HTML"];
const codesOf = (row: Row): string[] => parseArray<{ code: string }>(row.errors).map((e) => e.code);
const failureCodes = (row: Row): string[] => codesOf(row).filter((c) => !INFORMATIONAL_CODES.includes(c));
const isRobotBlocked = (row: Row): boolean => failureCodes(row).includes("ROBOTS_DISALLOWED");
const isFetched = (row: Row): boolean => failureCodes(row).length === 0;
const isNotHtml = (row: Row): boolean => codesOf(row).includes("NOT_HTML");
const isErrored = (row: Row): boolean => !isFetched(row) && !isRobotBlocked(row);
// HTML pages: fetched, status 200, and HTML. On-page checks apply only to these.
const is200 = (row: Row): boolean => isFetched(row) && row.status === 200 && !isNotHtml(row);

function listLines(items: Problem[]): string[] {
  const shown = items.slice(0, LIST_CAP).map((p) => `- ${p.url} — ${p.detail} [row ${p.rowId}]`);
  if (items.length > LIST_CAP) shown.push(`- ... and ${items.length - LIST_CAP} more`);
  return shown.length > 0 ? shown : ["- none"];
}

// A counted fact for summaries. Only non-zero facts are returned. Severities are project-defined.
export type TechnicalFact = { id: string; title: string; count: number; severity: "info" | "low" | "medium" };

export function buildTechnicalReport(store: Store, input: TechnicalInput): string {
  return buildTechnicalAudit(store, input).report;
}

export function buildTechnicalAudit(store: Store, input: TechnicalInput): { report: string; facts: TechnicalFact[] } {
  const runIds = [input.runId, ...(input.extraRunIds ?? [])];
  const rows = rowsFor(store, runIds);
  const fetched = rows.filter(isFetched);
  const blocked = rows.filter(isRobotBlocked);
  const errored = rows.filter(isErrored);
  const ok = rows.filter(is200);

  const errorCounts = new Map<string, number>();
  for (const row of errored) for (const code of failureCodes(row)) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
  const sumOk = fetched.length + blocked.length + errored.length === rows.length;

  // Redirects: any fetched URL with at least one hop
  const redirected = fetched.filter((r) => parseArray<unknown>(r.redirect).length > 0);

  // Canonical: exact string comparison with the final URL
  const canonicalMissing = ok.filter((r) => !r.canonical);
  const canonicalMismatch = ok.filter((r) => r.canonical && r.finalUrl && r.canonical !== r.finalUrl);

  // Titles: missing, and titles shared by more than one URL
  const titleMissing = ok.filter((r) => !r.title);
  const titleGroups = new Map<string, Row[]>();
  for (const r of ok) if (r.title) titleGroups.set(r.title, [...(titleGroups.get(r.title) ?? []), r]);
  const shared = [...titleGroups.entries()].filter(([, urls]) => urls.length > 1);

  // Hreflang: pages that list alternates. Reciprocity is not judged in this version.
  const hreflangPages = ok
    .map((r) => ({ row: r, alternates: parseArray<{ lang?: string; href?: string }>(r.hreflang) }))
    .filter((x) => x.alternates.length > 0);
  const alternateTotal = hreflangPages.reduce((n, x) => n + x.alternates.length, 0);

  // Headings: no h1 on a fetched 200 page
  // A page with no text in the static HTML is usually rendered by JavaScript; its headings are unknown, not missing.
  const noText = ok.filter((r) => !r.words && r.rendered !== 1);
  const noH1 = ok.filter((r) => (r.words || r.rendered === 1) && !parseArray<{ level: number }>(r.headings).some((h) => h.level === 1));

  // Search Console URLs are compared after the same normalisation the store applies (fragment removed).
  const crawled = new Set(rows.map((r) => r.url));
  const searchSet = new Set<string>();
  for (const u of input.searchPages ?? []) {
    try {
      searchSet.add(normalizeUrl(u));
    } catch {
      /* not an http(s) URL: ignored */
    }
  }
  const notCrawled = [...searchSet].filter((u) => !crawled.has(u)).sort();

  // Status problems: URLs that were requested but returned an error status or failed
  const statusProblems: Problem[] = errored.map((r) => {
    const hops = parseArray<unknown>(r.redirect).length;
    const where = hops > 0 ? `, after ${hops} redirect hop(s) to ${r.finalUrl ?? "unknown"}` : "";
    return { url: r.url, rowId: r.id, detail: `${r.status ?? "no response"} ${failureCodes(r).join(", ")}${where}` };
  });

  const robotsUnknown = rows.filter((r) => codesOf(r).includes("ROBOTS_UNAVAILABLE"));
  const notHtml = rows.filter((r) => codesOf(r).includes("NOT_HTML"));
  const extractFailed = rows.filter((r) => codesOf(r).includes("EXTRACT_FAILED"));

  const lines: string[] = [
    `# Technical audit: ${input.origin}`,
    "",
    "## Scope",
    `- Crawl run${runIds.length > 1 ? "s" : ""}: ${runIds.join(", ")}`,
    `- Pages rendered in a browser: ${rows.filter((r) => r.rendered === 1).length} of ${rows.length}.`,
    `- URLs in the run: ${rows.length}. Run status: ${errored.length > 0 ? "partial (some URLs failed)" : "completed"}.`,
    "- Measured from the crawl. Project-defined checks; not Google ranking factors.",
    "",
    "## Counts",
    `- Fetched (no failures): ${fetched.length}, of which HTML pages with status 200: ${ok.length}, of which not HTML: ${fetched.filter(isNotHtml).length}.`,
    `- Robots-blocked (not fetched): ${blocked.length}.`,
    `- Errors (not fetched): ${errored.length}.${errorCounts.size > 0 ? ` By code: ${[...errorCounts.entries()].map(([c, n]) => `${c} ${n}`).join(", ")}.` : ""}`,
    `- Check: fetched + robots-blocked + errors = ${fetched.length} + ${blocked.length} + ${errored.length} = ${rows.length} URLs in the run: ${sumOk ? "matches" : "DOES NOT MATCH"}.`,
    "",
    "## Status problems",
    `- URLs with an error status: ${statusProblems.length}.`,
    ...listLines(statusProblems),
    "",
    "## Redirects",
    `- URLs with one or more redirect hops: ${redirected.length}.`,
    ...listLines(
      redirected.map((r) => {
        const hops = parseArray<unknown>(r.redirect).length;
        return { url: r.url, rowId: r.id, detail: `${hops} hop(s), final status ${r.status} at ${r.finalUrl ?? "unknown"}` };
      }),
    ),
    "",
    "## Canonical",
    `- Missing canonical (200 pages): ${canonicalMissing.length}.`,
    ...listLines(canonicalMissing.map((r) => ({ url: r.url, rowId: r.id, detail: "no canonical link" }))),
    `- Canonical differs from the final URL (200 pages): ${canonicalMismatch.length}.`,
    ...listLines(canonicalMismatch.map((r) => ({ url: r.url, rowId: r.id, detail: `canonical ${r.canonical}, final ${r.finalUrl}` }))),
    "",
    "## Titles",
    `- Missing title (200 pages): ${titleMissing.length}.`,
    ...listLines(titleMissing.map((r) => ({ url: r.url, rowId: r.id, detail: "no title" }))),
    `- Titles shared by more than one URL: ${shared.length} title(s) on ${shared.reduce((n, [, urls]) => n + urls.length, 0)} URL(s).`,
    ...listLines(
      shared.flatMap(([title, urls]) => urls.map((r) => ({ url: r.url, rowId: r.id, detail: `shared title "${title}"` }))),
    ),
    "",
    "## Hreflang",
    `- Pages listing alternates: ${hreflangPages.length} (${alternateTotal} alternate link(s)). Reciprocity is not judged in this version.`,
    ...listLines(
      hreflangPages.map((x) => ({
        url: x.row.url,
        rowId: x.row.id,
        detail: `alternates: ${x.alternates.map((a) => a.lang ?? "?").join(", ")}`,
      })),
    ),
    "",
    "## Headings",
    `- 200 pages with no h1: ${noH1.length}.`,
    ...listLines(noH1.map((r) => ({ url: r.url, rowId: r.id, detail: "no h1" }))),
    "",
    "## Coverage",
    `- Search Console pages not in this crawl run: ${input.searchPages ? notCrawled.length : "not checked (no Search Console file given)"}.${input.searchPages ? " Their status, redirects and canonical were not checked." : ""}`,
    ...(input.searchPages ? notCrawled.map((u) => `- ${u} — not crawled`).slice(0, LIST_CAP) : []),
    ...(input.searchPages && notCrawled.length > LIST_CAP ? [`- ... and ${notCrawled.length - LIST_CAP} more`] : []),
    "",
    "## Missing data",
    ...(robotsUnknown.length > 0
      ? [`- Robots status unknown for ${robotsUnknown.length} URL(s) (ROBOTS_UNAVAILABLE). Access is unknown; these are not treated as allowed or blocked.`]
      : []),
    ...(noText.length > 0
      ? [`- ${noText.length} page(s) returned no text in the static HTML (likely rendered by JavaScript). Their headings are unknown, so they are not counted as missing an h1. Crawl them again with render=true.`]
      : []),
    ...(input.searchPages && notCrawled.length > 0
      ? [`- ${notCrawled.length} Search Console page(s) were not crawled, so their status, redirects and canonical are unknown.`]
      : []),
    ...(notHtml.length > 0 ? [`- ${notHtml.length} URL(s) are not HTML (NOT_HTML): no on-page fields for them.`] : []),
    ...(extractFailed.length > 0 ? [`- ${extractFailed.length} URL(s) failed extraction (EXTRACT_FAILED): no on-page fields for them.`] : []),
    ...(blocked.length > 0 ? [`- ${blocked.length} URL(s) were robots-blocked and not fetched. They are not counted as missing.`] : []),
    "",
  ];
  const facts: TechnicalFact[] = [
    { id: "technical-status-problems", title: "URL(s) returned an error status", count: statusProblems.length, severity: "medium" as const },
    { id: "technical-search-pages-not-crawled", title: "Search Console page(s) were not crawled", count: input.searchPages ? notCrawled.length : 0, severity: "medium" as const },
    { id: "technical-canonical-missing", title: "page(s) have no canonical", count: canonicalMissing.length, severity: "low" as const },
    { id: "technical-canonical-differs", title: "page(s) have a canonical that differs from the final URL", count: canonicalMismatch.length, severity: "low" as const },
    { id: "technical-titles-shared", title: "title(s) are shared by more than one URL", count: shared.length, severity: "low" as const },
    { id: "technical-title-missing", title: "page(s) have no title", count: titleMissing.length, severity: "low" as const },
    { id: "technical-no-h1", title: "page(s) have no h1", count: noH1.length, severity: "low" as const },
    { id: "technical-static-text-empty", title: "page(s) returned no static text (likely rendered by JavaScript)", count: noText.length, severity: "info" as const },
    { id: "technical-redirects", title: "URL(s) redirect", count: redirected.length, severity: "info" as const },
  ].filter((f) => f.count > 0);
  return { report: lines.join("\n"), facts };
}
