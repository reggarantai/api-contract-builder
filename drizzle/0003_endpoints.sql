CREATE TABLE `endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`path_key` text NOT NULL,
	`operation_id` text NOT NULL,
	`summary` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`deprecated` integer NOT NULL,
	`security` text NOT NULL,
	`parameters` text NOT NULL,
	`request_body` text,
	`responses` text NOT NULL,
	`notes_fe` text NOT NULL,
	`notes_be` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `endpoints_project_id_method_path_key_unique` ON `endpoints` (`project_id`,`method`,`path_key`);