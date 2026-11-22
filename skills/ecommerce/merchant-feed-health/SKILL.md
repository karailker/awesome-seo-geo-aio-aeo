---
name: merchant-feed-health
description: Merchant Center product issues grouped by type, each linked to product IDs and affected URLs. Use for ecommerce audits when a Merchant Center account is connected.
---

## Purpose
Show which product issues block or limit listings, grouped by issue code, with the products and URLs they affect.

## When to use
- `/ecommerce-audit` when `GOOGLE_MERCHANT_ACCOUNT_ID` is set and the service account has access to the account.
- Not for: changing products (write tools come in P10 and need an approved proposal), or Shopping ads performance.

## Inputs
- Merchant account ID (numeric).

## Tools
- `google_merchant_list_product_issues` (grouped issues with affected products).
- `google_merchant_list_products` (products with issue counts, for paging).

## Method
1. Read issue groups. Each group has a code, severity, and the products it affects. A product appears once per code, with its title and link.
2. Order groups by number of affected products. Show the top groups with their products and URLs.
3. Do not infer issues from product data. Only report what the API returned.

## Evidence rules
- Each group cites its product IDs and link values from the API response.
- Severity is as returned by the API. Do not re-rate it.

## Output schema
Section "Merchant feed health" in the ecommerce report: groups in order, each with counts, severity, and up to 20 product rows.

## Quality checks
- The product count read is stated. If there was a next page, say that the audit is partial.
- The Merchant API version used is VERIFY-marked in code and in the report.

## Missing and failed data
- `AUTH_EXPIRED` ("Merchant API returned HTTP 401"): the service account is not registered for the Merchant Center account. Say so and give the setup step (add its email as a user in Merchant Center); do not guess issues.
- `PERMISSION_DENIED`: the service account is a user without enough access.
- Account ID missing: say the variable is not set.
