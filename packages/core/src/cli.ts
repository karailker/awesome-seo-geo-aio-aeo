#!/usr/bin/env node
// `awesome-seo` CLI: database, ingest, reports, and the approval gate. Used by the plugin's commands and hook
// (via npx) and by the repo's pnpm scripts. The database path defaults to ./data/awesome-seo.sqlite
// (override with AWESOME_SEO_DB), so run it from the project directory.
import { readFileSync } from "node:fs";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  ACTION_TYPES,
  approveProposal,
  buildGeoReport,
  buildSeoAuditReport,
  createProposal,
  deriveCrawlObservations,
  findExecutable,
  ingestAccessReport,
  ingestBingJsonl,
  ingestCrawlJsonl,
  ingestGa4Jsonl,
  ingestGscJsonl,
  ingestMetricaJsonl,
  ingestSitemapJsonl,
  ingestYandexWebmasterJsonl,
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

// Input: the JSON result of crawl_check_access, saved to a file.
function cmdAccessIngest(args: string[]): void {
  const { values, positionals } = parse({ options: { origin: { type: "string" } } }, args);
  const file = positionals[0];
  if (!values.origin || !file) fail("Usage: awesome-seo access-ingest --origin https://example.com <access.json>");
  const origin = originOf(values.origin as string);
  const store = openStore(dbPath());
  try {
    const site = siteIdFor(store, origin);
    const text = readFileSync(file, "utf8");
    out({ ok: true, db: dbPath(), origin, file, ...ingestAccessReport(store, site, text) });
  } finally {
    store.close();
  }
}

// ---- reports
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
    const feed: [string[] | undefined, (s: string, text: string) => unknown][] = [
      [values.gsc as string[] | undefined, (s, t) => ingestGscJsonl(store, s, t)],
      [values.ga4 as string[] | undefined, (s, t) => ingestGa4Jsonl(store, s, origin, t)],
      [values.metrica as string[] | undefined, (s, t) => ingestMetricaJsonl(store, s, t)],
      [values.bing as string[] | undefined, (s, t) => ingestBingJsonl(store, s, t)],
      [values.yandex as string[] | undefined, (s, t) => ingestYandexWebmasterJsonl(store, s, t)],
    ];
    for (const [files, ingest] of feed) for (const f of files ?? []) ingest(siteId, readFileSync(f, "utf8"));
    console.log(buildSeoAuditReport(store, { siteId, origin, periodStart: values.start as string, periodEnd: values.end as string }));
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
      : (store.sqlite.prepare("SELECT id FROM crawl_runs WHERE site_id = ? ORDER BY started_at DESC LIMIT 1").get(siteId) as { id: string } | undefined);
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
    case "access-ingest": cmdAccessIngest(rest); break;
    case "seo-audit": cmdSeoAudit(rest); break;
    case "geo-audit": cmdGeoAudit(rest); break;
    case "approval": cmdApproval(rest); break;
    default:
      fail("usage: awesome-seo <migrate|seed|sitemap-ingest|crawl-ingest|access-ingest|seo-audit|geo-audit|approval> [options]");
  }
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}
