import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestGa4Jsonl } from "./ga4.js";

const RUN = readFileSync(new URL("../../tests/fixtures/ga4/pages-2026-10.jsonl", import.meta.url), "utf8");
const SITE_ID = "site-1";
const ORIGIN = "https://www.bulmacalig.com";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-ga4-"));
  store = openStore(join(dir, "ga4.sqlite"));
  upsertSite(store, { id: SITE_ID, name: "Example", canonicalOrigin: ORIGIN, sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = () => (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'ga4'").get() as { n: number }).n;

describe("ingestGa4Jsonl", () => {
  it("writes one observation per metric per row, keyed by full page URL", () => {
    const result = ingestGa4Jsonl(store, SITE_ID, ORIGIN, RUN);

    expect(result).toMatchObject({ lines: 50, ingested: 50, skipped: 0 });
    expect(count()).toBe(50 * 3);
    const home = store.sqlite
      .prepare("SELECT value, freshness FROM observations WHERE source = 'ga4' AND entity_id = ? AND metric = 'sessions'")
      .get(`${ORIGIN}/`) as { value: number; freshness: string };
    expect(home).toEqual({ value: 435, freshness: "daily" });
  });

  it("is idempotent for the same period and updates values when re-collected", () => {
    ingestGa4Jsonl(store, SITE_ID, ORIGIN, RUN);
    ingestGa4Jsonl(store, SITE_ID, ORIGIN, RUN);
    expect(count()).toBe(150);

    ingestGa4Jsonl(store, SITE_ID, ORIGIN, RUN.replace('"sessions":435', '"sessions":500'));

    const v = store.sqlite
      .prepare("SELECT value FROM observations WHERE source = 'ga4' AND entity_id = ? AND metric = 'sessions'")
      .get(`${ORIGIN}/`) as { value: number };
    expect(v.value).toBe(500);
    expect(count()).toBe(150);
  });

  it("stores rows without a page dimension as site-level observations", () => {
    const siteRow = JSON.stringify({ run_id: "r1", collected_at: "2026-11-05T00:00:00Z", property_id: "552874034", period_start: "2026-10-01", period_end: "2026-10-31", dimensions: {}, metrics: { sessions: 1000 } });

    ingestGa4Jsonl(store, SITE_ID, ORIGIN, siteRow);

    const row = store.sqlite.prepare("SELECT entity_type, entity_id FROM observations WHERE source = 'ga4'").get();
    expect(row).toEqual({ entity_type: "site", entity_id: SITE_ID });
  });
});
