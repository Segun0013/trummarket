CREATE TABLE `walletScheduledDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskUid` varchar(65) NOT NULL,
	`walletUserId` int NOT NULL,
	`kind` enum('reminder','report') NOT NULL,
	`periodKey` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `walletScheduledDeliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `walletScheduledDeliveries_unique` UNIQUE(`taskUid`,`walletUserId`,`kind`,`periodKey`)
);
--> statement-breakpoint
ALTER TABLE `walletUsers` ADD `timezone` varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE `walletUsers` ADD `reminderEnabled` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `walletUsers` ADD `reminderHour` int DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `walletUsers` ADD `reminderCronTaskUid` varchar(65);--> statement-breakpoint
ALTER TABLE `walletUsers` ADD `reportFrequency` enum('off','weekly','monthly') DEFAULT 'off' NOT NULL;--> statement-breakpoint
CREATE INDEX `walletScheduledDeliveries_user_idx` ON `walletScheduledDeliveries` (`walletUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `walletUsers_reminder_task_idx` ON `walletUsers` (`reminderCronTaskUid`);--> statement-breakpoint
CREATE INDEX `walletUsers_report_frequency_idx` ON `walletUsers` (`reportFrequency`);