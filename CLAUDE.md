# CLAUDE.md

## Project

Awesome SEO / GEO / AIO / AEO: a local Claude Code plugin with MCP servers, agents, skills, and commands.
Scope for v1: one site, sitemap-driven URL discovery, local-first, SQLite storage, human-approved writes.

Before changing code, read:
- docs/ARCHITECTURE.md
- docs/ROADMAP.md (find the current phase and its done criteria)
- docs/MCP.md, docs/DATA-MODEL.md, docs/AGENTS-AND-SKILLS.md, docs/SECURITY-AND-APPROVAL.md

## Language

- Repo content (code, comments, docs, commit messages, report templates, skill outputs): English.
- Replies to the user: use the language the user writes in. The user currently writes in Turkish, so reply in Turkish, keeping English technical terms inline.

## Stack

- TypeScript (pnpm workspace, Node 20+): `packages/core`, `mcp-servers/google`, `mcp-servers/yandex`, `mcp-servers/bing`, `mcp-servers/performance`, `scripts/`.
- Python 3.12+ (uv): `mcp-servers/crawl` (FastMCP, httpx, selectolax, extruct).
- Database: SQLite via better-sqlite3, accessed through Drizzle ORM. Validation with Zod.
- Tests: Vitest for TypeScript, pytest for Python.
- Hooks: Bash in `hooks/scripts/`.

Do not add a new top-level dependency or change the architecture without asking first. Small utility packages inside an existing package are fine; note them in your summary.

## Hard rules

1. Only `packages/core` writes to SQLite. MCP servers and the Python crawler never open the database for writing. The crawler writes JSONL snapshots; `core` ingests them.
2. MCP servers never call each other. Shared logic lives in `packages/core`.
3. Every write-capable tool (submit, update, modify) requires an approved `action_proposal` with a matching payload hash. Agents never call write tools directly.
4. Never store secrets (tokens, API keys, service account JSON) in the repo, SQLite, logs, fixtures, or chat output. Store only credential references in SQLite. Use `.env.example` for variable names only.
5. Lab metrics and field metrics are separate fields with separate names (`lab_*` and `field_*`). Never merge them.
6. Every finding must reference at least one observation through `evidence`. No evidence, no finding.
7. Missing or stale data must be reported as missing or stale. Do not write confident conclusions on top of missing data.
8. Unit and integration tests must not hit the network. Use recorded fixtures in `tests/fixtures/`.
9. The crawler must respect robots.txt, enforce a per-host rate limit, send an identifiable User-Agent, and respect a configurable URL cap (default 500).
10. Never present scores as official Google, Bing, Yandex, or AI platform ranking factors. Project scores are defined in `docs/` and labeled as project-defined.
11. Mark any API quota, endpoint version, or limit you rely on with `VERIFY:` in code comments and in `docs/ROADMAP.md` until it has been checked against current official documentation.

## Commands

Confirmed in Phase 0 (pnpm 12 via corepack, uv 0.11, Node 24, Claude Code 2.1.308):

- Install: `pnpm install` and `cd mcp-servers/crawl && uv sync`
- Build: `pnpm -r build`
- Test (TS): `pnpm -r test`
- Test (Python): `cd mcp-servers/crawl && uv run pytest`
- Typecheck: `pnpm -r typecheck`
- Plugin manifest check: `claude plugin validate .` (run from the repo root)
- Plugin load check: `claude --plugin-dir .` - works in Claude Code 2.1.308; plugin MCP tool names are `mcp__plugin_awesome-seo_<server>__<tool>`.
- On slow filesystems (e.g. WSL `/mnt/d`), server startup can exceed the default MCP startup timeout; `.claude/settings.json` sets `MCP_TIMEOUT=30000`.

## Working style

- For each task: state a short plan, implement, run the relevant tests, then summarize what changed and what is still open.
- Update the status line in `docs/ROADMAP.md` when a phase's done criteria are met.
- Commit using Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Ask before deleting files or rewriting working code that is outside the current phase.