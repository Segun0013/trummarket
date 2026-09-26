import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { walletScheduledDeliveries, walletUsers, type WalletUser } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { createHeartbeatJob, deleteHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { botCopy, type WalletLocale } from "./i18n";
import { sendTelegramMessage, walletButton } from "./telegramBot";
import type { TelegramIdentity } from "./telegramAuth";
import { ensureWalletUser, getWalletAnalytics, getZonedDateParts, isSupportedWalletTimezone } from "./wallet";
import { logWalletEvent } from "./walletTelemetry";

type ScheduleKind = "reminder" | "report";

function toIdentity(user: WalletUser) {
  return { id: user.telegramId, username: user.username ?? undefined, firstName: user.firstName, lastName: user.lastName ?? undefined };
}

function money(cents: number, locale: WalletLocale) {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(cents / 100);
}

function timezoneFor(user: WalletUser) {
  return isSupportedWalletTimezone(user.timezone) ? user.timezone : "UTC";
}

function dateKey(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export async function claimScheduledDelivery(taskUid: string, walletUserId: number, kind: ScheduleKind, periodKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const found = await db.select({ id: walletScheduledDeliveries.id }).from(walletScheduledDeliveries).where(and(
    eq(walletScheduledDeliveries.taskUid, taskUid),
    eq(walletScheduledDeliveries.walletUserId, walletUserId),
    eq(walletScheduledDeliveries.kind, kind),
    eq(walletScheduledDeliveries.periodKey, periodKey),
  )).limit(1);
  if (found[0]) return false;
  try {
    await db.insert(walletScheduledDeliveries).values({ taskUid, walletUserId, kind, periodKey });
    return true;
  } catch (error) {
    if (String(error).toLowerCase().includes("duplicate")) return false;
    throw error;
  }
}

async function releaseDelivery(taskUid: string, walletUserId: number, kind: ScheduleKind, periodKey: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(walletScheduledDeliveries).where(and(
    eq(walletScheduledDeliveries.taskUid, taskUid),
    eq(walletScheduledDeliveries.walletUserId, walletUserId),
    eq(walletScheduledDeliveries.kind, kind),
    eq(walletScheduledDeliveries.periodKey, periodKey),
  ));
}

function isHourlyMoment(user: WalletUser, now: Date) {
  const parts = getZonedDateParts(now, timezoneFor(user));
  return parts.hour === user.reminderHour && parts.minute === 0;
}

async function sendReminder(user: WalletUser, taskUid: string, now: Date) {
  if (!user.reminderEnabled || !isHourlyMoment(user, now)) return "not-due" as const;
  const timezone = timezoneFor(user);
  const local = getZonedDateParts(now, timezone);
  const periodKey = dateKey(local);
  if (!await claimScheduledDelivery(taskUid, user.id, "reminder", periodKey)) return "duplicate" as const;
  try {
    const analytics = await getWalletAnalytics({ identity: toIdentity(user), period: "custom", from: periodKey, to: periodKey, now });
    const locale: WalletLocale = user.locale;
    const copy = botCopy(locale);
    await sendTelegramMessage(user.telegramId, copy.reminder(money(analytics.summary.expenseCents, locale), money(analytics.summary.incomeCents, locale)), walletButton(locale));
    return "sent" as const;
  } catch (error) {
    await releaseDelivery(taskUid, user.id, "reminder", periodKey);
    throw error;
  }
}

function reportWindow(user: WalletUser, now: Date) {
  const local = getZonedDateParts(now, timezoneFor(user));
  if (local.minute !== 0 || local.hour !== user.reminderHour) return null;
  if (user.reportFrequency === "weekly") {
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    if (weekday !== 1) return null;
    const lastMonday = new Date(Date.UTC(local.year, local.month - 1, local.day - 7));
    const from = dateKey({ year: lastMonday.getUTCFullYear(), month: lastMonday.getUTCMonth() + 1, day: lastMonday.getUTCDate() });
    const lastSunday = new Date(Date.UTC(local.year, local.month - 1, local.day - 1));
    return { from, to: dateKey({ year: lastSunday.getUTCFullYear(), month: lastSunday.getUTCMonth() + 1, day: lastSunday.getUTCDate() }), label: user.locale === "ru" ? "неделю" : "the week" };
  }
  if (user.reportFrequency === "monthly" && local.day === 1) {
    const previousMonth = new Date(Date.UTC(local.year, local.month - 2, 1));
    const from = dateKey({ year: previousMonth.getUTCFullYear(), month: previousMonth.getUTCMonth() + 1, day: 1 });
    const lastDay = new Date(Date.UTC(local.year, local.month - 1, 0));
    return { from, to: dateKey({ year: lastDay.getUTCFullYear(), month: lastDay.getUTCMonth() + 1, day: lastDay.getUTCDate() }), label: user.locale === "ru" ? "месяц" : "the month" };
  }
  return null;
}

async function sendReport(user: WalletUser, taskUid: string, now: Date) {
  const window = reportWindow(user, now);
  if (!window) return "not-due" as const;
  const periodKey = `${user.reportFrequency}:${window.from}:${window.to}`;
  if (!await claimScheduledDelivery(taskUid, user.id, "report", periodKey)) return "duplicate" as const;
  try {
    const analytics = await getWalletAnalytics({ identity: toIdentity(user), period: "custom", from: window.from, to: window.to, now });
    const locale: WalletLocale = user.locale;
    const copy = botCopy(locale);
    await sendTelegramMessage(user.telegramId, copy.report(window.label, money(analytics.summary.incomeCents, locale), money(analytics.summary.expenseCents, locale), money(analytics.summary.netCents, locale), analytics.summary.savingsRate), walletButton(locale));
    return "sent" as const;
  } catch (error) {
    await releaseDelivery(taskUid, user.id, "report", periodKey);
    throw error;
  }
}

async function cronUser(req: Request) {
  const authenticated = await sdk.authenticateRequest(req);
  if (!authenticated.isCron || !authenticated.taskUid) throw new Error("cron-only");
  return authenticated.taskUid;
}

export async function handleWalletReminderSchedule(req: Request, res: Response) {
  let taskUid: string | undefined;
  try {
    taskUid = await cronUser(req);
    const db = await getDb();
    if (!db) throw new Error("Wallet database is unavailable.");
    const user = (await db.select().from(walletUsers).where(eq(walletUsers.reminderCronTaskUid, taskUid)).limit(1))[0];
    if (!user) { logWalletEvent("scheduled_delivery_processed", { kind: "reminder", outcome: "orphan" }); return res.json({ ok: true, skipped: "orphan" }); }
    const outcome = await sendReminder(user, taskUid, new Date());
    logWalletEvent("scheduled_delivery_processed", { kind: "reminder", outcome });
    return res.json({ ok: true, outcome });
  } catch (error) {
    logWalletEvent("scheduled_delivery_failed", { kind: "reminder" });
    console.error("[WalletSchedule] Reminder failed", error);
    return res.status(500).json({ error: String(error), context: { path: req.path, taskUid }, timestamp: new Date().toISOString() });
  }
}

export async function handleWalletReportSchedule(req: Request, res: Response) {
  let taskUid: string | undefined;
  try {
    taskUid = await cronUser(req);
    const db = await getDb();
    if (!db) throw new Error("Wallet database is unavailable.");
    const user = (await db.select().from(walletUsers).where(eq(walletUsers.reportCronTaskUid, taskUid)).limit(1))[0];
    if (!user) { logWalletEvent("scheduled_delivery_processed", { kind: "report", outcome: "orphan" }); return res.json({ ok: true, skipped: "orphan" }); }
    const outcome = await sendReport(user, taskUid, new Date());
    logWalletEvent("scheduled_delivery_processed", { kind: "report", outcome });
    return res.json({ ok: true, outcome });
  } catch (error) {
    logWalletEvent("scheduled_delivery_failed", { kind: "report" });
    console.error("[WalletSchedule] Report failed", error);
    return res.status(500).json({ error: String(error), context: { path: req.path, taskUid }, timestamp: new Date().toISOString() });
  }
}

/** A fifteen-minute UTC cadence lets the handler honour local hour boundaries in IANA zones and across DST. */
export const WALLET_SCHEDULE_CRON = "0 */15 * * * *";

export function walletReminderJob(user: WalletUser) {
  return { name: `wallet-reminder-${user.id}`, cron: WALLET_SCHEDULE_CRON, path: "/api/scheduled/wallet-reminder", description: "Wallet daily reminder, guarded by the user's IANA timezone" } as const;
}

export function walletReportJob(user: WalletUser) {
  return { name: `wallet-report-${user.id}`, cron: WALLET_SCHEDULE_CRON, path: "/api/scheduled/wallet-report", description: "Wallet weekly or monthly report, guarded by the user's IANA timezone" } as const;
}

export type WalletScheduleSettingsInput = {
  identity: TelegramIdentity;
  timezone: string;
  reminderEnabled: boolean;
  reminderHour: number;
  reportFrequency: "off" | "weekly" | "monthly";
};

/** Return settings intended for the Mini App; task UIDs remain server-only. */
export async function getWalletScheduleSettings(identity: TelegramIdentity) {
  const user = await ensureWalletUser(identity);
  return {
    timezone: timezoneFor(user),
    reminderEnabled: Boolean(user.reminderEnabled),
    reminderHour: user.reminderHour,
    reportFrequency: user.reportFrequency,
  };
}

async function configureReminderJob(user: WalletUser, enabled: boolean) {
  if (!enabled) {
    if (user.reminderCronTaskUid) await deleteHeartbeatJob(user.reminderCronTaskUid, "");
    return null;
  }
  const job = walletReminderJob(user);
  if (user.reminderCronTaskUid) {
    await updateHeartbeatJob(user.reminderCronTaskUid, { cron: job.cron, path: job.path, description: job.description, enable: true }, "");
    return user.reminderCronTaskUid;
  }
  return (await createHeartbeatJob(job, "")).taskUid;
}

async function configureReportJob(user: WalletUser, enabled: boolean) {
  if (!enabled) {
    if (user.reportCronTaskUid) await deleteHeartbeatJob(user.reportCronTaskUid, "");
    return null;
  }
  const job = walletReportJob(user);
  if (user.reportCronTaskUid) {
    await updateHeartbeatJob(user.reportCronTaskUid, { cron: job.cron, path: job.path, description: job.description, enable: true }, "");
    return user.reportCronTaskUid;
  }
  return (await createHeartbeatJob(job, "")).taskUid;
}

/**
 * Telegram WebApp supplies a signed Telegram identity, not a Manus OAuth
 * session. Consequently the platform owns the schedules while each job is
 * still user-configurable and linked to exactly one wallet user by task UID.
 * Callback requests never trust request payloads for user resolution.
 */
export async function updateWalletScheduleSettings(input: WalletScheduleSettingsInput) {
  if (!isSupportedWalletTimezone(input.timezone)) throw new Error("Choose a valid IANA timezone.");
  if (!Number.isInteger(input.reminderHour) || input.reminderHour < 0 || input.reminderHour > 23) throw new Error("Choose a reminder hour from 0 to 23.");
  const db = await getDb();
  if (!db) throw new Error("Wallet database is unavailable.");
  const current = await ensureWalletUser(input.identity);
  const reminderCronTaskUid = await configureReminderJob(current, input.reminderEnabled);
  const reportCronTaskUid = await configureReportJob(current, input.reportFrequency !== "off");
  await db.update(walletUsers).set({
    timezone: input.timezone,
    reminderEnabled: input.reminderEnabled ? 1 : 0,
    reminderHour: input.reminderHour,
    reminderCronTaskUid,
    reportFrequency: input.reportFrequency,
    reportCronTaskUid,
  }).where(eq(walletUsers.id, current.id));
  logWalletEvent("wallet_schedule_updated", { reminderEnabled: input.reminderEnabled, reportFrequency: input.reportFrequency, timezone: input.timezone });
  return { timezone: input.timezone, reminderEnabled: input.reminderEnabled, reminderHour: input.reminderHour, reportFrequency: input.reportFrequency };
}
