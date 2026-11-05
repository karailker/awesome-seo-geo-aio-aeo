# STATUS

Date: 2026-11-05. Phase: P1 complete, P2 next.

## Done

| Phase | Commit | Contents |
|---|---|---|
| P0 | `c3d92bd`, `489679a`, `ddbbb52` | Docs, workspace, plugin manifests, stub MCP servers (`*_health`, `*_capabilities`) |
| P0 fixes | uncommitted | pnpm 12 build approval moved to `allowBuilds` in `pnpm-workspace.yaml`; dead duplicate `pnpm` block removed from `package.json` |
| P1 | uncommitted | `packages/core`: Drizzle schema for `sites`, `site_properties`, `connections`, `pages`, `observations`, `api_cache`; generated migration `migrations/0000_*.sql`; store with WAL, foreign keys, busy_timeout, migration runner recording `schema_migrations`; `withTransaction`; `upsertSite`, `upsertPage`, `insertObservation`; Zod `Site`, `Page`, `Observation`; `normalizeUrl`. Scripts `scripts/migrate.ts` and `scripts/seed.ts` (`pnpm db:migrate`, `pnpm db:seed`) |

## Verified (2026-11-05)

- `pnpm install`, `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test` (core: 9 tests pass)
- `cd mcp-servers/crawl && uv run pytest` (2 pass)
- `pnpm db:migrate` twice: second run applies nothing; `pnpm db:seed` twice: one site row, `created: false` on the second run

Environment fix: `node_modules/` and `mcp-servers/crawl/.venv/` were created on the Windows side. The symlinks and interpreter were broken under WSL `/mnt/d` (ntfs3). Both were deleted and reinstalled on Linux. Re-run `pnpm install` and `uv sync` on any machine where they break.

## Pending / needs a decision

Resolved 2026-11-05:
- Tool prefixes: `docs/MCP.md` is canonical. Google tools use `google_*`; performance tools use `performance_*`. ROADMAP, SECURITY-AND-APPROVAL, DATA-MODEL aligned.
- License: MIT (`LICENSE`, `plugin.json` `license` field). Author name taken from git config; change if needed.
- `.serena/` added to `.gitignore`.
- Remote `origin` is `github.com/karailker/awesome-seo-geo-aio-aeo`.

## Known gaps in P1

- "Observation normalization helpers" is thin: only JSON serialization of `dimensions` and `provenance`. Add more when P3 defines the real sources.
- `scripts/*.ts` run through Node type stripping and are not typechecked.
- The migration generator is `drizzle-kit`, which is dev-only. Migrations are applied by our own runner, not by Drizzle's migrator.

## Not started

- P2 onward: sitemap discovery, ingest into `pages`, `/sitemap-sync`.

## Toolchain

pnpm 12.16.1 (via corepack), uv 0.11.8, Node 24.22.0, Python 3.12, Claude Code 2.1.308. SQLite 3.53.4 (via better-sqlite3 13.0.3).
