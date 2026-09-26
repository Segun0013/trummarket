import type { Request, Response } from "express";
import { acceptWalletInvitation, addWalletTransaction, cancelWalletDraft, confirmWalletDraft, createWalletDraft, ensureWalletUser, getWalletCategories, getWalletDashboard, getWalletLocale, setWalletLocale } from "./wallet";
import type { TelegramIdentity } from "./telegramAuth";
import { botCopy, isWalletLocale, type WalletLocale } from "./i18n";
import { interpretTransactionText } from "./transactionNlp";
import { interpretTelegramReceipt, requiresManualMediaEntry, transcribeTelegramVoice } from "./telegramMedia";
import { logWalletEvent } from "./walletTelemetry";

type TelegramActor = { id: number; username?: string; first_name: string; last_name?: string };
type TelegramFile = { file_id: string; mime_type?: string; file_size?: number };
type TelegramUpdate = { message?: { chat: { id: number }; from?: TelegramActor; text?: string; voice?: TelegramFile; photo?: TelegramFile[] }; callback_query?: { id: string; from: TelegramActor; data?: string; message?: { chat: { id: number } } } };

function formatMoney(cents: number, locale: WalletLocale) { return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(cents / 100); }
export function commandFrom(text: string) { const [first, ...args] = text.trim().split(/\s+/); return { command: first.split("@")[0].toLowerCase(), args }; }
function parseTransactionArgs(args: string[]) { const [amount, category, ...description] = args; return !amount || !category ? null : { amount, category, description: description.join(" ") || undefined }; }
export function localeFromCallback(data: string | undefined): WalletLocale | null { const locale = data?.replace("wallet_locale:", ""); return isWalletLocale(locale) ? locale : null; }
function draftActionFromCallback(data: string | undefined): { action: "confirm" | "cancel"; draftId: string } | null { const match = data?.match(/^wallet_draft:(confirm|cancel):([\w-]{1,64})$/); return match ? { action: match[1] as "confirm" | "cancel", draftId: match[2] } : null; }

