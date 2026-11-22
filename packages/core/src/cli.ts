#!/usr/bin/env node
// `awesome-seo` CLI: database, ingest, reports, and the approval gate. Used by the plugin's commands and hook
// (via npx) and by the repo's pnpm scripts. The database path defaults to ./data/awesome-seo.sqlite
// (override with AWESOME_SEO_DB), so run it from the project directory.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  ACTION_TYPES,
  buildCrawlDiff,
  buildFullAudit,
  buildTechnicalReport,
  approveProposal,
  buildGeoReport,
  buildSeoAuditReport,
  createProposal,
  deriveCrawlObservations,
  diffSitemaps,
  findExecutable,
  ingestAccessReport,
  ingestBingJsonl,
  ingestCrawlJsonl,
  ingestGa4Jsonl,
  ingestGscJsonl,
  ingestMetricaJsonl,
  ingestSitemapJsonl,
  ingestYandexWebmasterJsonl,
  initConfig,
  mergeCrawl,
  readSearchPages,
  resolveConfig,
  renderSitemapDiff,
  uncrawledUrls,
  urlsNeedingRender,
  normalizeUrl,
  openStore,
  recordExecution,
  rejectProposal,
  upsertSite,
  type ActionType,
  type Payload,
  type Store,
} from "./index.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dbPath = (): string => process.env.AWESOME_SEO_DB ?? "data/awesome-seo.sqlite";
const out = (value: unknown): void => {
  console.log(typeof value === "string" ? value : JSON.stringify(value));
};
function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function originOf(raw: string): string {
  return new URL(normalizeUrl(raw)).origin;
}

function siteIdFor(store: Store, origin: string): string {
  const row = store.sqlite.prepare("SELECT id FROM sites WHERE canonical_origin = ?").get(origin) as { id: string } | undefined;
  if (!row) throw new Error(`No seeded site for ${origin}. Run: awesome-seo seed --origin ${origin}`);
  return row.id;
}

function parse(config: { options: NonNullable<ParseArgsConfig["options"]> }, args: string[]) {
  return parseArgs({ ...config, args, allowPositionals: true });
}

// ---- database
function cmdMigrate(): void {
  const store = openStore(dbPath());
  try {
    const schemaVersion = store.sqlite.prepare("SELECT MAX(version) AS v FROM schema_migrations").pluck().get();
    out({ ok: true, db: dbPath(), schemaVersion });
  } finally {
    store.close();
  }
}

function cmdSeed(args: string[]): void {
  const { values } = parse({ options: { origin: { type: "string" }, sitemap: { type: "string" }, name: { type: "string" }, "url-cap": { type: "string", default: "500" } } }, args);
  if (!values.origin) fail("Missing --origin, e.g. --origin https://example.com");
  const origin = originOf(values.origin as string);
  const sitemapUrl = normalizeUrl((values.sitemap as string | undefined) ?? `${origin}/sitemap.xml`);
  const urlCap = Number(values["url-cap"]);
  if (!Number.isInteger(urlCap) || urlCap <= 0) fail("--url-cap must be a positive integer");
  const store = openStore(dbPath());
  try {
    const existing = store.sqlite.prepare("SELECT id FROM sites WHERE canonical_origin = ?").get(origin) as { id: string } | undefined;
    upsertSite(store, {
      id: existing?.id ?? crypto.randomUUID(),
      name: (values.name as string | undefined) ?? new URL(origin).hostname,
      canonicalOrigin: origin,
      sitemapUrl,
      urlCap,
      createdAt: new Date().toISOString(),
    });
    out({ ok: true, db: dbPath(), origin, sitemapUrl, urlCap, created: !existing });
  } finally {
    store.close();
  }
}

