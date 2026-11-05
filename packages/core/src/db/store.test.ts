import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeUrl, ObservationSchema, type Site } from "../domain.js";
import { applyMigrations, insertObservation, openStore, upsertPage, upsertSite, withTransaction, type Store } from "./store.js";

const site: Site = {
  id: "site-1",
  name: "Example",
  canonicalOrigin: "https://example.com",
  sitemapUrl: "https://example.com/sitemap.xml",
  urlCap: 500,
  createdAt: "2026-11-04T18:00:00.000Z",
};

let dir: string;
let dbPath: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-store-"));
  dbPath = join(dir, "test.sqlite");
  store = openStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("migrations", () => {
  it("applies pending migrations once and is a no-op on reopen", () => {
    expect(store.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    store.close();

    const reopened = openStore(dbPath);
    const appliedAgain = applyMigrations(reopened.sqlite);
    const versions = reopened.sqlite
      .prepare("SELECT version FROM schema_migrations")
      .pluck()
      .all();
    reopened.close();
    store = openStore(dbPath);

    expect(appliedAgain).toEqual([]);
    expect(versions).toEqual([0, 1]);
  });
});

describe("site and page writes", () => {
  it("rejects a page whose site does not exist (foreign keys on)", () => {
    expect(() =>
      upsertPage(store, {
        id: "page-1",
        siteId: "missing-site",
        url: "https://example.com/a",
        source: "sitemap",
        lastmod: null,
        firstSeenAt: "2026-11-04T18:00:00.000Z",
        lastSeenAt: "2026-11-04T18:00:00.000Z",
      }),
    ).toThrow(/FOREIGN KEY/);
  });

  it("keeps one page row per site and normalized url, updating lastSeenAt", () => {
    upsertSite(store, site);
    const base = {
      siteId: site.id,
      source: "sitemap" as const,
      lastmod: null,
      firstSeenAt: "2026-11-04T18:00:00.000Z",
    };

    upsertPage(store, { ...base, id: "page-1", url: "https://example.com/a#top", lastSeenAt: "2026-11-04T18:00:00.000Z" });
    upsertPage(store, { ...base, id: "page-2", url: "https://example.com/a", lastmod: "2026-11-01", lastSeenAt: "2026-11-05T09:00:00.000Z" });

    const rows = store.sqlite.prepare("SELECT id, url, lastmod, last_seen_at FROM pages").all();
    expect(rows).toEqual([
      { id: "page-1", url: "https://example.com/a", lastmod: "2026-11-01", last_seen_at: "2026-11-05T09:00:00.000Z" },
    ]);
  });

  it("rolls back every write in a transaction that throws", () => {
    upsertSite(store, site);

    expect(() =>
      withTransaction(store, () => {
        upsertPage(store, {
          id: "page-1",
          siteId: site.id,
          url: "https://example.com/a",
          source: "sitemap",
          lastmod: null,
          firstSeenAt: "2026-11-04T18:00:00.000Z",
          lastSeenAt: "2026-11-04T18:00:00.000Z",
        });
        throw new Error("boom");
      }),
    ).toThrow("boom");

    const count = store.sqlite.prepare("SELECT COUNT(*) AS n FROM pages").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("stores observation dimensions as JSON text", () => {
    upsertSite(store, site);
    insertObservation(
      store,
      ObservationSchema.parse({
        id: "obs-1",
        siteId: site.id,
        source: "gsc",
        entityType: "page",
        entityId: "https://example.com/a",
        metric: "clicks",
        value: 12,
        unit: null,
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        collectedAt: "2026-11-04T18:00:00.000Z",
        freshness: "daily",
        dimensions: { device: "MOBILE" },
        provenance: null,
      }),
    );

    const row = store.sqlite.prepare("SELECT value, dimensions_json, provenance_json FROM observations").get();
    expect(row).toEqual({ value: 12, dimensions_json: '{"device":"MOBILE"}', provenance_json: null });
  });

  it("rejects a non-finite observation value before writing", () => {
    upsertSite(store, site);
    expect(() =>
      insertObservation(store, {
        id: "obs-2",
        siteId: site.id,
        source: "psi",
        entityType: "page",
        entityId: "https://example.com/a",
        metric: "lab_lcp_ms",
        value: Number.NaN,
        unit: "ms",
        periodStart: null,
        periodEnd: null,
        collectedAt: "2026-11-04T18:00:00.000Z",
        freshness: "snapshot",
        dimensions: null,
        provenance: null,
      }),
    ).toThrow();
  });
});

describe("normalizeUrl", () => {
  it("strips the fragment and rejects non-http(s) schemes", () => {
    expect(normalizeUrl("https://example.com/a?x=1#frag")).toBe("https://example.com/a?x=1");
    expect(() => normalizeUrl("ftp://example.com/a")).toThrow(/Unsupported URL protocol/);
  });
});
