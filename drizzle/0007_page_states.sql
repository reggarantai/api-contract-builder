-- Pages gained `states`: what the page shows, and the calls and responses that lead to each.
ALTER TABLE `pages` ADD `states` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- And `revision`, which counts saves of the page's fields, so a save can't overwrite a newer one.
ALTER TABLE `pages` ADD `revision` integer DEFAULT 0 NOT NULL;
