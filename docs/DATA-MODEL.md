# Data model (SQLite)

Status: 2026-11-05. Each table is marked implemented, or planned where the code does not write it yet. Migrations live in `packages/core/migrations/`.

## Principles

- WAL mode, foreign keys on, `busy_timeout` set.
- Single writer: `packages/core` only.
- All timestamps are ISO 8601 UTC text.
- JSON columns are stored as TEXT and validated with Zod on read and write.
- Every table that holds external data has `site_id`, `source`, and `collected_at` where relevant.
- Migrations are versioned and idempotent. Each migration is recorded in `schema_migrations`.
- Secrets are never stored. Credentials are referenced by name.

## Tables

### `sites` (implemented)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| canonical_origin | TEXT | e.g. `https://example.com` |
| sitemap_url | TEXT | |
| url_cap | INTEGER | default 500 |
| created_at | TEXT | |

### `site_properties` (planned: not written yet)
Maps a site to provider-specific identifiers.
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| site_id | TEXT FK → sites | |
| provider | TEXT | `gsc`, `ga4`, `bing`, `yandex_webmaster`, `yandex_metrica`, `merchant`, `psi` |
| external_id | TEXT | property URL, GA4 property ID, counter ID, host ID, account ID |
| UNIQUE | (site_id, provider) | |

### `connections` (planned: not written yet)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| provider | TEXT | |
| auth_type | TEXT | `service_account`, `oauth`, `api_key` |
| credential_ref | TEXT | name of the entry in the OS keychain or encrypted store |
| scopes | TEXT (JSON) | |
| status | TEXT | `ok`, `missing`, `expired`, `permission_denied`, `unknown` |
| last_checked_at | TEXT | |

### `pages` (implemented)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| site_id | TEXT FK | |
| url | TEXT | normalized absolute URL |
| source | TEXT | `sitemap`, `gsc`, `bing`, `yandex`, `crawl` |
| lastmod | TEXT | from sitemap, nullable |
| first_seen_at | TEXT | |
| last_seen_at | TEXT | |
| UNIQUE | (site_id, url) | |

### `queries` (planned: not written yet)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| site_id | TEXT FK | |
| query | TEXT | |
| locale | TEXT | nullable |
| UNIQUE | (site_id, query, locale) | |

### `observations` (implemented; sources: gsc, ga4, bing, yandex_webmaster, yandex_metrica, crawl)
Normalized metrics from every source.
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| site_id | TEXT FK | |
| source | TEXT | `gsc`, `ga4`, `bing`, `yandex_webmaster`, `yandex_metrica`, `merchant`, `psi`, `lighthouse-local`, `crux`, `crawl` |
| entity_type | TEXT | `site`, `page`, `query`, `product`, `sitemap` |
| entity_id | TEXT | |
| metric | TEXT | e.g. `clicks`, `impressions`, `position`, `lab_lcp_ms`, `field_lcp_p75_ms` |
| value | REAL | |
| unit | TEXT | nullable |
| period_start | TEXT | |
| period_end | TEXT | |
| collected_at | TEXT | |
| freshness | TEXT | `realtime`, `daily`, `delayed`, `snapshot` |
| dimensions_json | TEXT | |
| provenance_json | TEXT | tool name, request parameters hash, `run_id` |

Indexes:
- `idx_observations_lookup` on `(site_id, source, metric, period_start)`
- `idx_observations_entity` on `(site_id, entity_type, entity_id)`

### `api_cache` (planned: not written yet)
| Column | Type | Notes |
|---|---|---|
| cache_key | TEXT PK | hash of tool name and parameters |
| response_json | TEXT | |
| created_at | TEXT | |
| expires_at | TEXT | TTL |

### `crawl_runs` (implemented)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | run ID |
| site_id | TEXT FK | |
| started_at | TEXT | |
| finished_at | TEXT | |
| url_count | INTEGER | |
| status | TEXT | `completed` or `partial` (any URL with errors). `running` and `failed` are reserved |
| jsonl_path | TEXT | |

