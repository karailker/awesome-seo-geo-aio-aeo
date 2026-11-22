// Search Console page URLs as crawl input. The crawl normally starts from the sitemap, so pages that only Search
// Console knows (old URL structures, parameters, other hosts) are never checked. These helpers find them.
import type { Store } from "./db/store.js";
import { normalizeUrl } from "./domain.js";

// Page URLs from Search Console JSONL files (the output of google_gsc_search_analytics with the page dimension).
// Each URL appears once, normalised; lines that are not page rows or not http(s) URLs are skipped.
export function readSearchPages(texts: string[]): string[] {
  const pages = new Set<string>();
  for (const text of texts) {
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue;
      let page: unknown;
      try {
        page = (JSON.parse(raw) as { dimensions?: { page?: unknown } }).dimensions?.page;
      } catch {
        continue;
      }
      if (typeof page !== "string") continue;
      try {
        pages.add(normalizeUrl(page));
      } catch {
        /* not an http(s) URL */
      }
    }
  }
  return [...pages];
}

// The URLs that no crawl run of the site has fetched, in the order given.
export function uncrawledUrls(store: Store, siteId: string, urls: string[]): string[] {
  const crawled = new Set(
    (store.sqlite
      .prepare("SELECT DISTINCT p.url AS url FROM pages p JOIN crawl_results r ON r.page_id = p.id WHERE p.site_id = ?")
      .all(siteId) as { url: string }[]).map((r) => r.url),
  );
  return urls.filter((u) => !crawled.has(u));
}
