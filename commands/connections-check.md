---
description: Check every awesome-seo connection: which servers run and which credentials they can see. Read-only. Shows the variable name and where to set it when one is missing. Never prints values.
argument-hint: ""
---

Check the connections for this project. Read-only. Do not call any write tool. Rules and setup: `docs/CREDENTIALS.md`.

1. Call each server's health tool: `mcp__plugin_awesome-seo_google__google_health`, `mcp__plugin_awesome-seo_bing__bing_health`, `mcp__plugin_awesome-seo_yandex__yandex_health`, `mcp__plugin_awesome-seo_performance__performance_health`, `mcp__plugin_awesome-seo_crawl__crawl_health`. Health output never contains secret values; report only the true and false flags.
2. Make one table: server, status (running or not), each credential with true or false.
3. For each false credential, give the variable name and the fix from `docs/CREDENTIALS.md` (set it in the shell that starts Claude Code, or start Claude Code with the project launcher). Do not give values.
4. If a server is not running, say so and suggest `/reload-plugins` or restarting Claude Code. Do not claim it is unconfigured.
5. If a server reports a credential as true but its tool later returns AUTH_MISSING or PERMISSION_DENIED, say the key is set but not accepted, and point to the setup section for that service.
