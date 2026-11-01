-- Projects, models, error types, and endpoints count their saves, like pages, so a save can't overwrite a newer one.
ALTER TABLE `endpoints` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `error_types` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `models` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `revision` integer DEFAULT 0 NOT NULL;
