CREATE TABLE `walletBudgets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`categoryId` int NOT NULL,
	`amountCents` int NOT NULL,
	`period` enum('monthly') NOT NULL DEFAULT 'monthly',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `walletBudgets_id` PRIMARY KEY(`id`),
	CONSTRAINT `walletBudgets_account_category_period_unique` UNIQUE(`accountId`,`categoryId`,`period`)
);
--> statement-breakpoint
CREATE INDEX `walletBudgets_account_idx` ON `walletBudgets` (`accountId`);