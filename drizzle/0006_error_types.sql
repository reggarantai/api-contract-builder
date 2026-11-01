CREATE TABLE `error_types` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`headers` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_types_project_id_name_unique` ON `error_types` (`project_id`,`name`);
--> statement-breakpoint
-- Responses gained `errors`: the catalog errors they answer with.
UPDATE `endpoints` SET `responses` = (
	SELECT json_group_array(json_insert(`value`, '$.errors', json('[]')))
	FROM (SELECT `value` FROM json_each(`endpoints`.`responses`) ORDER BY `key`)
);
