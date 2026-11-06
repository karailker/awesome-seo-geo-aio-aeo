// Technical audit of one crawl run (skill seo/technical-audit). Reports what was fetched and measured: counts,
// redirects, canonical, titles, hreflang alternates, and headings. Each listed URL cites its crawl_results row id.
// A URL that robots blocked is "not fetched", never "missing". Nothing is inferred from URLs that were not fetched.
import type { Store } from "../db/store.js";

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
  errors: string | null;
};

// searchPages: page URLs from Search Console. Those missing from the crawl run were never checked.
export type TechnicalInput = { siteId: string; origin: string; runId: string; searchPages?: string[] };

type Problem = { url: string; rowId: string; detail: string };

function rowsFor(store: Store, runId: string): Row[] {
  return store.sqlite
    .prepare(
      `SELECT r.id AS id, p.url AS url, r.status AS status, r.final_url AS finalUrl, r.redirect_chain_json AS redirect,
              r.title AS title, r.canonical AS canonical, r.hreflang_json AS hreflang, r.headings_json AS headings,
              r.errors_json AS errors
       FROM crawl_results r JOIN pages p ON p.id = r.page_id WHERE r.run_id = ? ORDER BY p.url`,
    )
    .all(runId) as Row[];
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

const codesOf = (row: Row): string[] => parseArray<{ code: string }>(row.errors).map((e) => e.code);
const isRobotBlocked = (row: Row): boolean => codesOf(row).includes("ROBOTS_DISALLOWED");
const isFetched = (row: Row): boolean => codesOf(row).length === 0;
const isErrored = (row: Row): boolean => !isFetched(row) && !isRobotBlocked(row);
const is200 = (row: Row): boolean => isFetched(row) && row.status === 200;

function listLines(items: Problem[]): string[] {
  const shown = items.slice(0, LIST_CAP).map((p) => `- ${p.url} — ${p.detail} [row ${p.rowId}]`);
  if (items.length > LIST_CAP) shown.push(`- ... and ${items.length - LIST_CAP} more`);
  return shown.length > 0 ? shown : ["- none"];
}

export function buildTechnicalReport(store: Store, input: TechnicalInput): string {
  const rows = rowsFor(store, input.runId);
  const fetched = rows.filter(isFetched);
  const blocked = rows.filter(isRobotBlocked);
  const errored = rows.filter(isErrored);
  const ok = rows.filter(is200);

  const errorCounts = new Map<string, number>();
  for (const row of errored) for (const code of codesOf(row)) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
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
  const noH1 = ok.filter((r) => !parseArray<{ level: number }>(r.headings).some((h) => h.level === 1));

  const crawled = new Set(rows.map((r) => r.url));
  const notCrawled = [...new Set(input.searchPages ?? [])].filter((u) => !crawled.has(u)).sort();

  const robotsUnknown = rows.filter((r) => codesOf(r).includes("ROBOTS_UNAVAILABLE"));
  const notHtml = rows.filter((r) => codesOf(r).includes("NOT_HTML"));
  const extractFailed = rows.filter((r) => codesOf(r).includes("EXTRACT_FAILED"));

  const lines: string[] = [
    `# Technical audit: ${input.origin}`,
    "",
    "## Scope",
    `- Crawl run: ${input.runId}`,
    `- URLs in the run: ${rows.length}. Run status: ${errored.length > 0 ? "partial (some URLs failed)" : "completed"}.`,
    "- Measured from the crawl. Project-defined checks; not Google ranking factors.",
    "",
    "## Counts",
    `- Fetched (no errors): ${fetched.length}, of which status 200: ${ok.length}.`,
    `- Robots-blocked (not fetched): ${blocked.length}.`,
    `- Errors (not fetched): ${errored.length}.${errorCounts.size > 0 ? ` By code: ${[...errorCounts.entries()].map(([c, n]) => `${c} ${n}`).join(", ")}.` : ""}`,
    `- Check: fetched + robots-blocked + errors = ${fetched.length} + ${blocked.length} + ${errored.length} = ${rows.length} URLs in the run: ${sumOk ? "matches" : "DOES NOT MATCH"}.`,
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
    ...(notHtml.length > 0 ? [`- ${notHtml.length} URL(s) are not HTML (NOT_HTML): no on-page fields for them.`] : []),
    ...(extractFailed.length > 0 ? [`- ${extractFailed.length} URL(s) failed extraction (EXTRACT_FAILED): no on-page fields for them.`] : []),
    `- ${blocked.length} URL(s) were robots-blocked and not fetched. They are not counted as missing.`,
    "",
  ];
  return lines.join("\n");
}
