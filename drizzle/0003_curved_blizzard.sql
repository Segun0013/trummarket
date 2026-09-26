CREATE TABLE `walletAccountMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`walletUserId` int NOT NULL,
	`role` enum('owner','admin','member') NOT NULL DEFAULT 'member',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `walletAccountMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `walletAccountMembers_account_user_unique` UNIQUE(`accountId`,`walletUserId`)
);
--> statement-breakpoint
CREATE TABLE `walletAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerWalletUserId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` enum('personal','shared') NOT NULL DEFAULT 'personal',
	`currency` varchar(3) NOT NULL DEFAULT 'RUB',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `walletAccounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `walletAccounts_owner_name_unique` UNIQUE(`ownerWalletUserId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `walletCategories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`accountId` int NOT NULL,
	`kind` enum('income','expense') NOT NULL,
	`name` varchar(80) NOT NULL,
	`icon` varchar(12) NOT NULL DEFAULT '•',
	`color` varchar(16) NOT NULL DEFAULT 'slate',
	`isSystem` int NOT NULL DEFAULT 0,
	`sortOrder` int NOT NULL DEFAULT 0,
	`archivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `walletCategories_id` PRIMARY KEY(`id`),
	CONSTRAINT `walletCategories_account_kind_name_unique` UNIQUE(`accountId`,`kind`,`name`)
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `accountId` int;--> statement-breakpoint
ALTER TABLE `transactions` ADD `categoryId` int;--> statement-breakpoint
ALTER TABLE `transactions` ADD `source` enum('manual','command','text','voice','receipt') DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `status` enum('confirmed','pending') DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `idempotencyKey` varchar(128);--> statement-breakpoint
ALTER TABLE `transactions` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `transactions` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_account_idempotency_unique` UNIQUE(`accountId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `walletAccountMembers_user_idx` ON `walletAccountMembers` (`walletUserId`);--> statement-breakpoint
CREATE INDEX `walletCategories_account_kind_idx` ON `walletCategories` (`accountId`,`kind`);--> statement-breakpoint
CREATE INDEX `transactions_account_occurredAt_idx` ON `transactions` (`accountId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `transactions_account_category_idx` ON `transactions` (`accountId`,`categoryId`);
--> statement-breakpoint
-- Backfill: create one personal account and an owner membership per existing wallet user.
INSERT INTO `walletAccounts` (`ownerWalletUserId`, `name`, `type`, `currency`)
SELECT `id`, CONCAT(`firstName`, ' wallet'), 'personal', 'RUB'
FROM `walletUsers`
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
--> statement-breakpoint
INSERT INTO `walletAccountMembers` (`accountId`, `walletUserId`, `role`)
SELECT `walletAccounts`.`id`, `walletUsers`.`id`, 'owner'
FROM `walletAccounts`
INNER JOIN `walletUsers` ON `walletAccounts`.`ownerWalletUserId` = `walletUsers`.`id`
WHERE `walletAccounts`.`type` = 'personal'
ON DUPLICATE KEY UPDATE `role` = 'owner';
--> statement-breakpoint
-- Seed system categories for each migrated personal account.
INSERT INTO `walletCategories` (`accountId`, `kind`, `name`, `icon`, `color`, `isSystem`, `sortOrder`)
SELECT `walletAccounts`.`id`, `seed`.`kind`, `seed`.`name`, `seed`.`icon`, `seed`.`color`, 1, `seed`.`sortOrder`
FROM `walletAccounts`
INNER JOIN (
  SELECT 'expense' AS `kind`, 'Продукты' AS `name`, '🛒' AS `icon`, 'emerald' AS `color`, 10 AS `sortOrder`
  UNION ALL SELECT 'expense', 'Транспорт', '🚕', 'sky', 20
  UNION ALL SELECT 'expense', 'Дом', '⌂', 'amber', 30
  UNION ALL SELECT 'expense', 'Здоровье', '✚', 'rose', 40
  UNION ALL SELECT 'expense', 'Развлечения', '✦', 'violet', 50
  UNION ALL SELECT 'expense', 'Другое', '•', 'slate', 99
  UNION ALL SELECT 'income', 'Зарплата', '↗', 'emerald', 10
  UNION ALL SELECT 'income', 'Подработка', '✦', 'sky', 20
  UNION ALL SELECT 'income', 'Подарок', '♡', 'rose', 30
  UNION ALL SELECT 'income', 'Другое', '•', 'slate', 99
) AS `seed` ON 1 = 1
WHERE `walletAccounts`.`type` = 'personal'
ON DUPLICATE KEY UPDATE `icon` = VALUES(`icon`), `color` = VALUES(`color`), `sortOrder` = VALUES(`sortOrder`);
--> statement-breakpoint
-- Preserve legacy free-form category names before joining old operations to categories.
INSERT INTO `walletCategories` (`accountId`, `kind`, `name`, `icon`, `color`, `isSystem`, `sortOrder`)
SELECT `walletAccounts`.`id`, `transactions`.`kind`, `transactions`.`category`, '•', 'slate', 0, 1000
FROM `transactions`
INNER JOIN `walletAccounts` ON `walletAccounts`.`ownerWalletUserId` = `transactions`.`walletUserId` AND `walletAccounts`.`type` = 'personal'
GROUP BY `walletAccounts`.`id`, `transactions`.`kind`, `transactions`.`category`
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
--> statement-breakpoint
UPDATE `transactions`
INNER JOIN `walletAccounts` ON `walletAccounts`.`ownerWalletUserId` = `transactions`.`walletUserId` AND `walletAccounts`.`type` = 'personal'
SET `transactions`.`accountId` = `walletAccounts`.`id`
WHERE `transactions`.`accountId` IS NULL;
--> statement-breakpoint
UPDATE `transactions`
INNER JOIN `walletCategories` ON `walletCategories`.`accountId` = `transactions`.`accountId`
  AND `walletCategories`.`kind` = `transactions`.`kind`
  AND `walletCategories`.`name` = `transactions`.`category`
SET `transactions`.`categoryId` = `walletCategories`.`id`
WHERE `transactions`.`categoryId` IS NULL;
