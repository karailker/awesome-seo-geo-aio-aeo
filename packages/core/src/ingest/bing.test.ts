import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestBingJsonl } from "./bing.js";

const RANK = readFileSync(new URL("../../tests/fixtures/bing/rank-2026-10.jsonl", import.meta.url), "utf8");
const PAGES = readFileSync(new URL("../../tests/fixtures/bing/pages.jsonl", import.meta.url), "utf8");
let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-bing-"));
  store = openStore(join(dir, "b.sqlite"));
  upsertSite(store, { id: "s1", name: "Example", canonicalOrigin: "https://bulmacalig.com", sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = () => (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'bing'").get() as { n: number }).n;

describe("ingestBingJsonl", () => {
  it("writes daily site impressions and page-level observations", () => {
    expect(ingestBingJsonl(store, "s1", RANK)).toMatchObject({ lines: 31, skipped: 0 });
    expect(ingestBingJsonl(store, "s1", PAGES)).toMatchObject({ lines: 8, skipped: 0 });
    const site = store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'bing' AND entity_type = 'site'").get() as { n: number };
    expect(site.n).toBe(31 * 2);
    const page = store.sqlite.prepare("SELECT entity_id FROM observations WHERE source = 'bing' AND entity_type = 'page' LIMIT 1").get() as { entity_id: string };
    expect(page.entity_id).toBe("https://www.bulmacalig.com/");
  });

  it("is idempotent for the same run", () => {
    ingestBingJsonl(store, "s1", PAGES);
    const first = count();
    ingestBingJsonl(store, "s1", PAGES);
    expect(count()).toBe(first);
  });
});
