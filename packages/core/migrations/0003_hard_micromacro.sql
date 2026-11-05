CREATE TABLE `action_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`action_type` text NOT NULL,
	`target` text NOT NULL,
	`description` text NOT NULL,
	`proposed_payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`expected_impact` text,
	`risk_level` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`approved_at` text NOT NULL,
	`approved_by` text NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `action_proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `execution_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`outcome` text NOT NULL,
	`verification_json` text,
	`error_json` text,
	FOREIGN KEY (`proposal_id`) REFERENCES `action_proposals`(`id`) ON UPDATE no action ON DELETE no action
);