async function callTelegram(method: string, payload: Record<string, unknown>) { const token = process.env.TELEGRAM_BOT_TOKEN; if (!token) return; const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error(`Telegram ${method} failed with ${response.status}`); }
export async function telegramStartDeepLink(startParameter: string) {
  if (!/^invite_[0-9a-f-]{36}$/i.test(startParameter)) throw new Error("Invalid Telegram start parameter.");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram bot is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: "POST" });
  if (!response.ok) throw new Error("Unable to resolve the Telegram bot username.");
  const payload = await response.json() as { result?: { username?: string } };
  if (!payload.result?.username) throw new Error("The Telegram bot has no public username.");
  return `https://t.me/${payload.result.username}?start=${startParameter}`;
}
export function languagePicker() { return { inline_keyboard: [[{ text: "Русский", callback_data: "wallet_locale:ru" }, { text: "English", callback_data: "wallet_locale:en" }]] }; }
export function walletButton(locale: WalletLocale = "en", section?: "settings") { const webAppUrl = process.env.TELEGRAM_WEBAPP_URL; if (!webAppUrl) return undefined; if (!section) return { inline_keyboard: [[{ text: botCopy(locale).openWallet, web_app: { url: webAppUrl } }]] }; const url = new URL(webAppUrl); url.searchParams.set("section", section); return { inline_keyboard: [[{ text: botCopy(locale).openWallet, web_app: { url: url.toString() } }]] }; }
function draftPicker(locale: WalletLocale, draftId: string) { const text = botCopy(locale); return { inline_keyboard: [[{ text: `✓ ${text.previewConfirm}`, callback_data: `wallet_draft:confirm:${draftId}` }, { text: text.previewCancel, callback_data: `wallet_draft:cancel:${draftId}` }]] }; }
export async function sendTelegramMessage(chatId: number | string, text: string, replyMarkup?: Record<string, unknown>) { await callTelegram("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup }); }
async function send(chatId: number, text: string, replyMarkup?: Record<string, unknown>) { await sendTelegramMessage(chatId, text, replyMarkup); }
async function sendLanguagePicker(chatId: number) { await send(chatId, "Добро пожаловать в Wallet — ваше личное пространство для денег.\nWelcome to Wallet — your private money space.\n\nВыберите язык / Choose your language:", languagePicker()); }
function toIdentity(user: TelegramActor | undefined): TelegramIdentity | null { return user ? { id: String(user.id), username: user.username, firstName: user.first_name, lastName: user.last_name } : null; }

async function handleLanguageCallback(callback: NonNullable<TelegramUpdate["callback_query"]>, locale: WalletLocale) { const identity = toIdentity(callback.from); if (!identity) return; const text = botCopy(locale); const user = await setWalletLocale(identity, locale); if (callback.message?.chat.id) await send(callback.message.chat.id, text.welcome(user.firstName), walletButton(locale)); }
async function handleDraftCallback(callback: NonNullable<TelegramUpdate["callback_query"]>, action: { action: "confirm" | "cancel"; draftId: string }) { const identity = toIdentity(callback.from); const chatId = callback.message?.chat.id; if (!identity || !chatId) return; const locale = (await getWalletLocale(identity)) ?? "en"; const text = botCopy(locale); if (action.action === "cancel") { await cancelWalletDraft({ identity, draftId: action.draftId }); await send(chatId, text.previewCancelled, walletButton(locale)); return; } await confirmWalletDraft({ identity, draftId: action.draftId }); await send(chatId, text.previewSaved, walletButton(locale)); }
async function sendDraftPreview(chatId: number, identity: TelegramIdentity, locale: WalletLocale, input: { kind: "income" | "expense"; amountCents: number; category: string; description: string | null; confidence: number; rawText: string; source: "text" | "voice" | "receipt" }) { const messages = botCopy(locale); const draft = await createWalletDraft({ identity, ...input, telegramChatId: String(chatId) }); await send(chatId, messages.preview(input.kind, formatMoney(input.amountCents, locale), input.category, input.description, input.confidence), draftPicker(locale, draft.id)); }
async function handleFreeText(message: NonNullable<TelegramUpdate["message"]>, identity: TelegramIdentity, locale: WalletLocale) { const messages = botCopy(locale); const categories = await getWalletCategories(identity); const interpretation = await interpretTransactionText(message.text ?? "", categories.map(category => category.name)); if (!interpretation) { await send(message.chat.id, messages.previewHint, walletButton(locale)); return; } await sendDraftPreview(message.chat.id, identity, locale, { ...interpretation, rawText: message.text ?? "", source: "text" }); }
async function handleMedia(message: NonNullable<TelegramUpdate["message"]>, identity: TelegramIdentity, locale: WalletLocale) { const messages = botCopy(locale); await send(message.chat.id, messages.mediaProcessing); const categories = await getWalletCategories(identity); if (message.voice) { const result = await transcribeTelegramVoice(message.voice, locale); if (requiresManualMediaEntry(result)) { await send(message.chat.id, messages.mediaHint, walletButton(locale)); return; } const interpretation = await interpretTransactionText(result.text, categories.map(category => category.name)); if (!interpretation) { await send(message.chat.id, messages.mediaHint, walletButton(locale)); return; } await sendDraftPreview(message.chat.id, identity, locale, { ...interpretation, rawText: result.text, source: "voice" }); return; } const photo = message.photo?.at(-1); if (!photo) return; const interpretation = await interpretTelegramReceipt(photo, categories.map(category => category.name)); if (requiresManualMediaEntry(interpretation)) { await send(message.chat.id, messages.mediaHint, walletButton(locale)); return; } await sendDraftPreview(message.chat.id, identity, locale, { ...interpretation, source: "receipt" }); }

export async function handleTelegramWebhook(req: Request, res: Response) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret || req.header("x-telegram-bot-api-secret-token") !== expectedSecret) { res.sendStatus(401); return; }
  const update = req.body as TelegramUpdate;
  const message = update.message;
  const callback = update.callback_query;
  let activeLocale: WalletLocale = "en";
  try {
    if (callback) {
      const locale = localeFromCallback(callback.data);
      const draftAction = draftActionFromCallback(callback.data);
      if (!locale && !draftAction) { logWalletEvent("telegram_callback_ignored", { reason: "unsupported" }); res.sendStatus(200); return; }
      const acknowledgement = locale ? botCopy(locale).languageSelected : undefined;
      logWalletEvent("telegram_callback_acknowledged", { callbackKind: locale ? "locale" : "draft" });
      res.json({ method: "answerCallbackQuery", callback_query_id: callback.id, ...(acknowledgement ? { text: acknowledgement } : {}) });
      if (locale) await handleLanguageCallback(callback, locale);
      if (draftAction) await handleDraftCallback(callback, draftAction);
      return;
    }
    res.sendStatus(200);
    const identity = toIdentity(message?.from);
    const input = message?.text;
    if (!message || !identity) return;
    const user = await ensureWalletUser(identity);
    const locale = user.locale;
    activeLocale = locale;
    const messages = botCopy(locale);
    if (message.voice || message.photo?.length) { if (!user.localeSelectedAt) await sendLanguagePicker(message.chat.id); else await handleMedia(message, identity, locale); return; }
    if (!input) return;
    if (!input.startsWith("/")) { if (!user.localeSelectedAt) await sendLanguagePicker(message.chat.id); else await handleFreeText(message, identity, locale); return; }
    const { command, args } = commandFrom(input);
    logWalletEvent("telegram_command_received", { command });
    if (command === "/start") {
      const inviteToken = args.find(arg => arg.startsWith("invite_"))?.slice("invite_".length);
      if (!inviteToken) { await sendLanguagePicker(message.chat.id); return; }
      try {
        const joined = await acceptWalletInvitation({ identity, token: inviteToken });
        const text = user.localeSelectedAt
          ? messages.invitationAccepted(joined.account.name)
          : `Готово — вы присоединились к общему кошельку «${joined.account.name}».\nYou’re in — you joined the shared wallet “${joined.account.name}”.`;
        await send(message.chat.id, text, user.localeSelectedAt ? walletButton(locale) : languagePicker());
      } catch {
        const text = user.localeSelectedAt ? messages.invitationError : "Ссылка-приглашение недействительна, истекла или уже использована.\nThis invitation link is invalid, expired, or has already been used.";
        await send(message.chat.id, text, user.localeSelectedAt ? walletButton(locale) : languagePicker());
      }
      return;
    }
    if (!user.localeSelectedAt) { await sendLanguagePicker(message.chat.id); return; }
    if (command === "/balance") { const { summary } = await getWalletDashboard(identity); await send(message.chat.id, messages.balance(formatMoney(summary.currentBalanceCents, locale), formatMoney(summary.monthlyIncomeCents, locale), formatMoney(summary.monthlyExpensesCents, locale)), walletButton(locale)); return; }
    if (command === "/add_income" || command === "/add_expense") { const parsed = parseTransactionArgs(args); if (!parsed) { await send(message.chat.id, messages.addUsage(command), walletButton(locale)); return; } const kind = command === "/add_income" ? "income" : "expense"; const result = await addWalletTransaction({ identity, kind, ...parsed, source: "command" }); await send(message.chat.id, messages.saved(kind, formatMoney(result.amountCents, locale), parsed.category), walletButton(locale)); return; }
    if (command === "/help") { await send(message.chat.id, messages.help, walletButton(locale)); return; }
    if (command === "/settings") { await send(message.chat.id, messages.settings, walletButton(locale, "settings")); return; }
    await send(message.chat.id, messages.available, walletButton(locale));
  } catch (error) {
    logWalletEvent("telegram_update_failed", { updateKind: callback ? "callback" : message ? "message" : "other" });
    console.error("[Telegram] Update processing failed", error);
    const chatId = message?.chat.id ?? callback?.message?.chat.id;
    const identity = toIdentity(message?.from ?? callback?.from);
    if (chatId && identity) { try { activeLocale = (await getWalletLocale(identity)) ?? activeLocale; } catch { /* retain known locale */ } await send(chatId, botCopy(activeLocale).error); }
  }
}
