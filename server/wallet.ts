import { and, desc, eq, gt, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  transactions,
  walletAccountMembers,
  walletAccountInvitations,
  walletAccounts,
  walletBudgets,
  walletCategories,
  walletDrafts,
  walletUsers,
  type Transaction,
  type WalletAccount,
  type WalletCategory,
  type WalletDraft,
  type WalletUser,
} from "../drizzle/schema";
import type { TelegramIdentity } from "./telegramAuth";
import type { WalletLocale } from "./i18n";

export type TransactionKind = "income" | "expense";
export type TransactionSource = "manual" | "command" | "text" | "voice" | "receipt";
export type WalletAccountRole = "owner" | "admin" | "member";

type SystemCategory = Pick<WalletCategory, "kind" | "name" | "icon" | "color" | "sortOrder">;

const SYSTEM_CATEGORIES: SystemCategory[] = [
  { kind: "expense", name: "Продукты", icon: "🛒", color: "emerald", sortOrder: 10 },
  { kind: "expense", name: "Транспорт", icon: "🚕", color: "sky", sortOrder: 20 },
  { kind: "expense", name: "Дом", icon: "⌂", color: "amber", sortOrder: 30 },
  { kind: "expense", name: "Здоровье", icon: "✚", color: "rose", sortOrder: 40 },
  { kind: "expense", name: "Развлечения", icon: "✦", color: "violet", sortOrder: 50 },
  { kind: "expense", name: "Другое", icon: "•", color: "slate", sortOrder: 99 },
  { kind: "income", name: "Зарплата", icon: "↗", color: "emerald", sortOrder: 10 },
  { kind: "income", name: "Подработка", icon: "✦", color: "sky", sortOrder: 20 },
  { kind: "income", name: "Подарок", icon: "♡", color: "rose", sortOrder: 30 },
  { kind: "income", name: "Другое", icon: "•", color: "slate", sortOrder: 99 },
];

export type WalletSummary = {
  currentBalanceCents: number;
  monthlyIncomeCents: number;
  monthlyExpensesCents: number;
  savingsRate: number | null;
  totalIncomeCents: number;
  totalExpenseCents: number;
  incomeByMonth: { month: string; incomeCents: number; expenseCents: number }[];
  expensesByCategory: { category: string; amountCents: number }[];
};

export function amountToCents(amount: string): number {
  const normalized = amount.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("Amount must contain up to two decimal places.");
  const [whole, decimals = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 2_000_000_000) throw new Error("Amount is outside the supported range.");
  return cents;
}

export function getMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function toWalletSummary(allTransactions: Transaction[], now = new Date()): WalletSummary {
  const monthStart = getMonthStart(now);
  let totalIncomeCents = 0;
  let totalExpenseCents = 0;
  let monthlyIncomeCents = 0;
  let monthlyExpensesCents = 0;
  const monthly = new Map<string, { incomeCents: number; expenseCents: number }>();
  const categories = new Map<string, number>();

  for (const transaction of allTransactions) {
    const isIncome = transaction.kind === "income";
    if (isIncome) totalIncomeCents += transaction.amountCents;
    else totalExpenseCents += transaction.amountCents;
    if (transaction.occurredAt >= monthStart) {
      if (isIncome) monthlyIncomeCents += transaction.amountCents;
      else monthlyExpensesCents += transaction.amountCents;
    }
    const month = transaction.occurredAt.toISOString().slice(0, 7);
    const bucket = monthly.get(month) ?? { incomeCents: 0, expenseCents: 0 };
    if (isIncome) bucket.incomeCents += transaction.amountCents;
    else {
      bucket.expenseCents += transaction.amountCents;
      categories.set(transaction.category, (categories.get(transaction.category) ?? 0) + transaction.amountCents);
    }
    monthly.set(month, bucket);
  }

  return {
    currentBalanceCents: totalIncomeCents - totalExpenseCents,
    monthlyIncomeCents,
    monthlyExpensesCents,
    savingsRate: monthlyIncomeCents > 0 ? Math.round(((monthlyIncomeCents - monthlyExpensesCents) / monthlyIncomeCents) * 100) : null,
    totalIncomeCents,
    totalExpenseCents,
    incomeByMonth: Array.from(monthly.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, totals]) => ({ month, ...totals })),
    expensesByCategory: Array.from(categories.entries()).sort(([, a], [, b]) => b - a).slice(0, 5).map(([category, amountCents]) => ({ category, amountCents })),
  };
}

