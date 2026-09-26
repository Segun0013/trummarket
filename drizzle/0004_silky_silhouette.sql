CREATE TABLE `walletDrafts` (
	`id` varchar(64) NOT NULL,
	`walletUserId` int NOT NULL,
	`accountId` int NOT NULL,
	`telegramChatId` varchar(32),
	`kind` enum('income','expense') NOT NULL,
	`amountCents` int NOT NULL,
	`category` varchar(80) NOT NULL,
	`description` varchar(280),
	`rawText` text NOT NULL,
	`source` enum('text','voice','receipt') NOT NULL DEFAULT 'text',
	`confidence` int NOT NULL DEFAULT 0,
	`status` enum('pending','confirmed','cancelled','expired') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `walletDrafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `walletDrafts_user_status_idx` ON `walletDrafts` (`walletUserId`,`status`);--> statement-breakpoint
CREATE INDEX `walletDrafts_account_status_idx` ON `walletDrafts` (`accountId`,`status`);