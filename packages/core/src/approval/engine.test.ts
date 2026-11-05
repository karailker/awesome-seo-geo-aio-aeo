import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, upsertSite, type Store } from "../db/store.js";
import { approveProposal, canonicalJson, createProposal, findExecutable, payloadHash, recordExecution, rejectProposal } from "./engine.js";

const T0 = new Date("2026-11-05T10:00:00Z");
const payload = { site: "sc-domain:bulmacalig.com", feedpath: "https://www.bulmacalig.com/sitemap.xml" };
let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-approval-"));
  store = openStore(join(dir, "a.sqlite"));
  upsertSite(store, { id: "s1", name: "Example", canonicalOrigin: "https://www.bulmacalig.com", sitemapUrl: null, urlCap: 500, createdAt: T0.toISOString() });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const propose = (p: Record<string, unknown> = payload, now = T0) =>
  createProposal(store, { siteId: "s1", actionType: "gsc_submit_sitemap", target: payload.site as string, description: "submit sitemap", payload: p, now });

describe("payload hashing", () => {
  it("ignores key order, so the same payload always gives the same hash", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
  });
});

describe("approval gate", () => {
  it("blocks a write tool when no proposal exists", () => {
    const r = findExecutable(store, { actionType: "gsc_submit_sitemap", target: payload.site, payload, now: T0 });
    expect(r.ok).toBe(false);
  });

  it("blocks a write tool while the proposal is still pending", () => {
    propose();
    const r = findExecutable(store, { actionType: "gsc_submit_sitemap", target: payload.site, payload, now: T0 });
    expect(r).toMatchObject({ ok: false });
  });

  it("allows execution after approval, for the exact payload and target", () => {
    const { id } = propose();
    expect(approveProposal(store, id, T0)).toEqual({ ok: true });

    const r = findExecutable(store, { actionType: "gsc_submit_sitemap", target: payload.site, payload, now: T0 });
    expect(r).toEqual({ ok: true, proposalId: id });
  });

  it("blocks execution when the payload changed after approval", () => {
    const { id } = propose();
    approveProposal(store, id, T0);

    const changed = { ...payload, feedpath: "https://www.bulmacalig.com/other.xml" };
    expect(findExecutable(store, { actionType: "gsc_submit_sitemap", target: payload.site, payload: changed, now: T0 })).toMatchObject({ ok: false });
  });

  it("blocks execution against a different target", () => {
    const { id } = propose();
    approveProposal(store, id, T0);

    expect(findExecutable(store, { actionType: "gsc_submit_sitemap", target: "sc-domain:other.com", payload, now: T0 })).toMatchObject({ ok: false });
  });

  it("blocks an expired proposal, even when approved", () => {
    const { id } = propose(payload, T0);
    approveProposal(store, id, T0);
    const later = new Date(T0.getTime() + 25 * 3600_000);

    const r = findExecutable(store, { actionType: "gsc_submit_sitemap", target: payload.site, payload, now: later });

    expect(r).toEqual({ ok: false, reason: "approved proposal has expired" });
    expect(approveProposal(store, id, later)).toMatchObject({ ok: false });
  });

  it("does not approve a rejected proposal", () => {
    const { id } = propose();
    rejectProposal(store, id);

    expect(approveProposal(store, id, T0)).toMatchObject({ ok: false });
    expect(findExecutable(store, { actionType: "gsc_submit_sitemap", target: payload.site, payload, now: T0 })).toMatchObject({ ok: false });
  });
});

describe("execution record", () => {
  it("logs the outcome and verification, and marks the proposal executed so it cannot run again", () => {
    const { id } = propose();
    approveProposal(store, id, T0);

    recordExecution(store, id, {
      startedAt: T0.toISOString(),
      finishedAt: T0.toISOString(),
      outcome: "success",
      verification: { listed: true },
    });

    const log = store.sqlite.prepare("SELECT outcome, verification_json FROM execution_logs WHERE proposal_id = ?").get(id) as { outcome: string; verification_json: string };
    expect(log).toEqual({ outcome: "success", verification_json: '{"listed":true}' });
    const status = (store.sqlite.prepare("SELECT status FROM action_proposals WHERE id = ?").get(id) as { status: string }).status;
    expect(status).toBe("executed");
    expect(findExecutable(store, { actionType: "gsc_submit_sitemap", target: payload.site, payload, now: T0 })).toMatchObject({ ok: false });
  });
});
