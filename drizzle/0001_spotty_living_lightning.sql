CREATE TABLE `transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`walletUserId` int NOT NULL,
	`kind` enum('income','expense') NOT NULL,
	`amountCents` int NOT NULL,
	`category` varchar(80) NOT NULL,
	`description` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `walletUsers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramId` varchar(32) NOT NULL,
	`username` varchar(64),
	`firstName` varchar(128) NOT NULL,
	`lastName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `walletUsers_id` PRIMARY KEY(`id`),
	CONSTRAINT `walletUsers_telegramId_unique` UNIQUE(`telegramId`)
);
--> statement-breakpoint
CREATE INDEX `transactions_walletUser_occurredAt_idx` ON `transactions` (`walletUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `transactions_walletUser_kind_idx` ON `transactions` (`walletUserId`,`kind`);