// ---- ingest
function cmdIngest(kind: "sitemap" | "crawl", args: string[]): void {
  const { values, positionals } = parse({ options: { origin: { type: "string" } } }, args);
  const file = positionals[0];
  if (!values.origin || !file) fail(`Usage: awesome-seo ${kind}-ingest --origin https://example.com <file.jsonl>`);
  const origin = originOf(values.origin as string);
  const store = openStore(dbPath());
  try {
    const site = siteIdFor(store, origin);
    const text = readFileSync(file, "utf8");
    if (kind === "sitemap") out({ ok: true, db: dbPath(), origin, file, ...ingestSitemapJsonl(store, site, text) });
    else out({ ok: true, db: dbPath(), origin, file, ...ingestCrawlJsonl(store, site, text, file) });
  } finally {
    store.close();
  }
}

// ---- reports
// Loads the search-source files given on the command line into the store (idempotent).
type FeedValues = { gsc?: string[]; ga4?: string[]; metrica?: string[]; bing?: string[]; yandex?: string[] };
function feedSearchInputs(store: Store, siteId: string, origin: string, values: FeedValues): void {
  const feed: [string[] | undefined, (s: string, text: string) => unknown][] = [
    [values.gsc, (s, t) => ingestGscJsonl(store, s, t)],
    [values.ga4, (s, t) => ingestGa4Jsonl(store, s, origin, t)],
    [values.metrica, (s, t) => ingestMetricaJsonl(store, s, t)],
    [values.bing, (s, t) => ingestBingJsonl(store, s, t)],
    [values.yandex, (s, t) => ingestYandexWebmasterJsonl(store, s, t)],
  ];
  for (const [files, ingest] of feed) for (const f of files ?? []) ingest(siteId, readFileSync(f, "utf8"));
}

function cmdSeoAudit(args: string[]): void {
  const { values } = parse(
    {
      options: {
        origin: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        gsc: { type: "string", multiple: true },
        ga4: { type: "string", multiple: true },
        metrica: { type: "string", multiple: true },
        bing: { type: "string", multiple: true },
        yandex: { type: "string", multiple: true },
      },
    },
    args,
  );
  if (!values.origin || !values.start || !values.end || !DATE.test(values.start as string) || !DATE.test(values.end as string)) {
    fail("Usage: awesome-seo seo-audit --origin https://example.com --start YYYY-MM-DD --end YYYY-MM-DD [--gsc f] [--ga4 f] [--metrica f] [--bing f] [--yandex f]");
  }
  const origin = originOf(values.origin as string);
  const store = openStore(dbPath());
  try {
    const siteId = siteIdFor(store, origin);
    feedSearchInputs(store, siteId, origin, values as FeedValues);
    console.log(buildSeoAuditReport(store, { siteId, origin, periodStart: values.start as string, periodEnd: values.end as string }));
  } finally {
    store.close();
  }
}

