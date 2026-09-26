import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { telegramUserFromRequest } from "./telegramAuth";
import { telegramStartDeepLink } from "./telegramBot";
import { acceptWalletInvitation, addWalletTransaction, archiveWalletCategory, cancelWalletDraft, confirmWalletDraft, createSharedWallet, createWalletDraft, createWalletInvitation, getWalletAccountMembers, getWalletAccounts, getWalletAnalytics, getWalletBudgets, getWalletCategories, getWalletDashboard, getWalletTransactions, mergeWalletCategories, removeWalletMember, restoreWalletTransaction, revokeWalletInvitation, setWalletBudget, setWalletLocale, softDeleteWalletTransaction, updateWalletMemberRole, updateWalletTransaction } from "./wallet";
import { interpretTransactionText } from "./transactionNlp";
import { interpretReceiptDataUrl } from "./telegramMedia";
import { getWalletScheduleSettings, updateWalletScheduleSettings } from "./walletSchedule";

const telegramProcedure = publicProcedure.use(({ ctx, next }) => {
  try {
    return next({ ctx: { ...ctx, telegramUser: telegramUserFromRequest(ctx.req) } });
  } catch (cause) {
    if (cause instanceof TRPCError) throw cause;
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Telegram authorization failed." });
  }
});

export const transactionInput = z.object({
  kind: z.enum(["income", "expense"]),
  amount: z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/, "Enter a valid amount with up to two decimals."),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  occurredAt: z.date().optional(),
  accountId: z.number().int().positive().optional(),
  source: z.enum(["manual", "command", "text", "voice", "receipt"]).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

const accountInput = z.object({ accountId: z.number().int().positive().optional() });
const transactionIdInput = accountInput.extend({ transactionId: z.number().int().positive() });
export const walletAnalyticsInput = accountInput.extend({
  period: z.enum(["week", "month", "year", "custom"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).superRefine((value, ctx) => {
  if (value.period === "custom" && (!value.from || !value.to)) ctx.addIssue({ code: "custom", message: "Custom analytics needs a start and end date." });
});
export const walletScheduleSettingsInput = z.object({
  timezone: z.string().trim().min(1).max(64),
  reminderEnabled: z.boolean(),
  reminderHour: z.number().int().min(0).max(23),
  reportFrequency: z.enum(["off", "weekly", "monthly"]),
});
export const walletBudgetInput = accountInput.extend({
  categoryId: z.number().int().positive(),
  amount: z.string().trim().regex(/^\d+(?:[.,]\d{1,2})?$/, "Enter a valid monthly limit with up to two decimals."),
});
export const sharedWalletInput = z.object({
  name: z.string().trim().min(1).max(100),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).default("RUB"),
});
export const walletInvitationInput = z.object({
  accountId: z.number().int().positive(),
  role: z.enum(["admin", "member"]),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
});
export const walletMemberInput = z.object({ accountId: z.number().int().positive(), memberId: z.number().int().positive() });
export const walletMemberRoleInput = walletMemberInput.extend({ role: z.enum(["admin", "member"]) });
export const walletInvitationTokenInput = z.object({ token: z.string().trim().uuid() });

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  wallet: router({
    accounts: telegramProcedure.query(({ ctx }) => getWalletAccounts(ctx.telegramUser)),
    createSharedAccount: telegramProcedure.input(sharedWalletInput).mutation(({ ctx, input }) => createSharedWallet({ identity: ctx.telegramUser, ...input })),
    accountMembers: telegramProcedure.input(z.object({ accountId: z.number().int().positive() })).query(({ ctx, input }) => getWalletAccountMembers({ identity: ctx.telegramUser, ...input })),
    createInvitation: telegramProcedure.input(walletInvitationInput).mutation(async ({ ctx, input }) => {
      const invitation = await createWalletInvitation({ identity: ctx.telegramUser, ...input });
      return { ...invitation, deepLink: await telegramStartDeepLink(`invite_${invitation.token}`) };
    }),
    revokeInvitation: telegramProcedure.input(walletMemberInput.extend({ invitationId: z.number().int().positive() })).mutation(({ ctx, input }) => revokeWalletInvitation({ identity: ctx.telegramUser, ...input })),
    updateMemberRole: telegramProcedure.input(walletMemberRoleInput).mutation(({ ctx, input }) => updateWalletMemberRole({ identity: ctx.telegramUser, ...input })),
    removeMember: telegramProcedure.input(walletMemberInput).mutation(({ ctx, input }) => removeWalletMember({ identity: ctx.telegramUser, ...input })),
    acceptInvitation: telegramProcedure.input(walletInvitationTokenInput).mutation(({ ctx, input }) => acceptWalletInvitation({ identity: ctx.telegramUser, ...input })),
    dashboard: telegramProcedure.input(accountInput).query(({ ctx, input }) => getWalletDashboard(ctx.telegramUser, input.accountId)),
    analytics: telegramProcedure.input(walletAnalyticsInput).query(({ ctx, input }) => getWalletAnalytics({ identity: ctx.telegramUser, ...input })),
    budgets: telegramProcedure.input(accountInput).query(({ ctx, input }) => getWalletBudgets(ctx.telegramUser, input.accountId)),
    setBudget: telegramProcedure.input(walletBudgetInput).mutation(({ ctx, input }) => setWalletBudget({ identity: ctx.telegramUser, ...input })),
    transactions: telegramProcedure.input(accountInput.extend({
      kind: z.enum(["income", "expense"]).optional(),
      from: z.date().optional(),
      to: z.date().optional(),
    })).query(({ ctx, input }) => getWalletTransactions({ identity: ctx.telegramUser, ...input })),
    add: telegramProcedure.input(transactionInput).mutation(({ ctx, input }) =>
      addWalletTransaction({ identity: ctx.telegramUser, ...input })
    ),
    update: telegramProcedure.input(transactionInput.extend({ transactionId: z.number().int().positive() })).mutation(({ ctx, input }) =>
      updateWalletTransaction({ identity: ctx.telegramUser, ...input })
    ),
    remove: telegramProcedure.input(transactionIdInput).mutation(({ ctx, input }) =>
      softDeleteWalletTransaction({ identity: ctx.telegramUser, ...input })
    ),
    restore: telegramProcedure.input(transactionIdInput).mutation(({ ctx, input }) =>
      restoreWalletTransaction({ identity: ctx.telegramUser, ...input })
    ),
    categories: telegramProcedure.input(accountInput.extend({ kind: z.enum(["income", "expense"]).optional() })).query(({ ctx, input }) =>
      getWalletCategories(ctx.telegramUser, input.kind, input.accountId)
    ),
    archiveCategory: telegramProcedure.input(accountInput.extend({ categoryId: z.number().int().positive() })).mutation(({ ctx, input }) =>
      archiveWalletCategory({ identity: ctx.telegramUser, ...input })
    ),
    mergeCategories: telegramProcedure.input(accountInput.extend({ sourceCategoryId: z.number().int().positive(), targetCategoryId: z.number().int().positive() })).mutation(({ ctx, input }) =>
      mergeWalletCategories({ identity: ctx.telegramUser, ...input })
    ),
    previewText: telegramProcedure.input(accountInput.extend({ text: z.string().trim().min(1).max(280) })).mutation(async ({ ctx, input }) => {
      const categories = await getWalletCategories(ctx.telegramUser, undefined, input.accountId);
      const preview = await interpretTransactionText(input.text, categories.map(category => category.name));
      if (!preview) throw new TRPCError({ code: "BAD_REQUEST", message: "Could not recognize an amount. Please enter it manually." });
      const draft = await createWalletDraft({ identity: ctx.telegramUser, accountId: input.accountId, kind: preview.kind, amountCents: preview.amountCents, category: preview.category, description: preview.description, rawText: input.text, confidence: preview.confidence, source: "text" });
      return { draftId: draft.id, preview };
    }),
    previewReceipt: telegramProcedure.input(accountInput.extend({ imageDataUrl: z.string().max(12 * 1024 * 1024) })).mutation(async ({ ctx, input }) => {
      const categories = await getWalletCategories(ctx.telegramUser, undefined, input.accountId);
      const preview = await interpretReceiptDataUrl(input.imageDataUrl, categories.map(category => category.name));
      if (!preview || preview.confidence < 60) throw new TRPCError({ code: "BAD_REQUEST", message: "Could not read the receipt safely. Please enter it manually." });
      const draft = await createWalletDraft({ identity: ctx.telegramUser, accountId: input.accountId, kind: preview.kind, amountCents: preview.amountCents, category: preview.category, description: preview.description, rawText: preview.rawText, confidence: preview.confidence, source: "receipt" });
      return { draftId: draft.id, preview };
    }),
    confirmDraft: telegramProcedure.input(z.object({ draftId: z.string().uuid() })).mutation(({ ctx, input }) =>
      confirmWalletDraft({ identity: ctx.telegramUser, draftId: input.draftId })
    ),
    cancelDraft: telegramProcedure.input(z.object({ draftId: z.string().uuid() })).mutation(({ ctx, input }) =>
      cancelWalletDraft({ identity: ctx.telegramUser, draftId: input.draftId })
    ),
    settings: router({
      setLocale: telegramProcedure.input(z.object({ locale: z.enum(["ru", "en"]) })).mutation(({ ctx, input }) =>
        setWalletLocale(ctx.telegramUser, input.locale)
      ),
      schedule: telegramProcedure.query(({ ctx }) => getWalletScheduleSettings(ctx.telegramUser)),
      updateSchedule: telegramProcedure.input(walletScheduleSettingsInput).mutation(({ ctx, input }) =>
        updateWalletScheduleSettings({ identity: ctx.telegramUser, ...input })
      ),
    }),
  }),
});

export type AppRouter = typeof appRouter;
