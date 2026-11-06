import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { ingestCrawlJsonl } from "../ingest/crawl.js";
import { buildTechnicalReport } from "./technical-audit.js";

const SITE_ID = "site-1";
const ORIGIN = "https://example.com";
const RUN = "tech-run";

// One crawl record. Defaults describe a clean 200 page with an h1 and a canonical equal to the final URL.
function record(url: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    run_id: RUN, fetched_at: "2026-11-05T10:00:00.000Z", url, status: 200, final_url: url, redirect_chain: [],
    content_type: "text/html", title: `Title ${url}`, meta_description: null, canonical: url, lang: "tr", hreflang: [],
    headings: [{ level: 1, text: "H" }], word_count: 400, content_hash: "sha256:x", structured_data: [],
    jsonld_syntax_errors: 0, robots_allowed: true, raw_html_path: null, errors: [], ...over,
  });
}

// Six URLs with known answers:
//  /clean        200, clean (also carries one hreflang alternate)
//  /moved        200 after 1 redirect hop, no canonical, title shared with /shared-b, no h1
//  /shared-b     200, title shared with /moved
//  /private/x    robots-blocked, not fetched
//  /broken       HTTP 500, not fetched
//  /doc.pdf      not HTML, not fetched
const LINES = [
  record(`${ORIGIN}/clean`, { hreflang: [{ lang: "en", href: `${ORIGIN}/en/clean` }] }),
  record(`${ORIGIN}/moved`, {
    final_url: `${ORIGIN}/moved-final`, canonical: null, title: "Shared", headings: [{ level: 2, text: "Only h2" }],
    redirect_chain: [{ from: `${ORIGIN}/moved`, status: 301, to: `${ORIGIN}/moved-final` }],
  }),
  record(`${ORIGIN}/shared-b`, { title: "Shared", canonical: `${ORIGIN}/shared-canon` }),
  record(`${ORIGIN}/private/x`, { status: null, final_url: `${ORIGIN}/private/x`, robots_allowed: false, errors: [{ code: "ROBOTS_DISALLOWED", message: "blocked", retryable: false }] }),
  record(`${ORIGIN}/broken`, { status: 500, final_url: `${ORIGIN}/broken`, errors: [{ code: "HTTP_ERROR", message: "HTTP 500", retryable: true }] }),
  record(`${ORIGIN}/doc.pdf`, { content_type: "application/pdf", errors: [{ code: "NOT_HTML", message: "not HTML", retryable: false }] }),
].join("\n");

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-tech-"));
  store = openStore(join(dir, "tech.sqlite"));
  upsertSite(store, { id: SITE_ID, name: "Example", canonicalOrigin: ORIGIN, sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
  ingestCrawlJsonl(store, SITE_ID, LINES, null);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const report = () => buildTechnicalReport(store, { siteId: SITE_ID, origin: ORIGIN, runId: RUN });
const section = (text: string, heading: string) => {
  const start = text.indexOf(`## ${heading}`);
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next === -1 ? undefined : next);
};

describe("buildTechnicalReport", () => {
  it("counts fetched, robots-blocked and errored URLs so they add up to the run", () => {
    const out = report();

    expect(section(out, "Counts")).toContain("- Fetched (no failures): 4, of which HTML pages with status 200: 3, of which not HTML: 1.");
    expect(section(out, "Counts")).toContain("- Robots-blocked (not fetched): 1.");
    expect(section(out, "Counts")).toContain("- Errors (not fetched): 1. By code: HTTP_ERROR 1.");
    expect(section(out, "Counts")).toContain("matches");
    expect(section(out, "Counts")).not.toContain("NOT_HTML 1");
  });

  it("lists the redirected URL with its hop count and final status, citing its row", () => {
    const sec = section(report(), "Redirects");

    expect(sec).toContain("- URLs with one or more redirect hops: 1.");
    expect(sec).toMatch(/- https:\/\/example\.com\/moved — 1 hop\(s\), final status 200 at https:\/\/example\.com\/moved-final \[row [0-9a-f-]{36}\]/);
  });

  it("reports missing canonical and a canonical that differs from the final URL", () => {
    const sec = section(report(), "Canonical");

    expect(sec).toContain("- Missing canonical (200 pages): 1.");
    expect(sec).toContain("https://example.com/moved — no canonical link");
    expect(sec).toContain("- Canonical differs from the final URL (200 pages): 1.");
    expect(sec).toContain(`https://example.com/shared-b — canonical ${ORIGIN}/shared-canon, final ${ORIGIN}/shared-b`);
  });

  it("reports titles shared by more than one URL", () => {
    const sec = section(report(), "Titles");

    expect(sec).toContain("- Missing title (200 pages): 0.");
    expect(sec).toContain("- Titles shared by more than one URL: 1 title(s) on 2 URL(s).");
    expect(sec).toContain('shared title "Shared"');
  });

  it("lists pages with hreflang alternates without judging reciprocity", () => {
    const sec = section(report(), "Hreflang");

    expect(sec).toContain("- Pages listing alternates: 1 (1 alternate link(s)). Reciprocity is not judged in this version.");
    expect(sec).toContain("https://example.com/clean — alternates: en");
  });

  it("lists 200 pages with no h1", () => {
    const sec = section(report(), "Headings");

    expect(sec).toContain("- 200 pages with no h1: 1.");
    expect(sec).toContain("https://example.com/moved — no h1");
  });

  it("states robots-blocked URLs are not fetched and not missing, and that non-HTML has no on-page fields", () => {
    const sec = section(report(), "Missing data");

    expect(sec).toContain("- 1 URL(s) are not HTML (NOT_HTML): no on-page fields for them.");
    expect(sec).toContain("- 1 URL(s) were robots-blocked and not fetched. They are not counted as missing.");
  });

  it("lists Search Console pages that the crawl run did not check", () => {
    const out = buildTechnicalReport(store, {
      siteId: SITE_ID, origin: ORIGIN, runId: RUN,
      searchPages: [`${ORIGIN}/clean`, `${ORIGIN}/category/old`, `${ORIGIN}/category/old`, `${ORIGIN}/product/gone`],
    });
    const sec = section(out, "Coverage");

    expect(sec).toContain("- Search Console pages not in this crawl run: 2. Their status, redirects and canonical were not checked.");
    expect(sec).toContain(`- ${ORIGIN}/category/old — not crawled`);
    expect(sec).toContain(`- ${ORIGIN}/product/gone — not crawled`);
    expect(sec).not.toContain(`${ORIGIN}/clean — not crawled`);
  });

  it("says Search Console coverage was not checked when no Search Console file is given", () => {
    expect(section(report(), "Coverage")).toContain("- Search Console pages not in this crawl run: not checked (no Search Console file given).");
  });

  it("keeps a run completed when its only non-HTML URL was fetched", () => {
    const textOnly = record(`${ORIGIN}/readme.txt`, { run_id: "text-run", content_type: "text/plain", errors: [{ code: "NOT_HTML", message: "not HTML", retryable: false }] });
    ingestCrawlJsonl(store, SITE_ID, textOnly, null);

    const status = (store.sqlite.prepare("SELECT status FROM crawl_runs WHERE id = ?").get("text-run") as { status: string }).status;

    expect(status).toBe("completed");
  });

  it("marks the run partial when any URL failed", () => {
    expect(report()).toContain("- URLs in the run: 6. Run status: partial (some URLs failed).");
  });
});
