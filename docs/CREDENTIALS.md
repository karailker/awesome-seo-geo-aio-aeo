# Credentials

The plugin's MCP servers read their credentials from the environment that Claude Code had when it started. They do not read `.env` files. Three rules follow:

1. Set the variables in the shell that starts Claude Code, or start Claude Code with a project launcher that sets them (see below).
2. Never commit secrets. Keep key files in mode 600 outside the repository.
3. Check with `/connections-check` after any change. It shows only true or false per credential.

## Variables

| Server | Variable | What it is | Where it comes from |
|---|---|---|---|
| google | `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Path to a service account JSON key | Google Cloud console, IAM, service account, Keys |
| google (Merchant) | `GOOGLE_MERCHANT_ACCOUNT_ID` | Numeric Merchant Center account ID | Merchant Center, account settings |
| bing | `BING_WEBMASTER_API_KEY` | Bing Webmaster API key | Bing Webmaster Tools, Settings, API Access |
| performance | `PAGESPEED_API_KEY` | PageSpeed Insights key | Google Cloud console, API key for PageSpeed Insights API |
| performance | `CRUX_API_KEY` | Chrome UX Report key (optional) | Google Cloud console, API key |
| yandex | `YANDEX_WEBMASTER_TOKEN`, `YANDEX_METRICA_TOKEN`, `YANDEX_METRICA_COUNTER_ID` | Yandex OAuth token and Metrica counter (optional) | Yandex OAuth app; Metrica counter settings |

`GOOGLE_MERCHANT_OAUTH_TOKEN_FILE` is listed by the Google health check, but the Merchant tools use the service account. You do not need it.

## Google: service account (Search Console, GA4, Merchant)

One service account covers Search Console, GA4 and Merchant.

1. Enable the APIs in the project: Search Console API, Google Analytics Data API, Merchant API, PageSpeed Insights API.
2. Create a key for the service account and save it outside the repository, mode 600.
3. Give the service account email access where the data is:
   - Search Console: add it as a user of the property (Settings, Users and permissions). Use the domain property if you have one.
   - GA4: add it as a viewer of the property.
   - Merchant Center: add it as a user of the account with read access.
4. Set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` to the key path. Google CLI (gcloud) is not required for the plugin. Do not register the service account in gcloud unless you need it for something else.

## Project launcher (one project, its own credentials)

For a site with its own credentials, keep them in that project's `.env` (mode 600, gitignored) and start Claude Code through a launcher that loads it and maps the names. The launcher pattern is in the erolav project (`bin/claude-erolav`): it loads `.env`, sets `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` from the project's key path, and unsets other sites' Yandex and CrUX variables.

Start Claude Code from a real terminal, not from a non-interactive shell. Sessions started any other way use the shell's variables, which may belong to another site.

## Shell setup for a single site

Add the exports to `~/.bashrc` only when all work uses one site. Source the key file path and the other variables, then start Claude Code from a new terminal.
