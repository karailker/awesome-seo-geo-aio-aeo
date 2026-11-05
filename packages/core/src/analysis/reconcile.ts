// Sitemap vs Search Console URL sets (ROADMAP P3: reconciliation identifies URLs in one and not the other).
import { normalizeUrl } from "../domain.js";
import type { Store } from "../db/store.js";

export type Reconciliation = {
  sitemapCount: number;
  gscPageCount: number;
  sitemapOnly: string[]; // in sitemap, no GSC page data in the period
  gscOnly: string[]; // in GSC page data, not in the sitemap
  both: number;
};

function canonical(url: string): string | null {
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

export function reconcileSitemapWithGsc(
  store: Store,
  siteId: string,
  periodStart: string,
  periodEnd: string,
): Reconciliation {
  const sitemapUrls = new Set(
    (store.sqlite
      .prepare("SELECT url FROM pages WHERE site_id = ? AND source = 'sitemap'")
      .pluck()
      .all(siteId) as string[])
      .map(canonical)
      .filter((u): u is string => u !== null),
  );
  const gscUrls = new Set(
    (store.sqlite
      .prepare(
        "SELECT DISTINCT entity_id FROM observations WHERE site_id = ? AND source = 'gsc' AND entity_type = 'page' AND period_start = ? AND period_end = ?",
      )
      .pluck()
      .all(siteId, periodStart, periodEnd) as string[])
      .map(canonical)
      .filter((u): u is string => u !== null),
  );

  const sitemapOnly = [...sitemapUrls].filter((u) => !gscUrls.has(u)).sort();
  const gscOnly = [...gscUrls].filter((u) => !sitemapUrls.has(u)).sort();
  return {
    sitemapCount: sitemapUrls.size,
    gscPageCount: gscUrls.size,
    sitemapOnly,
    gscOnly,
    both: [...sitemapUrls].filter((u) => gscUrls.has(u)).length,
  };
}
