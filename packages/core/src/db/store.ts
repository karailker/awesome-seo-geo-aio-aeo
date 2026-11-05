// SQLite store: single writer (docs/DATA-MODEL.md). Opens with WAL, foreign keys, busy_timeout,
// and applies pending migrations from migrations/ (recorded in schema_migrations).
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  normalizeUrl,
  ObservationSchema,
  PageSchema,
  SiteSchema,
  type Observation,
  type Page,
  type Site,
} from "../domain.js";
import * as schema from "./schema.js";

// Same depth from src/db and dist/db, so this resolves in both.
const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

export type Store = {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close: () => void;
};

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  applyMigrations(sqlite);
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}

// Returns the file names applied in this call. Re-running is a no-op.
export function applyMigrations(sqlite: Database.Database): string[] {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const done = new Set(
    sqlite.prepare("SELECT version FROM schema_migrations").pluck().all() as number[],
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (done.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(version, file, new Date().toISOString());
    })();
    applied.push(file);
  }
  return applied;
}

// All statements on the store's connection inside fn share one transaction; a throw rolls back.
export function withTransaction<T>(store: Store, fn: () => T): T {
  return store.sqlite.transaction(fn)();
}

export function upsertSite(store: Store, input: Site): void {
  const site = SiteSchema.parse(input);
  store.db
    .insert(schema.sites)
    .values(site)
    .onConflictDoUpdate({
      target: schema.sites.id,
      set: {
        name: site.name,
        canonicalOrigin: site.canonicalOrigin,
        sitemapUrl: site.sitemapUrl,
        urlCap: site.urlCap,
      },
    })
    .run();
}

// Keyed by (siteId, url). Re-seeing a page updates lastmod and lastSeenAt only.
export function upsertPage(store: Store, input: Page): void {
  const page = PageSchema.parse({ ...input, url: normalizeUrl(input.url) });
  store.db
    .insert(schema.pages)
    .values(page)
    .onConflictDoUpdate({
      target: [schema.pages.siteId, schema.pages.url],
      set: { lastmod: page.lastmod, lastSeenAt: page.lastSeenAt },
    })
    .run();
}

export function insertObservation(store: Store, input: Observation): void {
  const { dimensions, provenance, ...row } = ObservationSchema.parse(input);
  store.db
    .insert(schema.observations)
    .values({
      ...row,
      dimensionsJson: dimensions === null ? null : JSON.stringify(dimensions),
      provenanceJson: provenance === null ? null : JSON.stringify(provenance),
    })
    .run();
}
