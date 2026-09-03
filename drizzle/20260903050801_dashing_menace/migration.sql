CREATE TABLE IF NOT EXISTS `claims` (
	`id` text PRIMARY KEY,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`relation` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_claims_from_nodes_id_fk` FOREIGN KEY (`from`) REFERENCES `nodes`(`id`),
	CONSTRAINT `fk_claims_to_nodes_id_fk` FOREIGN KEY (`to`) REFERENCES `nodes`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversation_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` text NOT NULL,
	`item_json` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_conversation_items_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "conversation_items_item_json_valid" CHECK(json_valid("item_json"))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `nodes` (
	`id` text PRIMARY KEY,
	`content` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `claims_from` ON `claims` (`from`,`relation`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `claims_to` ON `claims` (`to`,`relation`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `conversation_items_session_id` ON `conversation_items` (`session_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_active_updated_at` ON `sessions` (`archived_at`,`updated_at`);