### `crawl_results` (implemented)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| run_id | TEXT FK → crawl_runs | |
| page_id | TEXT FK → pages | |
| fetched_at | TEXT | added in P4 |
| status | INTEGER | HTTP status; null when robots blocked the URL before any request |
| final_url | TEXT | |
| redirect_chain_json | TEXT | added in P4: hops with from, status, to |
| title | TEXT | |
| meta_description | TEXT | |
| canonical | TEXT | |
| lang | TEXT | |
| hreflang_json | TEXT | added in P4 |
| headings_json | TEXT | added in P4: level and text, in document order |
| word_count | INTEGER | |
| content_hash | TEXT | `sha256:` of visible text only |
| robots_allowed | INTEGER | 1 allowed, 0 disallowed, null unknown (robots.txt unreadable) |
| structured_data_json | TEXT | |
| raw_html_path | TEXT | added in P4: gzipped raw HTML, off by default |
| jsonld_syntax_errors | INTEGER | added in P6: JSON-LD blocks that fail strict JSON parsing; null when not extracted |
| errors_json | TEXT | |

### `audit_runs` (planned: reports are generated, not stored yet)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| site_id | TEXT FK | |
| command | TEXT | e.g. `seo-audit` |
| started_at | TEXT | |
| finished_at | TEXT | |
| date_range_start | TEXT | |
| date_range_end | TEXT | |
| status | TEXT | |
| summary_json | TEXT | sources used, sources missing |

### `findings` (planned: findings are in reports, not stored yet)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| audit_run_id | TEXT FK | |
| category | TEXT | `seo`, `geo`, `aio`, `aeo`, `analytics`, `performance`, `ecommerce` |
| severity | TEXT | `info`, `low`, `medium`, `high` |
| confidence | TEXT | `high`, `medium`, `low` |
| title | TEXT | |
| description | TEXT | English |
| affected_count | INTEGER | |
| status | TEXT | `open`, `resolved`, `unverified` |

### `evidence` (planned: evidence ids are checked in code, not stored yet)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| finding_id | TEXT FK → findings | |
| observation_id | TEXT FK → observations | nullable |
| crawl_result_id | TEXT FK → crawl_results | nullable |
| note | TEXT | |

Rule: a finding must have at least one evidence row. The evidence-auditor checks this.

### `opportunities` (planned, P12)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| audit_run_id | TEXT FK | |
| finding_ids_json | TEXT | |
| score | REAL | project-defined, see docs/SCORING.md |
| effort | TEXT | `low`, `medium`, `high` |
| description | TEXT | |

### `action_proposals` (implemented, P10)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| site_id | TEXT FK | |
| action_type | TEXT | e.g. `google_gsc_submit_sitemap` |
| target | TEXT | |
| description | TEXT | |
| proposed_payload_json | TEXT | |
| payload_hash | TEXT | sha256 of canonicalized payload |
| expected_impact | TEXT | nullable |
| risk_level | TEXT | `low`, `medium`, `high` |
| status | TEXT | `pending`, `approved`, `rejected`, `executed`, `failed`, `expired` |
| created_at | TEXT | |
| expires_at | TEXT | |

### `approvals` (implemented, P10)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| proposal_id | TEXT FK | |
| payload_hash | TEXT | hash at approval time |
| approved_at | TEXT | |
| approved_by | TEXT | `user` |

### `execution_logs` (implemented, P10)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| proposal_id | TEXT FK | |
| started_at | TEXT | |
| finished_at | TEXT | |
| outcome | TEXT | `success`, `failure` |
| verification_json | TEXT | post-execution check result |
| error_json | TEXT | nullable |

### `schema_migrations` (implemented; migrations 0000 to 0003)
| Column | Type | Notes |
|---|---|---|
| version | INTEGER PK | |
| name | TEXT | |
| applied_at | TEXT | |