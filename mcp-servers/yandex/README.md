# @karailker/awesome-seo-mcp-yandex

MCP server for Yandex Metrica and Yandex Webmaster. Part of the awesome-seo Claude Code plugin (version 0.1.0, MIT).

## Run

```bash
npx -y @karailker/awesome-seo-mcp-yandex
```

If a fresh install says "No matching version found", retry with `npx -y --prefer-online @karailker/awesome-seo-mcp-yandex@0.1.0`.

## Tools

- `yandex_metrica_report`
- `yandex_webmaster_hosts`
- `yandex_webmaster_host_summary`
- `yandex_webmaster_search_queries`
- `yandex_webmaster_indexing`
- `yandex_webmaster_in_search_urls`
- `yandex_webmaster_add_sitemap (write, approval gate)`

## Credentials

Read from environment variables, never from this package: YANDEX_METRICA_TOKEN, YANDEX_WEBMASTER_TOKEN, YANDEX_METRICA_COUNTER_ID. Keep key files and token files outside the repository, with mode 600.

## More

Repository, setup, and the approval gate for write tools: https://github.com/karailker/awesome-seo-geo-aio-aeo
