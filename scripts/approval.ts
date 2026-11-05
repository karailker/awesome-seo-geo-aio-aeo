// Approval CLI and the pre-tool-use check for write tools (docs/SECURITY-AND-APPROVAL.md).
// Commands:
//   propose --action <type> --target <t> --origin <site origin> --payload-file <json> --description <text>
//   approve <proposal-id> | reject <proposal-id> | list
//   record <proposal-id> --outcome success|failure --started-at <ISO> --finished-at <ISO> [--verification-file f] [--error-file f]
//   check-hook   (reads a PreToolUse event on stdin; exit 0 allows, exit 2 blocks, any error blocks)
// Requires a built core (pnpm -r build). Path override: AWESOME_SEO_DB.
import { readFileSync } from "node:fs";
import { normalizeUrl, openStore, approveProposal, createProposal, findExecutable, recordExecution, rejectProposal, ACTION_TYPES, type ActionType } from "../packages/core/dist/index.js";

const dbPath = process.env.AWESOME_SEO_DB ?? "data/awesome-seo.sqlite";

// Write tool name -> action type, and how to read the target from its input (fail closed when unknown).
const TOOL_ACTIONS: Record<string, { action: ActionType; target: (input: Record<string, unknown>) => string }> = {
  "mcp__plugin_awesome-seo_google__google_gsc_submit_sitemap": { action: "gsc_submit_sitemap", target: (i) => String(i.site) },
  "mcp__plugin_awesome-seo_yandex__yandex_webmaster_add_sitemap": { action: "yandex_webmaster_add_sitemap", target: (i) => String(i.host_id) },
  "mcp__plugin_awesome-seo_bing__bing_submit_url": { action: "bing_submit_url", target: (i) => String(i.site) },
};

function args(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    } else positional.push(a);
  }
  return { positional, flags };
}

function need(flags: Record<string, string>, name: string): string {
  const v = flags[name];
  if (!v) throw new Error(`missing --${name}`);
  return v;
}

function siteIdFor(store: ReturnType<typeof openStore>, origin: string): string {
  const row = store.sqlite.prepare("SELECT id FROM sites WHERE canonical_origin = ?").get(new URL(normalizeUrl(origin)).origin) as { id: string } | undefined;
  if (!row) throw new Error("site is not seeded (run pnpm db:seed)");
  return row.id;
}

function checkHook(raw: string): { allow: true; proposalId: string } | { allow: false; reason: string } {
  const event = JSON.parse(raw) as { tool_name?: string; tool_input?: Record<string, unknown> };
  const mapping = event.tool_name ? TOOL_ACTIONS[event.tool_name] : undefined;
  if (!mapping) return { allow: false, reason: `write tool not known to the approval gate: ${event.tool_name ?? "(none)"}` };
  const input = event.tool_input ?? {};
  const store = openStore(dbPath);
  try {
    const r = findExecutable(store, { actionType: mapping.action, target: mapping.target(input), payload: input });
    return r.ok ? { allow: true, proposalId: r.proposalId } : { allow: false, reason: r.reason };
  } finally {
    store.close();
  }
}

function main(): void {
  const [cmd = "", ...rest] = process.argv.slice(2);
  const { positional, flags } = args(rest);

  if (cmd === "check-hook") {
    try {
      const result = checkHook(readFileSync(0, "utf8"));
      if (result.allow) {
        console.log(JSON.stringify({ approved: true, proposal: result.proposalId }));
        process.exit(0);
      }
      console.error(`Blocked by approval gate: ${result.reason}. Create and approve a proposal with the exact payload first.`);
      process.exit(2);
    } catch (err) {
      console.error(`Blocked: approval check could not run (${(err as Error).message}).`);
      process.exit(2); // fail closed
    }
  }

  const store = openStore(dbPath);
  try {
    if (cmd === "propose") {
      const action = need(flags, "action") as ActionType;
      if (!ACTION_TYPES.includes(action)) throw new Error(`unknown action type: ${action}`);
      const payload = JSON.parse(readFileSync(need(flags, "payload-file"), "utf8")) as Record<string, unknown>;
      const p = createProposal(store, {
        siteId: siteIdFor(store, need(flags, "origin")),
        actionType: action,
        target: need(flags, "target"),
        description: need(flags, "description"),
        payload,
      });
      console.log(JSON.stringify({ ok: true, proposal: p.id, expiresAt: p.expiresAt, status: "pending" }));
    } else if (cmd === "approve") {
      const r = approveProposal(store, positional[0] ?? "");
      console.log(JSON.stringify(r.ok ? { ok: true, status: "approved" } : { ok: false, reason: r.reason }));
      if (!r.ok) process.exit(1);
    } else if (cmd === "reject") {
      rejectProposal(store, positional[0] ?? "");
      console.log(JSON.stringify({ ok: true, status: "rejected" }));
    } else if (cmd === "record") {
      const outcome = need(flags, "outcome");
      if (outcome !== "success" && outcome !== "failure") throw new Error("--outcome must be success or failure");
      // Times are the write call's own start and finish, from the tool result. Never the record time.
      const startedAt = need(flags, "started-at");
      const finishedAt = need(flags, "finished-at");
      if (Number.isNaN(Date.parse(startedAt)) || Number.isNaN(Date.parse(finishedAt)) || finishedAt < startedAt) {
        throw new Error("--started-at and --finished-at must be ISO times, finished not before started");
      }
      recordExecution(store, positional[0] ?? "", {
        startedAt,
        finishedAt,
        outcome,
        verification: flags["verification-file"] ? JSON.parse(readFileSync(flags["verification-file"], "utf8")) : undefined,
        error: flags["error-file"] ? JSON.parse(readFileSync(flags["error-file"], "utf8")) : undefined,
      });
      console.log(JSON.stringify({ ok: true, status: outcome === "success" ? "executed" : "failed" }));
    } else if (cmd === "list") {
      const rows = store.sqlite
        .prepare("SELECT id, action_type AS action, target, status, risk_level AS risk, expires_at AS expiresAt, description FROM action_proposals ORDER BY created_at DESC LIMIT 50")
        .all();
      console.log(JSON.stringify(rows, null, 2));
    } else {
      throw new Error("usage: approval.ts propose|approve|reject|record|list|check-hook");
    }
  } finally {
    store.close();
  }
}

try {
  main();
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}
