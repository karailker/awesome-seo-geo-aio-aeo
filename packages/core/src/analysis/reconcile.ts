// Sitemap vs search source URL sets (ROADMAP P3/P8). Range sources count pages whose observation period overlaps
// the report period. The Yandex in-search list is a snapshot: it counts whatever was collected, and the report
// states the collection date.
import { normalizeUrl } from "../domain.js";
import type { Store } from "../db/store.js";

export type SearchSource = "gsc" | "bing" | "yandex";
export const SOURCE_LABEL: Record<SearchSource, string> = { gsc: "Search Console", bing: "Bing Webmaster", yandex: "Yandex Webmaster" };
// Observation source value for each search source.
const OBS_SOURCE: Record<SearchSource, string> = { gsc: "gsc", bing: "bing", yandex: "yandex_webmaster" };

export type Reconciliation = {
  source: SearchSource;
  snapshot: boolean;
  sitemapCount: number;
  sourcePageCount: number;
  sitemapOnly: string[]; // in sitemap, not in this source's page data
  sourceOnly: string[]; // in this source's page data, not in the sitemap
  both: number;
  collectedOn: string | null; // snapshot sources: latest collection date
};

function canonical(url: string): string | null {
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

export function reconcileSitemapWith(store: Store, siteId: string, source: SearchSource, periodStart: string, periodEnd: string): Reconciliation {
  const snapshot = source === "yandex";
  const sitemapUrls = new Set(
    (store.sqlite.prepare("SELECT url FROM pages WHERE site_id = ? AND source = 'sitemap'").pluck().all(siteId) as string[])
      .map(canonical)
      .filter((u): u is string => u !== null),
  );
  const rows = snapshot
    ? (store.sqlite
        .prepare("SELECT entity_id AS url, collected_at AS at FROM observations WHERE site_id = ? AND source = ? AND entity_type = 'page'")
        .all(siteId, OBS_SOURCE[source]) as { url: string; at: string }[])
    : (store.sqlite
        .prepare(
          "SELECT entity_id AS url, collected_at AS at FROM observations WHERE site_id = ? AND source = ? AND entity_type = 'page' AND period_start <= ? AND period_end >= ?",
        )
        .all(siteId, OBS_SOURCE[source], periodEnd, periodStart) as { url: string; at: string }[]);
  const sourceUrls = new Set(rows.map((r) => canonical(r.url)).filter((u): u is string => u !== null));
  const collectedOn = snapshot && rows.length ? rows.map((r) => r.at).sort().at(-1)!.slice(0, 10) : null;
  return {
    source,
    snapshot,
    sitemapCount: sitemapUrls.size,
    sourcePageCount: sourceUrls.size,
    sitemapOnly: [...sitemapUrls].filter((u) => !sourceUrls.has(u)).sort(),
    sourceOnly: [...sourceUrls].filter((u) => !sitemapUrls.has(u)).sort(),
    both: [...sitemapUrls].filter((u) => sourceUrls.has(u)).length,
    collectedOn,
  };
}

// Search Console only (kept for callers that predate multi-source reconciliation).
export function reconcileSitemapWithGsc(store: Store, siteId: string, periodStart: string, periodEnd: string): Reconciliation {
  return reconcileSitemapWith(store, siteId, "gsc", periodStart, periodEnd);
}
