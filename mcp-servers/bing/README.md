# @karailker/awesome-seo-mcp-bing

MCP server for Bing Webmaster. Part of the awesome-seo Claude Code plugin (version 0.1.0, MIT).

## Run

```bash
npx -y @karailker/awesome-seo-mcp-bing
```

If a fresh install says "No matching version found", retry with `npx -y --prefer-online @karailker/awesome-seo-mcp-bing@0.1.0`.

## Tools

- `bing_search_stats`
- `bing_page_stats`
- `bing_url_info`
- `bing_submit_url (write, approval gate)`

## Credentials

Read from environment variables, never from this package: BING_WEBMASTER_API_KEY. Keep key files and token files outside the repository, with mode 600.

## More

Repository, setup, and the approval gate for write tools: https://github.com/karailker/awesome-seo-geo-aio-aeo
