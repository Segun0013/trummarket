ALTER TABLE `walletUsers` ADD `locale` enum('ru','en') DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `walletUsers` ADD `localeSelectedAt` timestamp;