export async function ensureWalletUser(identity: TelegramIdentity): Promise<WalletUser> {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  await db.insert(walletUsers).values({ telegramId: identity.id, username: identity.username ?? null, firstName: identity.firstName, lastName: identity.lastName ?? null }).onDuplicateKeyUpdate({
    set: { username: identity.username ?? null, firstName: identity.firstName, lastName: identity.lastName ?? null },
  });
  const user = await db.select().from(walletUsers).where(eq(walletUsers.telegramId, identity.id)).limit(1);
  if (!user[0]) throw new Error("Unable to load wallet user.");
  return user[0];
}

async function seedSystemCategories(accountId: number) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  for (const category of SYSTEM_CATEGORIES) {
    await db.insert(walletCategories).values({ accountId, ...category, isSystem: 1 }).onDuplicateKeyUpdate({ set: { icon: category.icon, color: category.color, sortOrder: category.sortOrder } });
  }
}

export async function ensurePersonalAccount(identity: TelegramIdentity): Promise<{ user: WalletUser; account: WalletAccount }> {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const user = await ensureWalletUser(identity);
  let account = await db.select().from(walletAccounts).where(and(eq(walletAccounts.ownerWalletUserId, user.id), eq(walletAccounts.type, "personal"))).limit(1);
  if (!account[0]) {
    await db.insert(walletAccounts).values({ ownerWalletUserId: user.id, name: `${user.firstName}’s wallet`, type: "personal" });
    account = await db.select().from(walletAccounts).where(and(eq(walletAccounts.ownerWalletUserId, user.id), eq(walletAccounts.type, "personal"))).limit(1);
  }
  if (!account[0]) throw new Error("Unable to load personal wallet account.");
  await db.insert(walletAccountMembers).values({ accountId: account[0].id, walletUserId: user.id, role: "owner" }).onDuplicateKeyUpdate({ set: { role: "owner" } });
  await seedSystemCategories(account[0].id);
  return { user, account: account[0] };
}

export async function resolveWalletAccount(input: { identity: TelegramIdentity; accountId?: number }): Promise<{ user: WalletUser; account: WalletAccount; role: WalletAccountRole }> {
  if (!input.accountId) {
    const personal = await ensurePersonalAccount(input.identity);
    return { ...personal, role: "owner" };
  }
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const user = await ensureWalletUser(input.identity);
  const membership = await db.select({ account: walletAccounts, role: walletAccountMembers.role })
    .from(walletAccountMembers)
    .innerJoin(walletAccounts, eq(walletAccounts.id, walletAccountMembers.accountId))
    .where(and(eq(walletAccountMembers.walletUserId, user.id), eq(walletAccountMembers.accountId, input.accountId)))
    .limit(1);
  if (!membership[0]) throw new Error("You do not have access to this wallet account.");
  return { user, account: membership[0].account, role: membership[0].role };
}

function canManageSharedWallet(role: WalletAccountRole) {
  return role === "owner" || role === "admin";
}

async function requireSharedWalletManager(input: { identity: TelegramIdentity; accountId: number }) {
  const resolved = await resolveWalletAccount(input);
  if (resolved.account.type !== "shared") throw new Error("This action is only available for a shared wallet.");
  if (!canManageSharedWallet(resolved.role)) throw new Error("Only the owner or an admin can manage this shared wallet.");
  return resolved;
}

export async function getWalletAccounts(identity: TelegramIdentity) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { user } = await ensurePersonalAccount(identity);
  const rows = await db.select({ account: walletAccounts, role: walletAccountMembers.role })
    .from(walletAccountMembers)
    .innerJoin(walletAccounts, eq(walletAccounts.id, walletAccountMembers.accountId))
    .where(eq(walletAccountMembers.walletUserId, user.id))
    .orderBy(walletAccounts.createdAt, walletAccounts.id);
  return rows.map(row => ({ ...row.account, role: row.role }));
}

