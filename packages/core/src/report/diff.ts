// Change detection. Compares two crawl runs of one site (status, content hash, title, canonical) and two sitemap
// snapshots. Facts only: a URL present in only one run is reported as that, not as removed, because the two runs may
// cover different URL sets (a cap, a different input list).
import type { Store } from "../db/store.js";
import { normalizeUrl } from "../domain.js";

const LIST_CAP = 20;
const SIZE_WARNING_RATIO = 0.5; // the smaller run is less than half the larger one

type Row = { id: string; url: string; status: number | null; hash: string | null; title: string | null; canonical: string | null; started: string };

export type DiffInput = { siteId: string; origin: string; fromRunId: string; toRunId: string };

function rowsOf(store: Store, siteId: string, runId: string): Map<string, Row> {
  const rows = store.sqlite
    .prepare(
      `SELECT r.id AS id, p.url AS url, r.status AS status, r.content_hash AS hash, r.title AS title, r.canonical AS canonical, r.fetched_at AS started
       FROM crawl_results r JOIN pages p ON p.id = r.page_id WHERE r.run_id = ? AND p.site_id = ? ORDER BY p.url`,
    )
    .all(runId, siteId) as Row[];
  return new Map(rows.map((r) => [r.url, r]));
}

type Change = { url: string; detail: string };
const lines = (items: Change[]): string[] => {
  const shown = items.slice(0, LIST_CAP).map((c) => `- ${c.url} — ${c.detail}`);
  if (items.length > LIST_CAP) shown.push(`- ... and ${items.length - LIST_CAP} more`);
  return shown.length > 0 ? shown : ["- none"];
};
const urlLines = (urls: string[]): string[] => lines(urls.map((url) => ({ url, detail: "present in this run only" })));

export function buildCrawlDiff(store: Store, input: DiffInput): string {
  const from = rowsOf(store, input.siteId, input.fromRunId);
  const to = rowsOf(store, input.siteId, input.toRunId);
  const both = [...to.keys()].filter((u) => from.has(u)).sort();
  const onlyTo = [...to.keys()].filter((u) => !from.has(u)).sort();
  const onlyFrom = [...from.keys()].filter((u) => !to.has(u)).sort();

  const status: Change[] = [];
  const content: Change[] = [];
  const title: Change[] = [];
  const canonical: Change[] = [];
  for (const url of both) {
    const a = from.get(url) as Row;
    const b = to.get(url) as Row;
    const ids = `[rows ${a.id} → ${b.id}]`;
    if (a.status !== b.status) status.push({ url, detail: `${a.status ?? "no response"} → ${b.status ?? "no response"} ${ids}` });
    // Content and on-page fields are compared only when both fetches returned a page.
    if (a.status === 200 && b.status === 200) {
      if (a.hash !== b.hash) content.push({ url, detail: `content hash changed ${ids}` });
      if (a.title !== b.title) title.push({ url, detail: `"${a.title ?? ""}" → "${b.title ?? ""}" ${ids}` });
      if (a.canonical !== b.canonical) canonical.push({ url, detail: `${a.canonical ?? "none"} → ${b.canonical ?? "none"} ${ids}` });
    }
  }

  const small = Math.min(from.size, to.size);
  const large = Math.max(from.size, to.size);
  const sizeNote = large > 0 && small / large < SIZE_WARNING_RATIO
    ? [`- The runs cover different numbers of URLs (${from.size} and ${to.size}). Compare runs of the same input list for a meaningful result.`]
    : [];

  return [
    `# Change report: ${input.origin}`,
    "",
    "## Scope",
    `- Older run: ${input.fromRunId} (${from.size} URL(s)). Newer run: ${input.toRunId} (${to.size} URL(s)).`,
    ...sizeNote,
    "- A URL present in only one run may come from a different URL set or cap, not from a change on the site.",
    "- Measured from the crawl records. A content change means the content hash differs; it does not say what changed.",
    "",
    "## Counts",
    `- In both runs: ${both.length}. Only in the newer run: ${onlyTo.length}. Only in the older run: ${onlyFrom.length}.`,
    `- Status changed: ${status.length}. Content changed: ${content.length}. Title changed: ${title.length}. Canonical changed: ${canonical.length}.`,
    "",
    "## Status changes",
    ...lines(status),
    "",
    "## Content changes",
    ...lines(content),
    "",
    "## Title changes",
    ...lines(title),
    "",
    "## Canonical changes",
    ...lines(canonical),
    "",
    "## Only in the newer run",
    ...urlLines(onlyTo),
    "",
    "## Only in the older run",
    ...urlLines(onlyFrom),
    "",
  ].join("\n");
}

// Two sitemap snapshots (the crawl_discover_sitemap output): URLs added, removed, and whose lastmod changed.
export type SitemapDiff = { added: string[]; removed: string[]; lastmodChanged: { url: string; from: string | null; to: string | null }[] };

function sitemapMap(text: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const row = JSON.parse(raw) as { url?: unknown; lastmod?: unknown };
      if (typeof row.url === "string") out.set(normalizeUrl(row.url), typeof row.lastmod === "string" ? row.lastmod : null);
    } catch {
      /* skipped: not a sitemap line */
    }
  }
  return out;
}

export function diffSitemaps(olderText: string, newerText: string): SitemapDiff {
  const older = sitemapMap(olderText);
  const newer = sitemapMap(newerText);
  return {
    added: [...newer.keys()].filter((u) => !older.has(u)).sort(),
    removed: [...older.keys()].filter((u) => !newer.has(u)).sort(),
    lastmodChanged: [...newer.keys()]
      .filter((u) => older.has(u) && older.get(u) !== newer.get(u))
      .sort()
      .map((url) => ({ url, from: older.get(url) ?? null, to: newer.get(url) ?? null })),
  };
}

export function renderSitemapDiff(origin: string, diff: SitemapDiff, olderName: string, newerName: string): string {
  return [
    `# Sitemap change report: ${origin}`,
    "",
    "## Scope",
    `- Older snapshot: ${olderName}. Newer snapshot: ${newerName}.`,
    "- A snapshot stops at the URL cap, so a difference near the cap may come from the cap, not from the site.",
    "",
    "## Counts",
    `- Added: ${diff.added.length}. Removed: ${diff.removed.length}. lastmod changed: ${diff.lastmodChanged.length}.`,
    "",
    "## Added",
    ...lines(diff.added.map((url) => ({ url, detail: "in the newer snapshot only" }))),
    "",
    "## Removed",
    ...lines(diff.removed.map((url) => ({ url, detail: "in the older snapshot only" }))),
    "",
    "## lastmod changed",
    ...lines(diff.lastmodChanged.map((c) => ({ url: c.url, detail: `${c.from ?? "none"} → ${c.to ?? "none"}` }))),
    "",
  ].join("\n");
}
