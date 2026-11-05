CREATE TABLE `api_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`auth_type` text NOT NULL,
	`credential_ref` text NOT NULL,
	`scopes_json` text,
	`status` text NOT NULL,
	`last_checked_at` text
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`period_start` text,
	`period_end` text,
	`collected_at` text NOT NULL,
	`freshness` text NOT NULL,
	`dimensions_json` text,
	`provenance_json` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_observations_lookup` ON `observations` (`site_id`,`source`,`metric`,`period_start`);--> statement-breakpoint
CREATE INDEX `idx_observations_entity` ON `observations` (`site_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`lastmod` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pages_site_url` ON `pages` (`site_id`,`url`);--> statement-breakpoint
CREATE TABLE `site_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_site_properties_site_provider` ON `site_properties` (`site_id`,`provider`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`canonical_origin` text NOT NULL,
	`sitemap_url` text,
	`url_cap` integer DEFAULT 500 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_canonical_origin_unique` ON `sites` (`canonical_origin`);