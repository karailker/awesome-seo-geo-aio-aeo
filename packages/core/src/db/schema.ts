// Drizzle schema for the P1 tables in docs/DATA-MODEL.md.
// schema_migrations is created by the migration runner (store.ts), not here.
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  canonicalOrigin: text("canonical_origin").notNull().unique(),
  sitemapUrl: text("sitemap_url"),
  urlCap: integer("url_cap").notNull().default(500),
  createdAt: text("created_at").notNull(),
});

export const siteProperties = sqliteTable(
  "site_properties",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
  },
  (t) => [uniqueIndex("uq_site_properties_site_provider").on(t.siteId, t.provider)],
);

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  authType: text("auth_type").notNull(),
  credentialRef: text("credential_ref").notNull(), // a name, never the secret
  scopesJson: text("scopes_json"),
  status: text("status").notNull(),
  lastCheckedAt: text("last_checked_at"),
});

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    url: text("url").notNull(),
    source: text("source").notNull(),
    lastmod: text("lastmod"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [uniqueIndex("uq_pages_site_url").on(t.siteId, t.url)],
);

export const observations = sqliteTable(
  "observations",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    source: text("source").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    unit: text("unit"),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    collectedAt: text("collected_at").notNull(),
    freshness: text("freshness").notNull(),
    dimensionsJson: text("dimensions_json"),
    provenanceJson: text("provenance_json"),
  },
  (t) => [
    index("idx_observations_lookup").on(t.siteId, t.source, t.metric, t.periodStart),
    index("idx_observations_entity").on(t.siteId, t.entityType, t.entityId),
  ],
);

export const apiCache = sqliteTable("api_cache", {
  cacheKey: text("cache_key").primaryKey(),
  responseJson: text("response_json").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});