export async function createSharedWallet(input: { identity: TelegramIdentity; name: string; currency?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { user } = await ensurePersonalAccount(input.identity);
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("Choose a shared wallet name up to 100 characters.");
  const currency = (input.currency ?? "RUB").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter currency code.");
  await db.insert(walletAccounts).values({ ownerWalletUserId: user.id, name, type: "shared", currency });
  const account = await db.select().from(walletAccounts).where(and(eq(walletAccounts.ownerWalletUserId, user.id), eq(walletAccounts.name, name))).limit(1);
  if (!account[0]) throw new Error("Unable to create the shared wallet.");
  await db.insert(walletAccountMembers).values({ accountId: account[0].id, walletUserId: user.id, role: "owner" }).onDuplicateKeyUpdate({ set: { role: "owner" } });
  await seedSystemCategories(account[0].id);
  return { ...account[0], role: "owner" as const };
}

export async function getWalletAccountMembers(input: { identity: TelegramIdentity; accountId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account, role } = await resolveWalletAccount(input);
  if (account.type !== "shared") throw new Error("This wallet does not have shared members.");
  const rows = await db.select({ member: walletAccountMembers, user: walletUsers })
    .from(walletAccountMembers)
    .innerJoin(walletUsers, eq(walletUsers.id, walletAccountMembers.walletUserId))
    .where(eq(walletAccountMembers.accountId, account.id))
    .orderBy(walletAccountMembers.createdAt, walletAccountMembers.id);
  return { account, role, members: rows.map(row => ({ ...row.member, firstName: row.user.firstName, lastName: row.user.lastName, username: row.user.username })) };
}

export async function createWalletInvitation(input: { identity: TelegramIdentity; accountId: number; role: Exclude<WalletAccountRole, "owner">; expiresInHours?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { user, account, role: managerRole } = await requireSharedWalletManager(input);
  if (managerRole === "admin" && input.role !== "member") throw new Error("Only the owner can invite an admin.");
  const expiresInHours = input.expiresInHours ?? 72;
  if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 24 * 30) throw new Error("Invitation lifetime must be between 1 hour and 30 days.");
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  await db.insert(walletAccountInvitations).values({ accountId: account.id, token, role: input.role, createdByWalletUserId: user.id, expiresAt });
  return { token, role: input.role, expiresAt, accountName: account.name };
}

export async function revokeWalletInvitation(input: { identity: TelegramIdentity; accountId: number; invitationId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { user, account, role } = await requireSharedWalletManager(input);
  const invitation = await db.select().from(walletAccountInvitations).where(and(eq(walletAccountInvitations.id, input.invitationId), eq(walletAccountInvitations.accountId, account.id))).limit(1);
  if (!invitation[0]) throw new Error("Invitation was not found.");
  if (role === "admin" && invitation[0].createdByWalletUserId !== user.id) throw new Error("Admins can revoke only their own invitations.");
  await db.update(walletAccountInvitations).set({ revokedAt: new Date() }).where(eq(walletAccountInvitations.id, invitation[0].id));
}

export async function acceptWalletInvitation(input: { identity: TelegramIdentity; token: string }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { user } = await ensurePersonalAccount(input.identity);
  const token = input.token.trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Invitation link is invalid.");
  const invitation = await db.select().from(walletAccountInvitations).where(eq(walletAccountInvitations.token, token)).limit(1);
  if (!invitation[0]) throw new Error("Invitation link is invalid or has expired.");
  const invite = invitation[0];
  const now = new Date();
  if (invite.acceptedAt) {
    if (invite.acceptedByWalletUserId !== user.id) throw new Error("This invitation has already been used.");
  } else {
    if (invite.revokedAt || invite.expiresAt <= now) throw new Error("Invitation link is invalid or has expired.");
    const claimed = await db.update(walletAccountInvitations).set({ acceptedAt: now, acceptedByWalletUserId: user.id }).where(and(
      eq(walletAccountInvitations.id, invite.id),
      isNull(walletAccountInvitations.acceptedAt),
      isNull(walletAccountInvitations.revokedAt),
      gt(walletAccountInvitations.expiresAt, now),
    ));
    if ((claimed as { affectedRows?: number }).affectedRows === 0) {
      const current = await db.select().from(walletAccountInvitations).where(eq(walletAccountInvitations.id, invite.id)).limit(1);
      if (!current[0]?.acceptedAt || current[0].acceptedByWalletUserId !== user.id) throw new Error("This invitation has already been used or expired.");
    }
  }
  const account = await db.select().from(walletAccounts).where(eq(walletAccounts.id, invite.accountId)).limit(1);
  if (!account[0] || account[0].type !== "shared") throw new Error("The shared wallet is no longer available.");
  await db.insert(walletAccountMembers).values({ accountId: account[0].id, walletUserId: user.id, role: invite.role }).onDuplicateKeyUpdate({ set: { role: invite.role } });
  return { account: account[0], role: invite.role };
}

export async function updateWalletMemberRole(input: { identity: TelegramIdentity; accountId: number; memberId: number; role: Exclude<WalletAccountRole, "owner"> }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account, role: managerRole } = await requireSharedWalletManager(input);
  if (managerRole !== "owner") throw new Error("Only the owner can change member roles.");
  const member = await db.select().from(walletAccountMembers).where(and(eq(walletAccountMembers.accountId, account.id), eq(walletAccountMembers.id, input.memberId))).limit(1);
  if (!member[0] || member[0].role === "owner") throw new Error("The wallet owner role cannot be changed.");
  await db.update(walletAccountMembers).set({ role: input.role }).where(eq(walletAccountMembers.id, member[0].id));
}

export async function removeWalletMember(input: { identity: TelegramIdentity; accountId: number; memberId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account, role: managerRole } = await requireSharedWalletManager(input);
  const member = await db.select().from(walletAccountMembers).where(and(eq(walletAccountMembers.accountId, account.id), eq(walletAccountMembers.id, input.memberId))).limit(1);
  if (!member[0] || member[0].role === "owner") throw new Error("The wallet owner cannot be removed.");
  if (managerRole === "admin" && member[0].role !== "member") throw new Error("Admins can remove members only.");
  await db.delete(walletAccountMembers).where(eq(walletAccountMembers.id, member[0].id));
}

export async function setWalletLocale(identity: TelegramIdentity, locale: WalletLocale): Promise<WalletUser> {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const user = await ensureWalletUser(identity);
  await db.update(walletUsers).set({ locale, localeSelectedAt: new Date() }).where(eq(walletUsers.id, user.id));
  const updatedUser = await db.select().from(walletUsers).where(eq(walletUsers.id, user.id)).limit(1);
  if (!updatedUser[0]) throw new Error("Unable to update wallet language.");
  return updatedUser[0];
}

export async function getWalletLocale(identity: TelegramIdentity): Promise<WalletLocale | null> {
  const db = await getDb();
  if (!db) return null;
  const user = await db.select().from(walletUsers).where(eq(walletUsers.telegramId, identity.id)).limit(1);
  return user[0]?.locale ?? null;
}

async function resolveCategory(accountId: number, kind: TransactionKind, rawName: string): Promise<WalletCategory> {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const name = rawName.trim();
  if (!name) throw new Error("Category is required.");
  const found = await db.select().from(walletCategories).where(and(eq(walletCategories.accountId, accountId), eq(walletCategories.kind, kind), eq(walletCategories.name, name))).limit(1);
  if (found[0]?.archivedAt) {
    await db.update(walletCategories).set({ archivedAt: null }).where(eq(walletCategories.id, found[0].id));
    return { ...found[0], archivedAt: null };
  }
  if (found[0]) return found[0];
  await db.insert(walletCategories).values({ accountId, kind, name, icon: "•", color: "slate", isSystem: 0, sortOrder: 1000 });
  const created = await db.select().from(walletCategories).where(and(eq(walletCategories.accountId, accountId), eq(walletCategories.kind, kind), eq(walletCategories.name, name))).limit(1);
  if (!created[0]) throw new Error("Unable to create category.");
  return created[0];
}

export async function addWalletTransaction(input: {
  identity: TelegramIdentity;
  kind: TransactionKind;
  amount: string;
  category: string;
  description?: string | null;
  occurredAt?: Date;
  source?: TransactionSource;
  idempotencyKey?: string;
  accountId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { user, account } = await resolveWalletAccount(input);
  const amountCents = amountToCents(input.amount);
  const idempotencyKey = input.idempotencyKey?.trim() || crypto.randomUUID();
  if (idempotencyKey.length > 128) throw new Error("Idempotency key is too long.");
  if (input.idempotencyKey) {
    const existing = await db.select().from(transactions).where(and(eq(transactions.accountId, account.id), eq(transactions.idempotencyKey, idempotencyKey))).limit(1);
    if (existing[0]) return { amountCents: existing[0].amountCents, transaction: existing[0], duplicate: true };
  }
  const category = await resolveCategory(account.id, input.kind, input.category);
  await db.insert(transactions).values({
    walletUserId: user.id,
    accountId: account.id,
    categoryId: category.id,
    kind: input.kind,
    amountCents,
    category: category.name,
    description: input.description?.trim() || null,
    source: input.source ?? "manual",
    idempotencyKey,
    occurredAt: input.occurredAt ?? new Date(),
  }).onDuplicateKeyUpdate({ set: { idempotencyKey: sql`${transactions.idempotencyKey}` } });
  const created = await db.select().from(transactions).where(and(eq(transactions.accountId, account.id), eq(transactions.idempotencyKey, idempotencyKey))).orderBy(desc(transactions.id)).limit(1);
  if (!created[0]) throw new Error("Unable to create transaction.");
  return { amountCents, transaction: created[0], duplicate: false };
}

const centsToAmount = (amountCents: number) => (amountCents / 100).toFixed(2);

export async function createWalletDraft(input: {
  identity: TelegramIdentity;
  kind: TransactionKind;
  amountCents: number;
  category: string;
  description?: string | null;
  rawText: string;
  source?: Extract<TransactionSource, "text" | "voice" | "receipt">;
  confidence?: number;
  telegramChatId?: string;
  accountId?: number;
}): Promise<WalletDraft> {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Draft amount is invalid.");
  const { user, account } = await resolveWalletAccount(input);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.insert(walletDrafts).values({ id, walletUserId: user.id, accountId: account.id, telegramChatId: input.telegramChatId ?? null, kind: input.kind, amountCents: input.amountCents, category: input.category.trim().slice(0, 80), description: input.description?.trim().slice(0, 280) || null, rawText: input.rawText.slice(0, 1000), source: input.source ?? "text", confidence: Math.min(100, Math.max(0, Math.round(input.confidence ?? 0))), expiresAt });
  const created = await db.select().from(walletDrafts).where(eq(walletDrafts.id, id)).limit(1);
  if (!created[0]) throw new Error("Unable to create transaction draft.");
  return created[0];
}

export async function confirmWalletDraft(input: { identity: TelegramIdentity; draftId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const user = await ensureWalletUser(input.identity);
  const drafts = await db.select().from(walletDrafts).where(and(eq(walletDrafts.id, input.draftId), eq(walletDrafts.walletUserId, user.id))).limit(1);
  const draft = drafts[0];
  if (!draft) throw new Error("Draft was not found.");
  if (draft.expiresAt < new Date()) {
    await db.update(walletDrafts).set({ status: "expired" }).where(eq(walletDrafts.id, draft.id));
    throw new Error("Draft has expired.");
  }
  if (draft.status === "cancelled" || draft.status === "expired") throw new Error("Draft is no longer available.");
  const saved = await addWalletTransaction({ identity: input.identity, accountId: draft.accountId, kind: draft.kind, amount: centsToAmount(draft.amountCents), category: draft.category, description: draft.description, source: draft.source, idempotencyKey: `draft:${draft.id}` });
  if (draft.status === "pending") await db.update(walletDrafts).set({ status: "confirmed" }).where(eq(walletDrafts.id, draft.id));
  return saved;
}

export async function cancelWalletDraft(input: { identity: TelegramIdentity; draftId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const user = await ensureWalletUser(input.identity);
  await db.update(walletDrafts).set({ status: "cancelled" }).where(and(eq(walletDrafts.id, input.draftId), eq(walletDrafts.walletUserId, user.id), eq(walletDrafts.status, "pending")));
}

export async function updateWalletTransaction(input: {
  identity: TelegramIdentity;
  transactionId: number;
  accountId?: number;
  kind: TransactionKind;
  amount: string;
  category: string;
  description?: string | null;
  occurredAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account } = await resolveWalletAccount(input);
  const existing = await db.select().from(transactions).where(and(eq(transactions.id, input.transactionId), eq(transactions.accountId, account.id), isNull(transactions.deletedAt))).limit(1);
  if (!existing[0]) throw new Error("Transaction was not found in this wallet account.");
  const category = await resolveCategory(account.id, input.kind, input.category);
  const amountCents = amountToCents(input.amount);
  await db.update(transactions).set({
    kind: input.kind,
    amountCents,
    categoryId: category.id,
    category: category.name,
    description: input.description?.trim() || null,
    occurredAt: input.occurredAt ?? existing[0].occurredAt,
  }).where(eq(transactions.id, existing[0].id));
  const updated = await db.select().from(transactions).where(eq(transactions.id, existing[0].id)).limit(1);
  if (!updated[0]) throw new Error("Unable to update transaction.");
  return { amountCents, transaction: updated[0] };
}

export async function getWalletCategories(identity: TelegramIdentity, kind?: TransactionKind, accountId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account } = await resolveWalletAccount({ identity, accountId });
  const conditions = [eq(walletCategories.accountId, account.id), isNull(walletCategories.archivedAt)];
  if (kind) conditions.push(eq(walletCategories.kind, kind));
  return db.select().from(walletCategories).where(and(...conditions)).orderBy(walletCategories.sortOrder, walletCategories.name);
}

export async function archiveWalletCategory(input: { identity: TelegramIdentity; categoryId: number; accountId?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account } = await resolveWalletAccount(input);
  const category = await db.select().from(walletCategories).where(and(eq(walletCategories.id, input.categoryId), eq(walletCategories.accountId, account.id), isNull(walletCategories.archivedAt))).limit(1);
  if (!category[0]) throw new Error("Category was not found in this wallet account.");
  await db.update(walletCategories).set({ archivedAt: new Date() }).where(eq(walletCategories.id, category[0].id));
  return { category: category[0] };
}

export async function mergeWalletCategories(input: { identity: TelegramIdentity; sourceCategoryId: number; targetCategoryId: number; accountId?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  if (input.sourceCategoryId === input.targetCategoryId) throw new Error("Choose two different categories to merge.");
  const { account } = await resolveWalletAccount(input);
  const categories = await db.select().from(walletCategories).where(and(eq(walletCategories.accountId, account.id), isNull(walletCategories.archivedAt)));
  const source = categories.find(category => category.id === input.sourceCategoryId);
  const target = categories.find(category => category.id === input.targetCategoryId);
  if (!source || !target || source.kind !== target.kind) throw new Error("Categories must belong to this account and have the same type.");
  await db.update(transactions).set({ categoryId: target.id, category: target.name }).where(and(eq(transactions.accountId, account.id), eq(transactions.categoryId, source.id)));
  await db.update(walletCategories).set({ archivedAt: new Date() }).where(eq(walletCategories.id, source.id));
  return { sourceCategoryId: source.id, targetCategoryId: target.id, movedTo: target.name };
}

export async function getWalletTransactions(input: { identity: TelegramIdentity; accountId?: number; kind?: TransactionKind; from?: Date; to?: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account } = await resolveWalletAccount(input);
  const conditions = [eq(transactions.accountId, account.id), isNull(transactions.deletedAt), eq(transactions.status, "confirmed")];
  if (input.kind) conditions.push(eq(transactions.kind, input.kind));
  if (input.from) conditions.push(gte(transactions.occurredAt, input.from));
  if (input.to) conditions.push(lte(transactions.occurredAt, input.to));
  return db.select().from(transactions).where(and(...conditions)).orderBy(desc(transactions.occurredAt), desc(transactions.id));
}

export async function softDeleteWalletTransaction(input: { identity: TelegramIdentity; transactionId: number; accountId?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account } = await resolveWalletAccount(input);
  const existing = await db.select().from(transactions).where(and(eq(transactions.id, input.transactionId), eq(transactions.accountId, account.id), isNull(transactions.deletedAt))).limit(1);
  if (!existing[0]) throw new Error("Transaction was not found in this wallet account.");
  await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, existing[0].id));
  return { transaction: existing[0] };
}

export async function restoreWalletTransaction(input: { identity: TelegramIdentity; transactionId: number; accountId?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account } = await resolveWalletAccount(input);
  const existing = await db.select().from(transactions).where(and(eq(transactions.id, input.transactionId), eq(transactions.accountId, account.id), isNull(transactions.deletedAt))).limit(1);
  if (existing[0]) throw new Error("Transaction is already active in this wallet account.");
  const deleted = await db.select().from(transactions).where(and(eq(transactions.id, input.transactionId), eq(transactions.accountId, account.id))).limit(1);
  if (!deleted[0]) throw new Error("Transaction was not found in this wallet account.");
  await db.update(transactions).set({ deletedAt: null }).where(eq(transactions.id, deleted[0].id));
  return { transaction: deleted[0] };
}

export async function getWalletDashboard(identity: TelegramIdentity, accountId?: number) {
  const { user, account } = await resolveWalletAccount({ identity, accountId });
  const allTransactions = await getWalletTransactions({ identity, accountId: account.id });
  return { user, account, summary: toWalletSummary(allTransactions), transactions: allTransactions.slice(0, 8) };
}

export const analyticsPeriods = ["week", "month", "year", "custom"] as const;
export type AnalyticsPeriod = (typeof analyticsPeriods)[number];

export type WalletAnalyticsInput = {
  identity: TelegramIdentity;
  accountId?: number;
  period: AnalyticsPeriod;
  from?: string;
  to?: string;
  now?: Date;
};

type ZonedDateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function isSupportedWalletTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function getZonedDateParts(value: Date, timezone: string): ZonedDateParts {
  const safeTimezone = isSupportedWalletTimezone(timezone) ? timezone : "UTC";
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(values.find(part => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

function timezoneOffsetMs(value: Date, timezone: string) {
  const local = getZonedDateParts(value, timezone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - value.getTime();
}

/** Converts a wall-clock time in an IANA timezone to the corresponding UTC instant. */
export function zonedDateTimeToUtc(parts: Omit<ZonedDateParts, "minute" | "second"> & Partial<Pick<ZonedDateParts, "minute" | "second">>, timezone: string) {
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;
  let instant = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, minute, second);
  const firstOffset = timezoneOffsetMs(new Date(instant), timezone);
  instant -= firstOffset;
  const correctedOffset = timezoneOffsetMs(new Date(instant), timezone);
  if (correctedOffset !== firstOffset) instant -= correctedOffset - firstOffset;
  return new Date(instant);
}

function addLocalDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), hour: 0, minute: 0, second: 0 };
}

function monthStart(parts: ZonedDateParts): ZonedDateParts {
  return { ...parts, day: 1, hour: 0, minute: 0, second: 0 };
}

function addLocalMonths(parts: ZonedDateParts, months: number): ZonedDateParts {
  const base = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: 1, hour: 0, minute: 0, second: 0 };
}

function parseLocalDate(value: string | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
    ? { year, month, day, hour: 0, minute: 0, second: 0 }
    : null;
}

export function getWalletAnalyticsRange(input: Pick<WalletAnalyticsInput, "period" | "from" | "to">, timezone: string, now = new Date()) {
  const localNow = getZonedDateParts(now, timezone);
  const today = { ...localNow, hour: 0, minute: 0, second: 0 };
  if (input.period === "custom") {
    const from = parseLocalDate(input.from);
    const to = parseLocalDate(input.to);
    if (!from || !to || Date.UTC(from.year, from.month - 1, from.day) > Date.UTC(to.year, to.month - 1, to.day)) throw new Error("Choose a valid custom period.");
    return { start: zonedDateTimeToUtc(from, timezone), endExclusive: zonedDateTimeToUtc(addLocalDays(to, 1), timezone), timezone };
  }
  if (input.period === "week") {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const start = addLocalDays(today, mondayOffset);
    return { start: zonedDateTimeToUtc(start, timezone), endExclusive: zonedDateTimeToUtc(addLocalDays(start, 7), timezone), timezone };
  }
  if (input.period === "year") {
    const start = { ...today, month: 1, day: 1 };
    return { start: zonedDateTimeToUtc(start, timezone), endExclusive: zonedDateTimeToUtc({ ...start, year: start.year + 1 }, timezone), timezone };
  }
  const start = monthStart(today);
  return { start: zonedDateTimeToUtc(start, timezone), endExclusive: zonedDateTimeToUtc(addLocalMonths(start, 1), timezone), timezone };
}

function localDayKey(value: Date, timezone: string) {
  const parts = getZonedDateParts(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localMonthKey(value: Date, timezone: string) {
  const parts = getZonedDateParts(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

export async function getWalletAnalytics(input: WalletAnalyticsInput) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { user, account } = await resolveWalletAccount(input);
  const timezone = isSupportedWalletTimezone(user.timezone) ? user.timezone : "UTC";
  const range = getWalletAnalyticsRange(input, timezone, input.now);
  const periodTransactions = await db.select().from(transactions).where(and(
    eq(transactions.accountId, account.id),
    isNull(transactions.deletedAt),
    eq(transactions.status, "confirmed"),
    gte(transactions.occurredAt, range.start),
    lt(transactions.occurredAt, range.endExclusive),
  )).orderBy(transactions.occurredAt, transactions.id);

  let incomeCents = 0;
  let expenseCents = 0;
  const categoryTotals = new Map<string, number>();
  const trends = new Map<string, { incomeCents: number; expenseCents: number }>();
  for (const transaction of periodTransactions) {
    const key = input.period === "year" ? localMonthKey(transaction.occurredAt, timezone) : localDayKey(transaction.occurredAt, timezone);
    const trend = trends.get(key) ?? { incomeCents: 0, expenseCents: 0 };
    if (transaction.kind === "income") {
      incomeCents += transaction.amountCents;
      trend.incomeCents += transaction.amountCents;
    } else {
      expenseCents += transaction.amountCents;
      trend.expenseCents += transaction.amountCents;
      categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + transaction.amountCents);
    }
    trends.set(key, trend);
  }

  const currentMonthRange = getWalletAnalyticsRange({ period: "month" }, timezone, input.now);
  const monthExpenses = await db.select().from(transactions).where(and(
    eq(transactions.accountId, account.id),
    isNull(transactions.deletedAt),
    eq(transactions.status, "confirmed"),
    eq(transactions.kind, "expense"),
    gte(transactions.occurredAt, currentMonthRange.start),
    lt(transactions.occurredAt, currentMonthRange.endExclusive),
  ));
  const monthlyActualByCategory = new Map<number, number>();
  for (const transaction of monthExpenses) {
    if (transaction.categoryId) monthlyActualByCategory.set(transaction.categoryId, (monthlyActualByCategory.get(transaction.categoryId) ?? 0) + transaction.amountCents);
  }
  const [budgets, categories] = await Promise.all([
    db.select().from(walletBudgets).where(eq(walletBudgets.accountId, account.id)),
    db.select().from(walletCategories).where(eq(walletCategories.accountId, account.id)),
  ]);
  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  const budgetStatus = budgets.map(budget => ({
    id: budget.id,
    categoryId: budget.categoryId,
    category: categoryNames.get(budget.categoryId) ?? "Archived category",
    budgetCents: budget.amountCents,
    actualCents: monthlyActualByCategory.get(budget.categoryId) ?? 0,
    remainingCents: budget.amountCents - (monthlyActualByCategory.get(budget.categoryId) ?? 0),
  })).sort((a, b) => b.actualCents - a.actualCents);

  return {
    account,
    timezone,
    range,
    period: input.period,
    summary: {
      incomeCents,
      expenseCents,
      netCents: incomeCents - expenseCents,
      savingsRate: incomeCents > 0 ? Math.round(((incomeCents - expenseCents) / incomeCents) * 100) : null,
      transactionCount: periodTransactions.length,
    },
    trend: Array.from(trends.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, totals]) => ({ key, ...totals })),
    expensesByCategory: Array.from(categoryTotals.entries()).sort(([, a], [, b]) => b - a).slice(0, 8).map(([category, amountCents]) => ({ category, amountCents })),
    budgetStatus,
    budgetRange: currentMonthRange,
  };
}

export async function getWalletBudgets(identity: TelegramIdentity, accountId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account } = await resolveWalletAccount({ identity, accountId });
  const [budgets, categories] = await Promise.all([
    db.select().from(walletBudgets).where(eq(walletBudgets.accountId, account.id)),
    db.select().from(walletCategories).where(and(eq(walletCategories.accountId, account.id), eq(walletCategories.kind, "expense"))),
  ]);
  const names = new Map(categories.map(category => [category.id, category.name]));
  return budgets.map(budget => ({ ...budget, category: names.get(budget.categoryId) ?? "Archived category" }));
}

export async function setWalletBudget(input: { identity: TelegramIdentity; accountId?: number; categoryId: number; amount: string }) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const { account, role } = await resolveWalletAccount(input);
  if (role === "member") throw new Error("Only account owners and admins can set budgets.");
  const category = await db.select().from(walletCategories).where(and(eq(walletCategories.id, input.categoryId), eq(walletCategories.accountId, account.id), eq(walletCategories.kind, "expense"), isNull(walletCategories.archivedAt))).limit(1);
  if (!category[0]) throw new Error("Choose an active expense category in this wallet.");
  const amountCents = amountToCents(input.amount);
  await db.insert(walletBudgets).values({ accountId: account.id, categoryId: category[0].id, amountCents }).onDuplicateKeyUpdate({ set: { amountCents } });
  const saved = await db.select().from(walletBudgets).where(and(eq(walletBudgets.accountId, account.id), eq(walletBudgets.categoryId, category[0].id), eq(walletBudgets.period, "monthly"))).limit(1);
  if (!saved[0]) throw new Error("Unable to save budget.");
  return { ...saved[0], category: category[0].name };
}