function cmdTechnicalAudit(args: string[]): void {
  const { values } = parse({ options: { origin: { type: "string" }, run: { type: "string", multiple: true }, gsc: { type: "string", multiple: true } } }, args);
  if (!values.origin) fail("Usage: awesome-seo technical-audit --origin https://example.com [--run <run_id> ...] [--gsc <file.jsonl> ...]");
  const origin = originOf(values.origin as string);
  const store = openStore(dbPath());
  try {
    const siteId = siteIdFor(store, origin);
    // --run may be repeated: the first run is the main one, the others are reported together with it.
    const requested = (values.run as string[] | undefined) ?? [];
    for (const id of requested) {
      if (!store.sqlite.prepare("SELECT 1 FROM crawl_runs WHERE id = ? AND site_id = ?").get(id, siteId)) fail(`Crawl run not found for this site: ${id}`);
    }
    const main = requested.length > 0
      ? { id: requested[0] as string }
      : (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE site_id = ? ORDER BY url_count DESC, started_at DESC LIMIT 1").get(siteId) as { id: string } | undefined);
    if (!main) fail("No crawl run found for this site. Run /crawl-run first.");
    // Search Console page URLs from the given JSONL files (the gsc tool output); used for the coverage check.
    const searchPages = values.gsc ? readSearchPages((values.gsc as string[]).map((file) => readFileSync(file, "utf8"))) : undefined;
    console.log(buildTechnicalReport(store, { siteId, origin, runId: main.id, extraRunIds: requested.slice(1), searchPages }));
  } finally {
    store.close();
  }
}

// One report for the whole site: technical, GEO / AIO / AEO and SEO, with one ranked list and one Missing data list.
function cmdAudit(args: string[]): void {
  const { values } = parse(
    {
      options: {
        origin: { type: "string" }, mode: { type: "string" }, start: { type: "string" }, end: { type: "string" },
        run: { type: "string", multiple: true }, access: { type: "string" },
        gsc: { type: "string", multiple: true }, ga4: { type: "string", multiple: true }, metrica: { type: "string", multiple: true },
        bing: { type: "string", multiple: true }, yandex: { type: "string", multiple: true },
      },
    },
    args,
  );
  if (!values.origin) fail("Usage: awesome-seo audit --origin https://example.com [--mode quick|deep] [--start YYYY-MM-DD --end YYYY-MM-DD] [--run <run_id> ...] [--access file.json] [--gsc f] [--ga4 f] [--metrica f] [--bing f] [--yandex f]");
  const mode = (values.mode as string | undefined) ?? "deep";
  if (mode !== "quick" && mode !== "deep") fail("--mode must be quick or deep");
  const start = values.start as string | undefined;
  const end = values.end as string | undefined;
  if ((start || end) && (!start || !end || !DATE.test(start) || !DATE.test(end))) fail("--start and --end must both be given as YYYY-MM-DD");
  const origin = originOf(values.origin as string);
  const store = openStore(dbPath());
  try {
    const siteId = siteIdFor(store, origin);
    const requested = (values.run as string[] | undefined) ?? [];
    for (const id of requested) {
      if (!store.sqlite.prepare("SELECT 1 FROM crawl_runs WHERE id = ? AND site_id = ?").get(id, siteId)) fail(`Crawl run not found for this site: ${id}`);
    }
    const main = requested.length > 0
      ? { id: requested[0] as string }
      : (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE site_id = ? ORDER BY url_count DESC, started_at DESC LIMIT 1").get(siteId) as { id: string } | undefined);
    if (!main) fail("No crawl run found for this site. Run /crawl-run first.");
    if (values.access) ingestAccessReport(store, siteId, readFileSync(values.access as string, "utf8"));
    deriveCrawlObservations(store, siteId, main.id);
    feedSearchInputs(store, siteId, origin, values as FeedValues);
    const gsc = (values.gsc as string[] | undefined) ?? [];
    const searchPages = gsc.length > 0 ? readSearchPages(gsc.map((f) => readFileSync(f, "utf8"))) : undefined;
    console.log(buildFullAudit(store, { siteId, origin, runId: main.id, extraRunIds: requested.slice(1), mode, periodStart: start, periodEnd: end, searchPages }).report);
  } finally {
    store.close();
  }
}

// Pages of a crawl run that returned no text in the static HTML, written as crawl input for a render=true crawl.
function cmdRenderUrls(args: string[]): void {
  const { values } = parse({ options: { origin: { type: "string" }, run: { type: "string" }, out: { type: "string" } } }, args);
  if (!values.origin) fail("Usage: awesome-seo render-urls --origin https://example.com [--run <run_id>] [--out data/snapshots/render-urls.jsonl]");
  const origin = originOf(values.origin as string);
  const outFile = (values.out as string | undefined) ?? "data/snapshots/render-urls.jsonl";
  const store = openStore(dbPath());
  try {
    const siteId = siteIdFor(store, origin);
    const run = values.run
      ? (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE id = ? AND site_id = ?").get(values.run, siteId) as { id: string } | undefined)
      : (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE site_id = ? ORDER BY url_count DESC, started_at DESC LIMIT 1").get(siteId) as { id: string } | undefined);
    if (!run) fail("No crawl run found for this site. Run /crawl-run first.");
    const urls = urlsNeedingRender(store, siteId, run.id);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, urls.map((url) => `${JSON.stringify({ url, source: "render" })}\n`).join(""), "utf8");
    out({ ok: true, origin, run: run.id, file: outFile, toRender: urls.length });
  } finally {
    store.close();
  }
}

// Folds a rendered crawl (the patch) into a base crawl file; the result is one new run to ingest.
function cmdCrawlMerge(args: string[]): void {
  const { values } = parse({ options: { base: { type: "string" }, patch: { type: "string" }, out: { type: "string" }, "run-id": { type: "string" } } }, args);
  if (!values.base || !values.patch || !values.out || !values["run-id"]) fail("Usage: awesome-seo crawl-merge --base <run.jsonl> --patch <rendered.jsonl> --out <merged.jsonl> --run-id <new_run_id>");
  const merged = mergeCrawl(readFileSync(values.base as string, "utf8"), readFileSync(values.patch as string, "utf8"), values["run-id"] as string);
  mkdirSync(dirname(values.out as string), { recursive: true });
  writeFileSync(values.out as string, `${merged}\n`, "utf8");
  out({ ok: true, file: values.out, runId: values["run-id"], records: merged.split("\n").length });
}

// Project configuration (awesome-seo.json): identifiers of the sources, never secrets.
function cmdConfig(args: string[]): void {
  const { values } = parse({ options: { file: { type: "string" }, init: { type: "boolean" }, origin: { type: "string" } } }, args);
  const file = (values.file as string | undefined) ?? "awesome-seo.json";
  if (values.init) {
    if (!values.origin) fail("Usage: awesome-seo config --init --origin https://example.com [--file awesome-seo.json]");
    initConfig(file, originOf(values.origin as string));
    out({ ok: true, file, created: true });
    return;
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(`No ${file} found. Create it with: awesome-seo config --init --origin https://example.com`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail(`${file} is not valid JSON.`);
  }
  out(resolveConfig(raw));
}

// Change report: two crawl runs of the site (default: the two most recent), or two sitemap snapshot files.
function cmdDiff(args: string[]): void {
  const { values } = parse({ options: { origin: { type: "string" }, from: { type: "string" }, to: { type: "string" }, "sitemap-old": { type: "string" }, "sitemap-new": { type: "string" } } }, args);
  if (!values.origin) fail("Usage: awesome-seo diff --origin https://example.com [--from <run_id> --to <run_id>] | [--sitemap-old <file.jsonl> --sitemap-new <file.jsonl>]");
  const origin = originOf(values.origin as string);
  if (values["sitemap-old"] || values["sitemap-new"]) {
    if (!values["sitemap-old"] || !values["sitemap-new"]) fail("Give both --sitemap-old and --sitemap-new.");
    const older = values["sitemap-old"] as string;
    const newer = values["sitemap-new"] as string;
    console.log(renderSitemapDiff(origin, diffSitemaps(readFileSync(older, "utf8"), readFileSync(newer, "utf8")), older, newer));
    return;
  }
  const store = openStore(dbPath());
  try {
    const siteId = siteIdFor(store, origin);
    const recent = store.sqlite.prepare("SELECT id FROM crawl_runs WHERE site_id = ? ORDER BY started_at DESC LIMIT 2").all(siteId) as { id: string }[];
    const toRunId = (values.to as string | undefined) ?? recent[0]?.id;
    const fromRunId = (values.from as string | undefined) ?? recent[1]?.id;
    if (!toRunId || !fromRunId) fail("Need two crawl runs to compare. Crawl the site again, or pass --from and --to.");
    for (const id of [fromRunId, toRunId]) {
      if (!store.sqlite.prepare("SELECT 1 FROM crawl_runs WHERE id = ? AND site_id = ?").get(id, siteId)) fail(`Crawl run not found for this site: ${id}`);
    }
    console.log(buildCrawlDiff(store, { siteId, origin, fromRunId, toRunId }));
  } finally {
    store.close();
  }
}

// Search Console pages that no crawl run fetched, written as crawl input (one {"url": ...} line each).
function cmdGscUrls(args: string[]): void {
  const { values } = parse({ options: { origin: { type: "string" }, gsc: { type: "string", multiple: true }, out: { type: "string" } } }, args);
  const files = (values.gsc as string[] | undefined) ?? [];
  if (!values.origin || files.length === 0) fail("Usage: awesome-seo gsc-urls --origin https://example.com --gsc <pages.jsonl> [--gsc <more.jsonl>] [--out data/snapshots/gsc-urls.jsonl]");
  const origin = originOf(values.origin as string);
  const outFile = (values.out as string | undefined) ?? "data/snapshots/gsc-urls.jsonl";
  const store = openStore(dbPath());
  try {
    const siteId = siteIdFor(store, origin);
    const pages = readSearchPages(files.map((file) => readFileSync(file, "utf8")));
    const toCrawl = uncrawledUrls(store, siteId, pages);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, toCrawl.map((url) => `${JSON.stringify({ url, source: "gsc" })}\n`).join(""), "utf8");
    out({ ok: true, origin, file: outFile, searchPages: pages.length, alreadyCrawled: pages.length - toCrawl.length, toCrawl: toCrawl.length });
  } finally {
    store.close();
  }
}

function cmdGeoAudit(args: string[]): void {
  const { values } = parse({ options: { origin: { type: "string" }, run: { type: "string" }, access: { type: "string" } } }, args);
  if (!values.origin) fail("Usage: awesome-seo geo-audit --origin https://example.com [--run <run_id>] [--access file.json]");
  const origin = originOf(values.origin as string);
  const store = openStore(dbPath());
  try {
    const siteId = siteIdFor(store, origin);
    const run = values.run
      ? (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE id = ? AND site_id = ?").get(values.run, siteId) as { id: string } | undefined)
      : (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE site_id = ? ORDER BY url_count DESC, started_at DESC LIMIT 1").get(siteId) as { id: string } | undefined);
    if (!run) fail("No crawl run found for this site. Run /crawl-run first.");
    if (values.access) ingestAccessReport(store, siteId, readFileSync(values.access as string, "utf8"));
    deriveCrawlObservations(store, siteId, run.id);
    console.log(buildGeoReport(store, { siteId, origin, runId: run.id }));
  } finally {
    store.close();
  }
}

// ---- approval
const TOOL_ACTIONS: Record<string, { action: ActionType; target: (i: Record<string, unknown>) => string }> = {
  "mcp__plugin_awesome-seo_google__google_gsc_submit_sitemap": { action: "gsc_submit_sitemap", target: (i) => String(i.site) },
  "mcp__plugin_awesome-seo_yandex__yandex_webmaster_add_sitemap": { action: "yandex_webmaster_add_sitemap", target: (i) => String(i.host_id) },
  "mcp__plugin_awesome-seo_bing__bing_submit_url": { action: "bing_submit_url", target: (i) => String(i.site) },
};

function checkHook(raw: string): { allow: true; proposalId: string } | { allow: false; reason: string } {
  const event = JSON.parse(raw) as { tool_name?: string; tool_input?: Record<string, unknown> };
  const mapping = event.tool_name ? TOOL_ACTIONS[event.tool_name] : undefined;
  if (!mapping) return { allow: false, reason: `write tool not known to the approval gate: ${event.tool_name ?? "(none)"}` };
  const input = event.tool_input ?? {};
  const store = openStore(dbPath());
  try {
    const r = findExecutable(store, { actionType: mapping.action, target: mapping.target(input), payload: input });
    return r.ok ? { allow: true, proposalId: r.proposalId } : { allow: false, reason: r.reason };
  } finally {
    store.close();
  }
}

function cmdApproval(args: string[]): void {
  const [sub = "", ...rest] = args;
  if (sub === "check-hook") {
    try {
      const result = checkHook(readFileSync(0, "utf8"));
      if (result.allow) {
        out({ approved: true, proposal: result.proposalId });
        process.exit(0);
      }
      console.error(`Blocked by approval gate: ${result.reason}. Create and approve a proposal with the exact payload first.`);
      process.exit(2);
    } catch (err) {
      console.error(`Blocked: approval check could not run (${(err as Error).message}).`);
      process.exit(2); // fail closed
    }
  }
  const { values, positionals } = parse(
    {
      options: {
        action: { type: "string" },
        target: { type: "string" },
        origin: { type: "string" },
        "payload-file": { type: "string" },
        description: { type: "string" },
        outcome: { type: "string" },
        "started-at": { type: "string" },
        "finished-at": { type: "string" },
        "verification-file": { type: "string" },
        "error-file": { type: "string" },
      },
    },
    rest,
  );
  const need = (name: keyof typeof values): string => {
    const v = values[name];
    if (!v) throw new Error(`missing --${String(name)}`);
    return v as string;
  };
  const store = openStore(dbPath());
  try {
    if (sub === "propose") {
      const action = need("action") as ActionType;
      if (!ACTION_TYPES.includes(action)) throw new Error(`unknown action type: ${action}`);
      const payload = JSON.parse(readFileSync(need("payload-file"), "utf8")) as Payload;
      const p = createProposal(store, {
        siteId: siteIdFor(store, originOf(need("origin"))),
        actionType: action,
        target: need("target"),
        description: need("description"),
        payload,
      });
      out({ ok: true, proposal: p.id, expiresAt: p.expiresAt, status: "pending" });
    } else if (sub === "approve") {
      const r = approveProposal(store, positionals[0] ?? "");
      out(r.ok ? { ok: true, status: "approved" } : { ok: false, reason: r.reason });
      if (!r.ok) process.exit(1);
    } else if (sub === "reject") {
      rejectProposal(store, positionals[0] ?? "");
      out({ ok: true, status: "rejected" });
    } else if (sub === "record") {
      const outcome = need("outcome");
      if (outcome !== "success" && outcome !== "failure") throw new Error("--outcome must be success or failure");
      const startedAt = need("started-at");
      const finishedAt = need("finished-at");
      if (Number.isNaN(Date.parse(startedAt)) || Number.isNaN(Date.parse(finishedAt)) || finishedAt < startedAt) {
        throw new Error("--started-at and --finished-at must be ISO times, finished not before started");
      }
      recordExecution(store, positionals[0] ?? "", {
        startedAt,
        finishedAt,
        outcome,
        verification: values["verification-file"] ? JSON.parse(readFileSync(values["verification-file"] as string, "utf8")) : undefined,
        error: values["error-file"] ? JSON.parse(readFileSync(values["error-file"] as string, "utf8")) : undefined,
      });
      out({ ok: true, status: outcome === "success" ? "executed" : "failed" });
    } else if (sub === "list") {
      out(
        store.sqlite
          .prepare("SELECT id, action_type AS action, target, status, risk_level AS risk, expires_at AS expiresAt, description FROM action_proposals ORDER BY created_at DESC LIMIT 50")
          .all(),
      );
    } else {
      throw new Error("usage: awesome-seo approval propose|approve|reject|record|list|check-hook");
    }
  } finally {
    store.close();
  }
}

// ---- dispatch
const [command = "", ...rest] = process.argv.slice(2);
try {
  switch (command) {
    case "migrate": cmdMigrate(); break;
    case "seed": cmdSeed(rest); break;
    case "sitemap-ingest": cmdIngest("sitemap", rest); break;
    case "crawl-ingest": cmdIngest("crawl", rest); break;
    case "seo-audit": cmdSeoAudit(rest); break;
    case "geo-audit": cmdGeoAudit(rest); break;
    case "technical-audit": cmdTechnicalAudit(rest); break;
    case "gsc-urls": cmdGscUrls(rest); break;
    case "diff": cmdDiff(rest); break;
    case "config": cmdConfig(rest); break;
    case "audit": cmdAudit(rest); break;
    case "render-urls": cmdRenderUrls(rest); break;
    case "crawl-merge": cmdCrawlMerge(rest); break;
    case "approval": cmdApproval(rest); break;
    default:
      fail("usage: awesome-seo <migrate|seed|sitemap-ingest|crawl-ingest|gsc-urls|render-urls|crawl-merge|diff|config|audit|seo-audit|geo-audit|technical-audit|approval> [options]");
  }
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}
