DROP TABLE IF EXISTS `claims`;--> statement-breakpoint
DROP TABLE IF EXISTS `nodes`;--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`normalized_label` text NOT NULL
);--> statement-breakpoint
CREATE TABLE `entity_aliases` (
	`entity_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	CONSTRAINT `entity_aliases_pk` PRIMARY KEY(`entity_id`, `normalized_alias`),
	CONSTRAINT `fk_entity_aliases_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`relation` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`identity_key` text NOT NULL,
	CONSTRAINT `fk_claims_from_entities_id_fk` FOREIGN KEY (`from`) REFERENCES `entities`(`id`),
	CONSTRAINT `fk_claims_to_entities_id_fk` FOREIGN KEY (`to`) REFERENCES `entities`(`id`)
);--> statement-breakpoint
CREATE TABLE `claim_sources` (
	`claim_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	CONSTRAINT `claim_sources_pk` PRIMARY KEY(`claim_id`, `conversation_id`),
	CONSTRAINT `fk_claim_sources_claim_id_claims_id_fk` FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_claim_sources_conversation_id_sessions_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `sessions`(`id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `entities_type_key` ON `entities` (`type`,`key`);--> statement-breakpoint
CREATE INDEX `entities_type_normalized_label` ON `entities` (`type`,`normalized_label`);--> statement-breakpoint
CREATE INDEX `entity_aliases_normalized` ON `entity_aliases` (`normalized_alias`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `claims_identity_key` ON `claims` (`identity_key`);--> statement-breakpoint
CREATE INDEX `claims_from_relation_time` ON `claims` (`from`,`relation`,`valid_to`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `claims_to_relation_time` ON `claims` (`to`,`relation`,`valid_to`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `claims_relation_time` ON `claims` (`relation`,`valid_to`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `claim_sources_conversation` ON `claim_sources` (`conversation_id`,`claim_id`);
