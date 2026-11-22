// Deep audits crawl every page as static HTML first. Pages whose static HTML has no text are usually rendered by
// JavaScript, so only those are crawled again with render=true, and the result replaces the static record. The
// merged file is ingested as one new run, so every report reads one consistent run.
import type { Store } from "./db/store.js";

const records = (text: string): { url: string; line: Record<string, unknown> }[] =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((raw) => {
      try {
        const line = JSON.parse(raw) as Record<string, unknown>;
        return typeof line.url === "string" ? [{ url: line.url, line }] : [];
      } catch {
        return [];
      }
    });

// Base records in their order; a patch record replaces the base record of the same URL when it is a page that was
// fetched (a failed patch keeps the base). Every output record carries newRunId.
export function mergeCrawl(baseText: string, patchText: string, newRunId: string): string {
  const patches = new Map<string, Record<string, unknown>>();
  for (const { url, line } of records(patchText)) {
    const errors = (line.errors as { code: string }[] | undefined) ?? [];
    if (line.status === null || line.status === undefined || errors.some((e) => e.code !== "NOT_HTML")) continue;
    patches.set(url, line);
  }
  return records(baseText)
    .map(({ url, line }) => JSON.stringify({ ...(patches.get(url) ?? line), run_id: newRunId }))
    .join("\n");
}

// URLs of a run that were fetched as HTML, returned no text, and were not rendered: the render candidates.
export function urlsNeedingRender(store: Store, siteId: string, runId: string): string[] {
  const rows = store.sqlite
    .prepare(
      `SELECT p.url AS url, r.errors_json AS errors FROM crawl_results r JOIN pages p ON p.id = r.page_id
       WHERE r.run_id = ? AND p.site_id = ? AND r.status = 200 AND (r.word_count IS NULL OR r.word_count = 0) AND COALESCE(r.rendered, 0) != 1
       ORDER BY p.url`,
    )
    .all(runId, siteId) as { url: string; errors: string | null }[];
  return rows
    .filter((r) => !(JSON.parse(r.errors ?? "[]") as { code: string }[]).some((e) => e.code === "NOT_HTML"))
    .map((r) => r.url);
}
