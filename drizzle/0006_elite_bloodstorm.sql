ALTER TABLE `walletUsers` ADD `reportCronTaskUid` varchar(65);--> statement-breakpoint
CREATE INDEX `walletUsers_report_task_idx` ON `walletUsers` (`reportCronTaskUid`);