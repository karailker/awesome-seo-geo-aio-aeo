# Credentials

The plugin's MCP servers read the project's `.env` file directly. The plugin sets `AWESOME_SEO_ENV_FILE` to `${CLAUDE_PROJECT_DIR}/.env`, and each server loads the variables it uses from that file at startup. Three rules follow:

1. Put a project's credentials in its own `.env`, mode 600, gitignored. Copy `.env.example` (names only) and fill in values.
2. The project file takes precedence over exported shell variables, so one site's `.env` never uses another site's keys. You do not need `~/.bashrc` exports for plugin credentials.
3. Check with `/connections-check` after any change. It shows only true or false per credential. A warning is printed if the `.env` is readable by others.

Key files can be given as a path relative to the project (for example `./keys/sa.json`) or with `~/`.

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

## Project launcher (optional, older setups)

The `.env` file is read by the servers themselves now, so a launcher is not needed. The launcher pattern is kept for reference: it loads `.env` in the shell and starts Claude Code. The launcher pattern is in the erolav project (`bin/claude-erolav`): it loads `.env`, sets `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` from the project's key path, and unsets other sites' Yandex and CrUX variables.

Start Claude Code from a real terminal, not from a non-interactive shell. Sessions started any other way use the shell's variables, which may belong to another site.

## Shell setup (not needed)

The servers read the project `.env`. Shell exports are only a fallback when a project has no `.env`.
