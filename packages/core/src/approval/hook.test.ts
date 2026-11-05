// Runs the real PreToolUse hook script against a temp database. Requires a built core (pnpm -r build).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { approveProposal, createProposal } from "./engine.js";

const HOOK = resolve(__dirname, "../../../../hooks/scripts/validate-approval.sh");
const ROOT = resolve(__dirname, "../../../..");
const SITE = "sc-domain:bulmacalig.com";
const PAYLOAD = { site: SITE, feedpath: "https://www.bulmacalig.com/sitemap.xml" };
const event = (input: Record<string, unknown>) =>
  JSON.stringify({ tool_name: "mcp__plugin_awesome-seo_google__google_gsc_submit_sitemap", tool_input: input });

let dir: string;
let dbPath: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-hook-"));
  dbPath = join(dir, "hook.sqlite");
  store = openStore(dbPath);
  upsertSite(store, { id: "s1", name: "Example", canonicalOrigin: "https://www.bulmacalig.com", sitemapUrl: null, urlCap: 500, createdAt: "2026-11-05T09:00:00.000Z" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function runHook(input: string) {
  return spawnSync("bash", [HOOK], { input, env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, AWESOME_SEO_DB: dbPath }, encoding: "utf8" });
}

describe("PreToolUse approval gate", () => {
  it("blocks a write tool with no proposal", () => {
    const r = runHook(event(PAYLOAD));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Blocked by approval gate");
  });

  it("blocks while the proposal is pending", () => {
    createProposal(store, { siteId: "s1", actionType: "gsc_submit_sitemap", target: SITE, description: "submit", payload: PAYLOAD });
    expect(runHook(event(PAYLOAD)).status).toBe(2);
  });

  it("allows the call once the exact payload is approved", () => {
    const { id } = createProposal(store, { siteId: "s1", actionType: "gsc_submit_sitemap", target: SITE, description: "submit", payload: PAYLOAD });
    approveProposal(store, id);
    const r = runHook(event(PAYLOAD));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(id);
  });

  it("blocks when the payload changed after approval", () => {
    const { id } = createProposal(store, { siteId: "s1", actionType: "gsc_submit_sitemap", target: SITE, description: "submit", payload: PAYLOAD });
    approveProposal(store, id);
    expect(runHook(event({ ...PAYLOAD, feedpath: "https://www.bulmacalig.com/other.xml" })).status).toBe(2);
  });

  it("blocks an approved proposal that has expired", () => {
    const past = new Date(Date.now() - 25 * 3600_000);
    const { id } = createProposal(store, { siteId: "s1", actionType: "gsc_submit_sitemap", target: SITE, description: "submit", payload: PAYLOAD, now: past });
    approveProposal(store, id, past);
    const r = runHook(event(PAYLOAD));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("expired");
  });

  it("blocks an unknown write tool and malformed input (fail closed)", () => {
    expect(runHook(JSON.stringify({ tool_name: "mcp__x__unknown", tool_input: {} })).status).toBe(2);
    expect(runHook("not json").status).toBe(2);
  });
});
