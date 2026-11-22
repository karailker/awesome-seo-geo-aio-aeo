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


describe("awesome-seo CLI", () => {
  it("migrates an empty database to the current schema version", () => {
    // Given: a new database path
    const fresh = join(dir, "fresh.sqlite");

    // When
    const r = spawnSync("node", [CLI, "migrate"], { env: { ...process.env, AWESOME_SEO_DB: fresh }, encoding: "utf8" });

    // Then
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, schemaVersion: 4 });
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

  it("gsc-urls writes the Search Console pages no crawl run fetched as crawl input", () => {
    // Given: a crawl run of the fixture site and a Search Console file with a crawled page, an uncrawled page and a www page
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);
    const gsc = join(dir, "pages.jsonl");
    const row = (page: string) => JSON.stringify({ run_id: "g", collected_at: "2026-11-05T00:00:00Z", site: "sc-domain:example.com", period_start: "2026-11-01", period_end: "2026-11-05", dimensions: { page }, clicks: 1, impressions: 5, ctr: 0.2, position: 3 });
    writeFileSync(gsc, [row("https://example.com/index.html"), row("https://example.com/gone"), row("https://www.example.com/x")].join("\n"));
    const out = join(dir, "out", "gsc-urls.jsonl");

    // When
    const r = cli(["gsc-urls", "--origin", ORIGIN, "--gsc", gsc, "--out", out]);

    // Then: only the two uncrawled URLs are written, one JSON line each with a url field
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, searchPages: 3, alreadyCrawled: 1, toCrawl: 2 });
    const lines = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { url: string });
    expect(lines.map((l) => l.url)).toEqual(["https://example.com/gone", "https://www.example.com/x"]);
  });

  it("gsc-urls prints usage when no Search Console file is given", () => {
    const r = cli(["gsc-urls", "--origin", ORIGIN]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage: awesome-seo gsc-urls");
  });

  it("technical-audit reports several runs when --run is repeated", () => {
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);
    const runA = JSON.parse(CRAWL_FIXTURE.split("\n")[0] as string).run_id as string;
    const extra = JSON.stringify({ ...JSON.parse(CRAWL_FIXTURE.split("\n")[0] as string), run_id: "extra-run", url: "https://example.com/extra-page", final_url: "https://example.com/extra-page", canonical: "https://example.com/extra-page" });
    ingestCrawlJsonl(store, "s1", extra, null);

    const r = cli(["technical-audit", "--origin", ORIGIN, "--run", runA, "--run", "extra-run"]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`- Crawl runs: ${runA}, extra-run`);
    expect(r.stdout).toContain("https://example.com/extra-page");
  });

  it("diff compares the two most recent crawl runs by default and lists what changed", () => {
    const base = JSON.parse(CRAWL_FIXTURE.split("\n")[0] as string);
    const older = JSON.stringify({ ...base, run_id: "older", fetched_at: "2026-11-01T10:00:00.000Z", url: "https://example.com/p", final_url: "https://example.com/p", content_hash: "sha256:one" });
    const newer = JSON.stringify({ ...base, run_id: "newer", fetched_at: "2026-11-08T10:00:00.000Z", url: "https://example.com/p", final_url: "https://example.com/p", content_hash: "sha256:two" });
    ingestCrawlJsonl(store, "s1", older, null);
    ingestCrawlJsonl(store, "s1", newer, null);

    const r = cli(["diff", "--origin", ORIGIN]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("- Older run: older (1 URL(s)). Newer run: newer (1 URL(s)).");
    expect(r.stdout).toContain("- Status changed: 0. Content changed: 1.");
  });

  it("diff needs two crawl runs and says so", () => {
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);

    const r = cli(["diff", "--origin", ORIGIN]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Need two crawl runs to compare");
  });

  it("diff --sitemap-old and --sitemap-new compares two sitemap snapshots", () => {
    const row = (url: string) => JSON.stringify({ run_id: "s", collected_at: "2026-11-01T00:00:00Z", url, lastmod: null, sitemap_url: "https://example.com/sitemap.xml" });
    const oldFile = join(dir, "old.jsonl");
    const newFile = join(dir, "new.jsonl");
    writeFileSync(oldFile, [row("https://example.com/a"), row("https://example.com/b")].join("\n"));
    writeFileSync(newFile, [row("https://example.com/a"), row("https://example.com/c")].join("\n"));

    const r = cli(["diff", "--origin", ORIGIN, "--sitemap-old", oldFile, "--sitemap-new", newFile]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("- Added: 1. Removed: 1. lastmod changed: 0.");
    expect(r.stdout).toContain("https://example.com/c — in the newer snapshot only");
    expect(r.stdout).toContain("https://example.com/b — in the older snapshot only");
  });

  it("geo-audit --access twice keeps the same stored access rows (idempotent)", () => {
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);
    expect(cli(["geo-audit", "--origin", ORIGIN, "--access", ACCESS_FIXTURE]).status).toBe(0);
    const rows = () => (store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE metric IN ('robots_readable','llms_txt_valid','ai_blocked_urls')").get() as { n: number }).n;
    const first = rows();

    expect(cli(["geo-audit", "--origin", ORIGIN, "--access", ACCESS_FIXTURE]).status).toBe(0);

    expect(first).toBe(12);
    expect(rows()).toBe(first);
  });

  it("geo-audit --access rejects a file that is not an access report and stores nothing", () => {
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ hello: "world" }));

    const r = cli(["geo-audit", "--origin", ORIGIN, "--access", bad]);

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Error:");
    expect((store.sqlite.prepare("SELECT COUNT(*) AS n FROM observations WHERE metric = 'ai_blocked_urls'").get() as { n: number }).n).toBe(0);
  });

  it("config --init writes a template and config prints the resolved sources", () => {
    const file = join(dir, "awesome-seo.json");

    const init = cli(["config", "--init", "--origin", "https://www.example.com", "--file", file]);
    const show = cli(["config", "--file", file]);

    expect(init.status).toBe(0);
    expect(show.status).toBe(0);
    const resolved = JSON.parse(show.stdout) as { origin: string; sitemap: string; sources: { gsc: { property: string }; ga4: { enabled: boolean } } };
    expect(resolved.origin).toBe("https://www.example.com");
    expect(resolved.sitemap).toBe("https://www.example.com/sitemap.xml");
    expect(resolved.sources.gsc.property).toBe("sc-domain:example.com");
    expect(resolved.sources.ga4.enabled).toBe(false);
  });

  it("config says how to create the file when it is missing, and names the bad key when it is invalid", () => {
    const missing = cli(["config", "--file", join(dir, "nope.json")]);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ origin: "https://example.com", ga4: { propertyId: "abc" } }));
    const invalid = cli(["config", "--file", bad]);

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("awesome-seo config --init --origin");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("ga4.propertyId");
  });

  it("audit prints one report: needs attention, missing data and the three reports", () => {
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);
    const gsc = resolve(__dirname, "../tests/fixtures/gsc/period-run.jsonl");

    const r = cli(["audit", "--origin", ORIGIN, "--mode", "quick", "--start", "2026-10-01", "--end", "2026-10-31", "--gsc", gsc, "--access", ACCESS_FIXTURE]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("# Site audit: https://example.com");
    expect(r.stdout).toContain("- Mode: quick.");
    expect(r.stdout).toContain("## Needs attention");
    expect(r.stdout).toContain("# Technical audit:");
    expect(r.stdout).toContain("# GEO / AIO / AEO audit:");
    expect(r.stdout).toContain("# SEO audit:");
  });

  it("audit without a period still reports the crawl and says the search part is missing", () => {
    ingestCrawlJsonl(store, "s1", CRAWL_FIXTURE, null);

    const r = cli(["audit", "--origin", ORIGIN]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("- Mode: deep.");
    expect(r.stdout).toContain("no period given, so the search part was not built");
  });

  it("audit rejects an unknown mode and a missing crawl run", () => {
    expect(cli(["audit", "--origin", ORIGIN, "--mode", "fast"]).stderr).toContain("--mode must be quick or deep");
    expect(cli(["audit", "--origin", ORIGIN]).stderr).toContain("No crawl run found for this site");
  });

  it("render-urls lists the text-less pages of a run and crawl-merge folds a rendered crawl into it", () => {
    // Given: a base run with one JavaScript shell
    const base = JSON.parse(CRAWL_FIXTURE.split("\n")[0] as string);
    const shell = { ...base, run_id: "base-run", url: "https://example.com/app", final_url: "https://example.com/app", word_count: 0, headings: [], rendered: false, errors: [], status: 200 };
    const ok = { ...base, run_id: "base-run", url: "https://example.com/ok", final_url: "https://example.com/ok", word_count: 300, rendered: false, errors: [], status: 200 };
    const baseFile = join(dir, "base.jsonl");
    writeFileSync(baseFile, [shell, ok].map((r) => JSON.stringify(r)).join("\n"));
    ingestCrawlJsonl(store, "s1", readFileSync(baseFile, "utf8"), null);
    const urlsFile = join(dir, "render-input.jsonl");

    // When: the render candidates are listed
    const list = cli(["render-urls", "--origin", ORIGIN, "--run", "base-run", "--out", urlsFile]);

    // Then: only the shell is listed
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toMatchObject({ ok: true, toRender: 1 });
    expect(readFileSync(urlsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l).url)).toEqual(["https://example.com/app"]);

    // And: a rendered crawl of it is merged into the base under a new run id
    const patchFile = join(dir, "patch.jsonl");
    writeFileSync(patchFile, JSON.stringify({ ...shell, run_id: "patch", word_count: 700, headings: [{ level: 1, text: "H" }], rendered: true }));
    const mergedFile = join(dir, "merged.jsonl");
    const merge = cli(["crawl-merge", "--base", baseFile, "--patch", patchFile, "--out", mergedFile, "--run-id", "base-run-rendered"]);

    expect(merge.status).toBe(0);
    const merged = readFileSync(mergedFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(merged.map((m) => m.run_id)).toEqual(["base-run-rendered", "base-run-rendered"]);
    expect(merged.find((m) => m.url.endsWith("/app"))).toMatchObject({ word_count: 700, rendered: true });
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
