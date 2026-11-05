import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestMetricaJsonl } from "./metrica.js";

const RUN = readFileSync(new URL("../../tests/fixtures/metrica/traffic-2026-10.jsonl", import.meta.url), "utf8");
let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-metrica-"));
  store = openStore(join(dir, "m.sqlite"));
  upsertSite(store, { id: "s1", name: "Example", canonicalOrigin: "https://www.bulmacalig.com", sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = () => (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE source = 'yandex_metrica'").get() as { n: number }).n;

describe("ingestMetricaJsonl", () => {
  it("writes visits and users per traffic source as site-level observations", () => {
    const r = ingestMetricaJsonl(store, "s1", RUN);
    expect(r).toMatchObject({ lines: 6, ingested: 6, skipped: 0 });
    expect(count()).toBe(12);
    const direct = store.sqlite
      .prepare("SELECT value, entity_type, entity_id FROM observations WHERE source = 'yandex_metrica' AND metric = 'ym:s:visits' AND dimensions_json LIKE '%Direct traffic%'")
      .get();
    expect(direct).toEqual({ value: 235, entity_type: "site", entity_id: "113337943" });
  });

  it("is idempotent for the same period", () => {
    ingestMetricaJsonl(store, "s1", RUN);
    ingestMetricaJsonl(store, "s1", RUN);
    expect(count()).toBe(12);
  });
});
