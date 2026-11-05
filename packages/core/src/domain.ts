// Zod schemas for Site, Page, Observation (docs/DATA-MODEL.md) and URL normalization.
import { z } from "zod";

export const SiteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  canonicalOrigin: z.string().url(),
  sitemapUrl: z.string().url().nullable(),
  urlCap: z.number().int().positive(),
  createdAt: z.string().min(1), // ISO 8601 UTC
});
export type Site = z.infer<typeof SiteSchema>;

export const PAGE_SOURCES = ["sitemap", "gsc", "bing", "yandex", "crawl"] as const;

export const PageSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  url: z.string().url(),
  source: z.enum(PAGE_SOURCES),
  lastmod: z.string().nullable(),
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1),
});
export type Page = z.infer<typeof PageSchema>;

export const OBSERVATION_SOURCES = [
  "gsc",
  "ga4",
  "bing",
  "yandex_webmaster",
  "yandex_metrica",
  "merchant",
  "psi",
  "lighthouse-local",
  "crux",
  "crawl",
] as const;

export const ObservationSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  source: z.enum(OBSERVATION_SOURCES),
  entityType: z.enum(["site", "page", "query", "product", "sitemap"]),
  entityId: z.string().min(1),
  metric: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  collectedAt: z.string().min(1),
  freshness: z.enum(["realtime", "daily", "delayed", "snapshot"]),
  dimensions: z.record(z.unknown()).nullable(),
  provenance: z.record(z.unknown()).nullable(),
});
export type Observation = z.infer<typeof ObservationSchema>;

// Absolute http(s) URL, fragment removed. Throws on anything else.
export function normalizeUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
  url.hash = "";
  return url.toString();
}
