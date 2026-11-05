CREATE TABLE `crawl_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`page_id` text NOT NULL,
	`fetched_at` text NOT NULL,
	`status` integer,
	`final_url` text,
	`redirect_chain_json` text,
	`title` text,
	`meta_description` text,
	`canonical` text,
	`lang` text,
	`hreflang_json` text,
	`headings_json` text,
	`word_count` integer,
	`content_hash` text,
	`robots_allowed` integer,
	`structured_data_json` text,
	`raw_html_path` text,
	`errors_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `crawl_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_crawl_results_run` ON `crawl_results` (`run_id`);--> statement-breakpoint
CREATE TABLE `crawl_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`url_count` integer NOT NULL,
	`status` text NOT NULL,
	`jsonl_path` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
