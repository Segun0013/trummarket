CREATE TABLE `walletAccountInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`token` varchar(64) NOT NULL,
	`role` enum('admin','member') NOT NULL DEFAULT 'member',
	`createdByWalletUserId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`acceptedByWalletUserId` int,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `walletAccountInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `walletAccountInvitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `walletAccountInvitations_account_status_idx` ON `walletAccountInvitations` (`accountId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `walletAccountInvitations_creator_idx` ON `walletAccountInvitations` (`createdByWalletUserId`);