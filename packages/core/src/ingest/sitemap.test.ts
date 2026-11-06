import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestSitemapJsonl } from "./sitemap.js";

const FIXTURE = readFileSync(
  new URL("../../tests/fixtures/sitemap/index-run.jsonl", import.meta.url),
  "utf8",
);
const SITE_ID = "site-1";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-ingest-"));
  store = openStore(join(dir, "ingest.sqlite"));
  upsertSite(store, {
    id: SITE_ID,
    name: "Example",
    canonicalOrigin: "https://example.com",
    sitemapUrl: "https://example.com/index.xml",
    urlCap: 500,
    createdAt: "2026-11-05T09:00:00.000Z",
  });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function pageRows() {
  return store.sqlite
    .prepare("SELECT url, source, lastmod, first_seen_at, last_seen_at FROM pages ORDER BY url")
    .all() as {
    url: string;
    source: string;
    lastmod: string | null;
    first_seen_at: string;
    last_seen_at: string;
  }[];
}

describe("ingestSitemapJsonl", () => {
  it("creates one sitemap page per discovered URL with its lastmod", () => {
    const result = ingestSitemapJsonl(store, SITE_ID, FIXTURE);

    expect(result).toMatchObject({ lines: 3, ingested: 3, skipped: 0 });
    const rows = pageRows();
    expect(rows.map((r) => r.url)).toEqual([
      "https://example.com/blog/post-1",
      "https://example.com/blog/post-2",
      "https://example.com/products/widget",
    ]);
    expect(rows.every((r) => r.source === "sitemap")).toBe(true);
    expect(rows[0]?.lastmod).toBe("2026-09-15T08:00:00+00:00");
    expect(rows[1]?.lastmod).toBeNull();
  });

  it("is idempotent: re-running the same run keeps one row per URL", () => {
    ingestSitemapJsonl(store, SITE_ID, FIXTURE);
    const before = pageRows();

    ingestSitemapJsonl(store, SITE_ID, FIXTURE);

    expect(pageRows()).toEqual(before);
  });

  it("keeps firstSeenAt from the first run and moves lastSeenAt on later runs", () => {
    ingestSitemapJsonl(store, SITE_ID, FIXTURE);
    const later = FIXTURE.replaceAll("2026-11-05T10:00:00+00:00", "2026-11-12T10:00:00+00:00");

    ingestSitemapJsonl(store, SITE_ID, later);

    const row = pageRows().find((r) => r.url === "https://example.com/blog/post-1");
    expect(row?.first_seen_at).toBe("2026-11-05T10:00:00+00:00");
    expect(row?.last_seen_at).toBe("2026-11-12T10:00:00+00:00");
  });

  it("reports zero new URLs when the same sitemap is ingested again", () => {
    ingestSitemapJsonl(store, SITE_ID, FIXTURE);

    const again = ingestSitemapJsonl(store, SITE_ID, FIXTURE);

    expect(again.ingested).toBe(3);
    expect(again.created).toBe(0);
    expect(pageRows()).toHaveLength(3);
  });

  it("skips invalid lines and reports them without failing the run", () => {
    const withBadLines = `not json\n${FIXTURE}{"run_id":"x"}\n`;

    const result = ingestSitemapJsonl(store, SITE_ID, withBadLines);

    expect(result.ingested).toBe(3);
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(2);
    expect(result.errors[0]).toMatch(/^line 1: not valid JSON/);
    expect(pageRows()).toHaveLength(3);
  });

  it("refuses to write for a site that was never seeded", () => {
    expect(() => ingestSitemapJsonl(store, "unknown-site", FIXTURE)).toThrow(/FOREIGN KEY/);
    expect(pageRows()).toHaveLength(0);
  });
});
