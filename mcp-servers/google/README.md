# @karailker/awesome-seo-mcp-google

MCP server for Google Search Console, GA4 (Merchant Center code present, deferred). Part of the awesome-seo Claude Code plugin (version 0.1.0, MIT).

## Run

```bash
npx -y @karailker/awesome-seo-mcp-google
```

If a fresh install says "No matching version found", retry with `npx -y --prefer-online @karailker/awesome-seo-mcp-google@0.1.0`.

## Tools

- `google_gsc_list_properties`
- `google_gsc_search_analytics`
- `google_gsc_inspect_url`
- `google_gsc_list_sitemaps`
- `google_gsc_submit_sitemap (write, approval gate)`
- `google_ga4_get_metadata`
- `google_ga4_run_report`
- `google_merchant_list_products (deferred)`
- `google_merchant_list_product_issues (deferred)`

## Credentials

Read from environment variables, never from this package: GOOGLE_SERVICE_ACCOUNT_KEY_FILE. Keep key files and token files outside the repository, with mode 600.

## More

Repository, setup, and the approval gate for write tools: https://github.com/karailker/awesome-seo-geo-aio-aeo
