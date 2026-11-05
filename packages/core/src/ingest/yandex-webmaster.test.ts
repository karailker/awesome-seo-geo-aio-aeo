import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestYandexWebmasterJsonl } from "./yandex-webmaster.js";

const RUN = readFileSync(new URL("../../tests/fixtures/yandex/in-search.jsonl", import.meta.url), "utf8");
let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-yw-"));
  store = openStore(join(dir, "y.sqlite"));
  upsertSite(store, { id: "s1", name: "Example", canonicalOrigin: "https://www.bulmacalig.com", sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ingestYandexWebmasterJsonl", () => {
  it("writes one in-search observation per URL, marked as a snapshot", () => {
    const r = ingestYandexWebmasterJsonl(store, "s1", RUN);
    expect(r).toMatchObject({ lines: 30, ingested: 30, skipped: 0 });
    const row = store.sqlite
      .prepare("SELECT entity_id, value, freshness FROM observations WHERE source = 'yandex_webmaster' LIMIT 1")
      .get() as { entity_id: string; value: number; freshness: string };
    expect(row.value).toBe(1);
    expect(row.freshness).toBe("snapshot");
    expect(row.entity_id).toContain("bulmacalig.com/");
  });

  it("is idempotent for the same snapshot", () => {
    ingestYandexWebmasterJsonl(store, "s1", RUN);
    ingestYandexWebmasterJsonl(store, "s1", RUN);
    const n = (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'yandex_webmaster'").get() as { n: number }).n;
    expect(n).toBe(30);
  });
});
