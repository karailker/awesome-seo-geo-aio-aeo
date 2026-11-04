# STATUS

Date: 2026-11-04. Development stopped by user request during P0 wrap-up.

## Done (P0 - committed, 3 commits)

| Commit | Contents |
|---|---|
| `c3d92bd` docs | `CLAUDE.md` + all of `docs/` (first commit in repo) |
| `489679a` feat | Root workspace (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`), `.claude-plugin/plugin.json`, `.mcp.json` (5 servers), `.claude/settings.json` (`MCP_TIMEOUT=30000`), `.gitignore`, `.env.example`, `README.md`, `packages/core` (one module + 2 passing tests) |
| `ddbbb52` feat | Stub MCP servers: `google`, `yandex`, `bing`, `performance` (TS, official SDK, shared `startStubServer` in core), `crawl` (Python FastMCP, uv, `mcp<2` pinned - 2.x renamed FastMCP). Each exposes only `<prefix>_health` + `<prefix>_capabilities` |

## Verified (P0 done criteria)

- `pnpm install` / `pnpm -r build` / `pnpm -r test`: green (2 core tests pass) - but see Pending #1, install is broken again now
- `uv sync` + `uv run pytest`: 2 passed
- Direct stdio check: all 5 servers list exactly the 2 stub tools, `*_health` returns `ok:true`
- Plugin load (`claude --plugin-dir .`, Claude Code 2.1.308): headless session called all 5 health tools through the plugin, all OK
- `claude plugin validate .`: manifest valid; warns CLAUDE.md-not-loaded (harmless); errors LICENSE_MISSING (only matters for marketplace submission - needs a license decision)
- TS server startup measures ~8s on `/mnt/d` (drvfs) - caused intermittent google connect failures; fixed via `.claude/settings.json` `MCP_TIMEOUT=30000`
- ROADMAP status line set to P1; CLAUDE.md Commands section filled with real commands

## Pending / blocked

1. **`pnpm install` currently fails** (`ERR_PNPM_IGNORED_BUILDS: esbuild`). Cause: `onlyBuiltDependencies: [esbuild]` block was removed from `pnpm-workspace.yaml` on disk after it was added. Not re-added (external change). Fix = restore those 2 lines or run `pnpm approve-builds` once.
2. **Doc contradiction (blocks P3, not P0)**: `docs/MCP.md` mandates `google_` prefix for all Google tools (`google_gsc_list_properties`, explicit "use consistently" note); `docs/ROADMAP.md` P3/P10 uses `gsc_list_properties`, `gsc_submit_sitemap`. Pick one. Recommendation: MCP.md.
3. **LICENSE decision**: plugin.json has no `license`; marketplace validation rejects without it.
4. **Untracked `.serena/`** in repo root (external tool config) - intentionally not committed; decide: gitignore or commit.
5. No `git remote`; nothing pushed.
6. `pnpm approve-builds` message still printed on install (cosmetic if #1 resolved).

## Not started

- Everything from P1 onward (SQLite/Drizzle store, migrations, Zod schemas, ...). P1 not begun per instruction.

## Toolchain (recorded)

pnpm 12.16.1 (via corepack - pnpm was not installed), uv 0.11.8, Node 24.12.0, Python 3.12.7, Claude Code 2.1.308.
