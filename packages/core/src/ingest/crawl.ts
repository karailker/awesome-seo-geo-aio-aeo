// Ingests crawl_fetch_pages JSONL into crawl_runs and crawl_results (ROADMAP P4).
// One transaction per run. A run_id that is already stored is skipped, so re-running is safe.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { crawlResults, crawlRuns } from "../db/schema.js";
import { upsertPage, withTransaction, type Store } from "../db/store.js";
import { normalizeUrl } from "../domain.js";
import { parseJsonl } from "./jsonl.js";

const CrawlLineSchema = z.object({
  run_id: z.string().min(1),
  url: z.string().url(),
  fetched_at: z.string().min(1),
  status: z.number().int().nullable(),
  final_url: z.string().nullable(),
  redirect_chain: z.array(z.unknown()),
  content_type: z.string().nullable(),
  title: z.string().nullable(),
  meta_description: z.string().nullable(),
  canonical: z.string().nullable(),
  lang: z.string().nullable(),
  hreflang: z.array(z.unknown()),
  headings: z.array(z.unknown()),
  word_count: z.number().int().nonnegative().nullable(),
  content_hash: z.string().nullable(),
  structured_data: z.array(z.unknown()),
  robots_allowed: z.boolean().nullable(),
  raw_html_path: z.string().nullable(),
  errors: z.array(z.object({ code: z.string(), message: z.string(), retryable: z.boolean() })),
});
type CrawlLine = z.infer<typeof CrawlLineSchema>;

export type CrawlIngestResult = {
  runId: string | null;
  alreadyIngested: boolean;
  lines: number;
  ingested: number;
  skipped: number;
  errors: string[];
};

const json = (value: unknown) => JSON.stringify(value);

export function ingestCrawlJsonl(store: Store, siteId: string, jsonl: string, jsonlPath: string | null): CrawlIngestResult {
  const { lines, rows, skipped, errors } = parseJsonl(jsonl, CrawlLineSchema);
  const runId = rows[0]?.run_id ?? null;
  const base = { runId, lines, ingested: 0, skipped, errors };
  if (runId === null) return { ...base, alreadyIngested: false };

  const existing = store.sqlite.prepare("SELECT 1 FROM crawl_runs WHERE id = ?").get(runId);
  if (existing !== undefined) return { ...base, alreadyIngested: true };

  const fetchedTimes = rows.map((r) => r.fetched_at).sort();
  const status = rows.some((r) => r.errors.length > 0) ? "partial" : "completed";

  withTransaction(store, () => {
    store.db
      .insert(crawlRuns)
      .values({
        id: runId,
        siteId,
        startedAt: fetchedTimes[0] ?? new Date(0).toISOString(),
        finishedAt: fetchedTimes[fetchedTimes.length - 1] ?? new Date(0).toISOString(),
        urlCount: rows.length,
        status,
        jsonlPath,
      })
      .run();

    for (const row of rows) {
      const url = normalizeUrl(row.url);
      const page = pageFor(store, siteId, url, row.fetched_at);
      store.db.insert(crawlResults).values(toResult(row, runId, page)).run();
    }
  });

  return { ...base, ingested: rows.length, alreadyIngested: false };
}

// Existing pages keep their source and lastmod (the sitemap owns lastmod); crawl only bumps lastSeenAt.
function pageFor(store: Store, siteId: string, url: string, fetchedAt: string): string {
  const existing = store.sqlite.prepare("SELECT id FROM pages WHERE site_id = ? AND url = ?").get(siteId, url) as
    | { id: string }
    | undefined;
  if (existing) {
    store.sqlite.prepare("UPDATE pages SET last_seen_at = ? WHERE id = ?").run(fetchedAt, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  upsertPage(store, { id, siteId, url, source: "crawl", lastmod: null, firstSeenAt: fetchedAt, lastSeenAt: fetchedAt });
  return id;
}

function toResult(row: CrawlLine, runId: string, pageId: string) {
  return {
    id: randomUUID(),
    runId,
    pageId,
    fetchedAt: row.fetched_at,
    status: row.status,
    finalUrl: row.final_url,
    redirectChainJson: json(row.redirect_chain),
    title: row.title,
    metaDescription: row.meta_description,
    canonical: row.canonical,
    lang: row.lang,
    hreflangJson: json(row.hreflang),
    headingsJson: json(row.headings),
    wordCount: row.word_count,
    contentHash: row.content_hash,
    robotsAllowed: row.robots_allowed === null ? null : row.robots_allowed ? 1 : 0,
    structuredDataJson: json(row.structured_data),
    rawHtmlPath: row.raw_html_path,
    errorsJson: json(row.errors),
  };
}
