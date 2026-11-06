// Runs the built CLI (dist/cli.js) against a temp database, the same way the plugin's commands invoke it. Requires a built core.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "./db/store.js";
import { ingestCrawlJsonl } from "./ingest/crawl.js";

const CLI = resolve(__dirname, "../dist/cli.js");
const ACCESS_FIXTURE = resolve(__dirname, "../tests/fixtures/geo/access.json");
const CRAWL_FIXTURE = readFileSync(resolve(__dirname, "../tests/fixtures/geo/site-run.jsonl"), "utf8");
const ORIGIN = "https://example.com";

let dir: string;
let dbPath: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-cli-"));
  dbPath = join(dir, "cli.sqlite");
  store = openStore(dbPath);
  upsertSite(store, { id: "s1", name: "Example", canonicalOrigin: ORIGIN, sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[]) {
  return spawnSync("node", [CLI, ...args], { env: { ...process.env, AWESOME_SEO_DB: dbPath }, encoding: "utf8" });
}

const accessRowCount = () => (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE metric IN ('robots_readable','llms_txt_valid','ai_blocked_urls')").get() as { n: number }).n;

describe("awesome-seo CLI", () => {
  it("migrates an empty database to the current schema version", () => {
    // Given: a new database path
    const fresh = join(dir, "fresh.sqlite");

    // When
    const r = spawnSync("node", [CLI, "migrate"], { env: { ...process.env, AWESOME_SEO_DB: fresh }, encoding: "utf8" });

    // Then
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, schemaVersion: 3 });
  });

  it("access-ingest stores robots, llms.txt and per-agent block counts for a seeded site", () => {
    // Given: a seeded site and an access report

    // When
    const r = cli(["access-ingest", "--origin", ORIGIN, ACCESS_FIXTURE]);

    // Then
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, origin: ORIGIN, observations: 12 });
    expect(accessRowCount()).toBe(12);
  });

  it("access-ingest is idempotent: ingesting the same report twice keeps the same rows", () => {
    // Given: the report was already ingested once
    expect(cli(["access-ingest", "--origin", ORIGIN, ACCESS_FIXTURE]).status).toBe(0);

    // When
    const r = cli(["access-ingest", "--origin", ORIGIN, ACCESS_FIXTURE]);

    // Then
    expect(r.status).toBe(0);
    expect(accessRowCount()).toBe(12);
  });

  it("access-ingest prints usage when the origin or the file is missing", () => {
    // Given: no origin

    // When
    const r = cli(["access-ingest", ACCESS_FIXTURE]);

    // Then
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage: awesome-seo access-ingest --origin");
  });

  it("access-ingest refuses a site that was never seeded", () => {
    // Given: an origin with no site row

    // When
    const r = cli(["access-ingest", "--origin", "https://other.example", ACCESS_FIXTURE]);

    // Then
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("No seeded site for https://other.example");
    expect(accessRowCount()).toBe(0);
  });

  it("access-ingest rejects a file that is not an access report and stores nothing", () => {
    // Given: a JSON file with the wrong shape
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ hello: "world" }));

    // When
    const r = cli(["access-ingest", "--origin", ORIGIN, bad]);

    // Then
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Error:");
    expect(accessRowCount()).toBe(0);
  });

  it("geo-audit with --access reports crawler access as checked", () => {
    // Given: a crawl run and an access report for the same site
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);

    // When
    const r = cli(["geo-audit", "--origin", ORIGIN, "--access", ACCESS_FIXTURE]);

    // Then
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("robots.txt readable: yes. llms.txt valid: yes.");
    expect(r.stdout).not.toContain("AI crawler access: not checked.");
  });

  it("geo-audit reports the run with the most URLs by default, not the most recent one", () => {
    // Given: the 9-URL fixture run, and a newer 2-URL run for the same site
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);
    const bigRunId = JSON.parse(CRAWL_FIXTURE.split("\n")[0] as string).run_id as string;
    const smallRun = CRAWL_FIXTURE.split("\n").slice(0, 2).map((line) => {
      const row = JSON.parse(line);
      return JSON.stringify({ ...row, run_id: "small-run", fetched_at: "2099-01-01T00:00:00.000Z" });
    }).join("\n");
    ingestCrawlJsonl(store, "s1", smallRun, null);

    // When: no --run is given
    const r = cli(["geo-audit", "--origin", ORIGIN]);

    // Then
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Crawl run: ${bigRunId} (9 URL(s)`);
    expect(r.stdout).not.toContain("Crawl run: small-run");
  });

  it("geo-audit without a crawl run fails with guidance to run the crawl first", () => {
    // Given: a seeded site with no crawl run

    // When
    const r = cli(["geo-audit", "--origin", ORIGIN]);

    // Then
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("No crawl run found for this site. Run /crawl-run first.");
  });
});
