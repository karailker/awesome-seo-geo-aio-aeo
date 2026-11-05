// Sitemap vs search source URL sets (ROADMAP P3/P8). A source's pages count if their observation period overlaps the report period.
import { normalizeUrl } from "../domain.js";
import type { Store } from "../db/store.js";

export type SearchSource = "gsc" | "bing";
export const SOURCE_LABEL: Record<SearchSource, string> = { gsc: "Search Console", bing: "Bing Webmaster" };

export type Reconciliation = {
  source: SearchSource;
  sitemapCount: number;
  sourcePageCount: number;
  sitemapOnly: string[]; // in sitemap, no page data from this source in the period
  sourceOnly: string[]; // page data from this source, not in the sitemap
  both: number;
};

function canonical(url: string): string | null {
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

export function reconcileSitemapWith(store: Store, siteId: string, source: SearchSource, periodStart: string, periodEnd: string): Reconciliation {
  const sitemapUrls = new Set(
    (store.sqlite.prepare("SELECT url FROM pages WHERE site_id = ? AND source = 'sitemap'").pluck().all(siteId) as string[])
      .map(canonical)
      .filter((u): u is string => u !== null),
  );
  const sourceUrls = new Set(
    (store.sqlite
      .prepare(
        "SELECT DISTINCT entity_id FROM observations WHERE site_id = ? AND source = ? AND entity_type = 'page' AND period_start <= ? AND period_end >= ?",
      )
      .pluck()
      .all(siteId, source, periodEnd, periodStart) as string[])
      .map(canonical)
      .filter((u): u is string => u !== null),
  );
  return {
    source,
    sitemapCount: sitemapUrls.size,
    sourcePageCount: sourceUrls.size,
    sitemapOnly: [...sitemapUrls].filter((u) => !sourceUrls.has(u)).sort(),
    sourceOnly: [...sourceUrls].filter((u) => !sitemapUrls.has(u)).sort(),
    both: [...sitemapUrls].filter((u) => sourceUrls.has(u)).length,
  };
}

// Search Console only (kept for callers that predate multi-source reconciliation).
export function reconcileSitemapWithGsc(store: Store, siteId: string, periodStart: string, periodEnd: string): Reconciliation {
  return reconcileSitemapWith(store, siteId, "gsc", periodStart, periodEnd);
}
