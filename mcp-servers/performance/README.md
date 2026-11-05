# @karailker/awesome-seo-mcp-performance

MCP server for PageSpeed Insights, CrUX, and local Lighthouse (lab and field kept separate). Part of the awesome-seo Claude Code plugin (version 0.1.0, MIT).

## Run

```bash
npx -y @karailker/awesome-seo-mcp-performance
```

If a fresh install says "No matching version found", retry with `npx -y --prefer-online @karailker/awesome-seo-mcp-performance@0.1.0`.

## Tools

- `performance_psi_run (falls back to local Lighthouse)`
- `performance_crux_query`
- `performance_lighthouse_local_run`

## Credentials

Read from environment variables, never from this package: PAGESPEED_API_KEY, CRUX_API_KEY (optional CHROME_PATH for local Lighthouse). Keep key files and token files outside the repository, with mode 600.

## More

Repository, setup, and the approval gate for write tools: https://github.com/karailker/awesome-seo-geo-aio-aeo
