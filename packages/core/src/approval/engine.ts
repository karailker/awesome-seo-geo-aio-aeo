// Approval engine (docs/SECURITY-AND-APPROVAL.md). Rules: approval is per proposal, per target, per payload;
// a changed payload needs a new proposal; expired proposals cannot run; every run is logged.
// Core is the only writer to SQLite. Write tools in the MCP servers run only after this check passes.
import { createHash, randomUUID } from "node:crypto";
import { actionProposals, approvals, executionLogs } from "../db/schema.js";
import type { Store } from "../db/store.js";

export const ACTION_RISK = {
  gsc_submit_sitemap: "low",
  yandex_webmaster_add_sitemap: "low",
  bing_submit_url: "low",
} as const;
export type ActionType = keyof typeof ACTION_RISK;
export const ACTION_TYPES = Object.keys(ACTION_RISK) as ActionType[];

export type Payload = Record<string, unknown>;

// Canonical JSON: keys sorted at every level, so the same payload always gives the same hash.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function payloadHash(payload: Payload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

const DEFAULT_TTL_HOURS = 24;

export function createProposal(
  store: Store,
  input: { siteId: string; actionType: ActionType; target: string; description: string; payload: Payload; expectedImpact?: string; now?: Date; ttlHours?: number },
): { id: string; expiresAt: string } {
  const now = input.now ?? new Date();
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + (input.ttlHours ?? DEFAULT_TTL_HOURS) * 3600_000).toISOString();
  store.db
    .insert(actionProposals)
    .values({
      id,
      siteId: input.siteId,
      actionType: input.actionType,
      target: input.target,
      description: input.description,
      proposedPayloadJson: canonicalJson(input.payload),
      payloadHash: payloadHash(input.payload),
      expectedImpact: input.expectedImpact ?? null,
      riskLevel: ACTION_RISK[input.actionType],
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt,
    })
    .run();
  return { id, expiresAt };
}

export type ApproveResult = { ok: true } | { ok: false; reason: string };

export function approveProposal(store: Store, proposalId: string, now: Date = new Date(), approvedBy = "user"): ApproveResult {
  const row = store.sqlite.prepare("SELECT status, expires_at AS expiresAt, payload_hash AS hash FROM action_proposals WHERE id = ?").get(proposalId) as
    | { status: string; expiresAt: string; hash: string }
    | undefined;
  if (!row) return { ok: false, reason: "proposal not found" };
  if (row.status !== "pending") return { ok: false, reason: `proposal is ${row.status}, not pending` };
  if (row.expiresAt <= now.toISOString()) {
    store.sqlite.prepare("UPDATE action_proposals SET status = 'expired' WHERE id = ?").run(proposalId);
    return { ok: false, reason: "proposal has expired" };
  }
  store.db.insert(approvals).values({ id: randomUUID(), proposalId, payloadHash: row.hash, approvedAt: now.toISOString(), approvedBy }).run();
  store.sqlite.prepare("UPDATE action_proposals SET status = 'approved' WHERE id = ?").run(proposalId);
  return { ok: true };
}

export function rejectProposal(store: Store, proposalId: string): void {
  store.sqlite.prepare("UPDATE action_proposals SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(proposalId);
}

export type ExecutableResult = { ok: true; proposalId: string } | { ok: false; reason: string };

// The hook's question: is there an approved, unexpired proposal for this action, target, and exact payload?
export function findExecutable(
  store: Store,
  input: { actionType: string; target: string; payload: Payload; now?: Date },
): ExecutableResult {
  const now = input.now ?? new Date();
  const hash = payloadHash(input.payload);
  const rows = store.sqlite
    .prepare(
      `SELECT p.id, p.status, p.expires_at AS expiresAt,
              (SELECT COUNT(*) FROM approvals a WHERE a.proposal_id = p.id AND a.payload_hash = p.payload_hash) AS approvedSame
       FROM action_proposals p
       WHERE p.action_type = ? AND p.target = ? AND p.payload_hash = ?
       ORDER BY p.created_at DESC`,
    )
    .all(input.actionType, input.target, hash) as { id: string; status: string; expiresAt: string; approvedSame: number }[];
  if (rows.length === 0) return { ok: false, reason: "no proposal with this exact payload" };
  const match = rows.find((r) => r.status === "approved" && r.approvedSame > 0);
  if (!match) {
    const latest = rows[0]!;
    if (latest.status === "approved" && latest.expiresAt <= now.toISOString()) return { ok: false, reason: "approved proposal has expired" };
    return { ok: false, reason: `proposal is ${latest.status}; approval is required for this exact payload` };
  }
  if (match.expiresAt <= now.toISOString()) {
    store.sqlite.prepare("UPDATE action_proposals SET status = 'expired' WHERE id = ?").run(match.id);
    return { ok: false, reason: "approved proposal has expired" };
  }
  return { ok: true, proposalId: match.id };
}

export function recordExecution(
  store: Store,
  proposalId: string,
  input: { startedAt: string; finishedAt: string; outcome: "success" | "failure"; verification?: unknown; error?: unknown },
): void {
  store.db
    .insert(executionLogs)
    .values({
      id: randomUUID(),
      proposalId,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      outcome: input.outcome,
      verificationJson: input.verification === undefined ? null : JSON.stringify(input.verification),
      errorJson: input.error === undefined ? null : JSON.stringify(input.error),
    })
    .run();
  store.sqlite.prepare("UPDATE action_proposals SET status = ? WHERE id = ?").run(input.outcome === "success" ? "executed" : "failed", proposalId);
}
