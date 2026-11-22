---
description: Merchant Center feed health for the connected account: product issues grouped by type, with affected products and URLs. Read-only.
argument-hint: "[account-id] (default: GOOGLE_MERCHANT_ACCOUNT_ID)"
---

Run the ecommerce feed audit for `$ARGUMENTS`. Read-only.

1. If no account ID is given and `GOOGLE_MERCHANT_ACCOUNT_ID` is not set, stop and ask for the numeric Merchant Center account ID.
2. Call `mcp__plugin_awesome-seo_google__google_merchant_list_product_issues` with `account` set when given, and `page_size: 250`.
3. If the call returns an error, report it with its code and stop. `AUTH_EXPIRED` (the message says "Merchant API returned HTTP 401") means the service account is not registered for this Merchant Center account: add the service account email as a user in Merchant Center (Settings, then Users), with read access. `PERMISSION_DENIED` means the user exists without enough access. Do not guess issues.
4. Show the issue groups in order: code, severity, number of affected products (each product once per code), and up to 20 products with their title and link. Say how many products were read, and whether the result is partial.
5. Use the `merchant-feed-health` skill for the report wording. Mention the report path if one is written.
