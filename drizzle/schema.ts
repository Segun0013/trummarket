import { index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const walletUsers = mysqlTable("walletUsers", {
  id: int("id").autoincrement().primaryKey(),
  telegramId: varchar("telegramId", { length: 32 }).notNull(),
  username: varchar("username", { length: 64 }),
  firstName: varchar("firstName", { length: 128 }).notNull(),
  lastName: varchar("lastName", { length: 128 }),
  locale: mysqlEnum("locale", ["ru", "en"]).default("en").notNull(),
  localeSelectedAt: timestamp("localeSelectedAt"),
  timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),
  reminderEnabled: int("reminderEnabled").default(0).notNull(),
  reminderHour: int("reminderHour").default(20).notNull(),
  reminderCronTaskUid: varchar("reminderCronTaskUid", { length: 65 }),
  reportFrequency: mysqlEnum("reportFrequency", ["off", "weekly", "monthly"]).default("off").notNull(),
  reportCronTaskUid: varchar("reportCronTaskUid", { length: 65 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("walletUsers_telegramId_unique").on(table.telegramId),
  index("walletUsers_reminder_task_idx").on(table.reminderCronTaskUid),
  index("walletUsers_report_frequency_idx").on(table.reportFrequency),
  index("walletUsers_report_task_idx").on(table.reportCronTaskUid),
]);

export const walletAccounts = mysqlTable("walletAccounts", {
  id: int("id").autoincrement().primaryKey(),
  ownerWalletUserId: int("ownerWalletUserId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  type: mysqlEnum("type", ["personal", "shared"]).default("personal").notNull(),
  currency: varchar("currency", { length: 3 }).default("RUB").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("walletAccounts_owner_name_unique").on(table.ownerWalletUserId, table.name),
]);

export const walletAccountMembers = mysqlTable("walletAccountMembers", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  walletUserId: int("walletUserId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "member"]).default("member").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("walletAccountMembers_account_user_unique").on(table.accountId, table.walletUserId),
  index("walletAccountMembers_user_idx").on(table.walletUserId),
]);

/** Opaque, single-use tokens used only for Telegram deep-link invitations. */
export const walletAccountInvitations = mysqlTable("walletAccountInvitations", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  token: varchar("token", { length: 64 }).notNull(),
  role: mysqlEnum("role", ["admin", "member"]).default("member").notNull(),
  createdByWalletUserId: int("createdByWalletUserId").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  acceptedByWalletUserId: int("acceptedByWalletUserId"),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("walletAccountInvitations_token_unique").on(table.token),
  index("walletAccountInvitations_account_status_idx").on(table.accountId, table.expiresAt),
  index("walletAccountInvitations_creator_idx").on(table.createdByWalletUserId),
]);

export const walletCategories = mysqlTable("walletCategories", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  kind: mysqlEnum("kind", ["income", "expense"]).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  icon: varchar("icon", { length: 12 }).default("•").notNull(),
  color: varchar("color", { length: 16 }).default("slate").notNull(),
  isSystem: int("isSystem").default(0).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  archivedAt: timestamp("archivedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("walletCategories_account_kind_name_unique").on(table.accountId, table.kind, table.name),
  index("walletCategories_account_kind_idx").on(table.accountId, table.kind),
]);

export const transactions = mysqlTable("transactions", {
  id: int("id").autoincrement().primaryKey(),
  walletUserId: int("walletUserId").notNull(),
  accountId: int("accountId"),
  categoryId: int("categoryId"),
  kind: mysqlEnum("kind", ["income", "expense"]).notNull(),
  amountCents: int("amountCents").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  description: text("description"),
  source: mysqlEnum("source", ["manual", "command", "text", "voice", "receipt"]).default("manual").notNull(),
  status: mysqlEnum("status", ["confirmed", "pending"]).default("confirmed").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deletedAt"),
}, table => [
  index("transactions_walletUser_occurredAt_idx").on(table.walletUserId, table.occurredAt),
  index("transactions_walletUser_kind_idx").on(table.walletUserId, table.kind),
  index("transactions_account_occurredAt_idx").on(table.accountId, table.occurredAt),
  index("transactions_account_category_idx").on(table.accountId, table.categoryId),
  uniqueIndex("transactions_account_idempotency_unique").on(table.accountId, table.idempotencyKey),
]);

export const walletDrafts = mysqlTable("walletDrafts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  walletUserId: int("walletUserId").notNull(),
  accountId: int("accountId").notNull(),
  telegramChatId: varchar("telegramChatId", { length: 32 }),
  kind: mysqlEnum("kind", ["income", "expense"]).notNull(),
  amountCents: int("amountCents").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  description: varchar("description", { length: 280 }),
  rawText: text("rawText").notNull(),
  source: mysqlEnum("source", ["text", "voice", "receipt"]).default("text").notNull(),
  confidence: int("confidence").default(0).notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "cancelled", "expired"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("walletDrafts_user_status_idx").on(table.walletUserId, table.status),
  index("walletDrafts_account_status_idx").on(table.accountId, table.status),
]);

/** Monthly spending limits are account-scoped and apply to one expense category. */
export const walletBudgets = mysqlTable("walletBudgets", {
  id: int("id").autoincrement().primaryKey(),
  accountId: int("accountId").notNull(),
  categoryId: int("categoryId").notNull(),
  amountCents: int("amountCents").notNull(),
  period: mysqlEnum("period", ["monthly"]).default("monthly").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("walletBudgets_account_category_period_unique").on(table.accountId, table.categoryId, table.period),
  index("walletBudgets_account_idx").on(table.accountId),
]);

/** Claims outbound scheduled messages before sending so retries do not duplicate them. */
export const walletScheduledDeliveries = mysqlTable("walletScheduledDeliveries", {
  id: int("id").autoincrement().primaryKey(),
  taskUid: varchar("taskUid", { length: 65 }).notNull(),
  walletUserId: int("walletUserId").notNull(),
  kind: mysqlEnum("kind", ["reminder", "report"]).notNull(),
  periodKey: varchar("periodKey", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("walletScheduledDeliveries_unique").on(table.taskUid, table.walletUserId, table.kind, table.periodKey),
  index("walletScheduledDeliveries_user_idx").on(table.walletUserId, table.createdAt),
]);

export type WalletUser = typeof walletUsers.$inferSelect;
export type WalletAccount = typeof walletAccounts.$inferSelect;
export type WalletAccountInvitation = typeof walletAccountInvitations.$inferSelect;
export type WalletCategory = typeof walletCategories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type WalletDraft = typeof walletDrafts.$inferSelect;
export type WalletBudget = typeof walletBudgets.$inferSelect;
export type WalletScheduledDelivery = typeof walletScheduledDeliveries.$inferSelect;
