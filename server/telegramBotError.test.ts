import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./wallet", () => ({
  ensureWalletUser: vi.fn(),
  getWalletDashboard: vi.fn(),
  getWalletLocale: vi.fn(),
  getWalletCategories: vi.fn(),
  addWalletTransaction: vi.fn(),
  createWalletDraft: vi.fn(),
  confirmWalletDraft: vi.fn(),
  cancelWalletDraft: vi.fn(),
  setWalletLocale: vi.fn(),
  acceptWalletInvitation: vi.fn(),
}));
vi.mock("./transactionNlp", () => ({ interpretTransactionText: vi.fn() }));
vi.mock("./telegramMedia", () => ({
  transcribeTelegramVoice: vi.fn(),
  interpretTelegramReceipt: vi.fn(),
  requiresManualMediaEntry: (result: { error?: unknown } | null) => result === null || "error" in result,
}));

import { acceptWalletInvitation, addWalletTransaction, cancelWalletDraft, confirmWalletDraft, createWalletDraft, ensureWalletUser, getWalletCategories, getWalletLocale, setWalletLocale } from "./wallet";
import { interpretTransactionText } from "./transactionNlp";
import { interpretTelegramReceipt, transcribeTelegramVoice } from "./telegramMedia";
import { botCopy } from "./i18n";
import { handleTelegramWebhook, telegramStartDeepLink } from "./telegramBot";

const actor = { id: 321, first_name: "Alex" };

describe("localized Telegram webhook errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
    process.env.TELEGRAM_WEBAPP_URL = "https://wallet.example/app";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it.each([
    ["ru", "Не удалось сохранить операцию. Проверьте сумму и попробуйте снова."],
    ["en", "I could not save that transaction. Please check the amount and try again."],
  ] as const)("sends a saved %s user's localized error after a transaction failure", async (locale, expectedText) => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale, localeSelectedAt: new Date("2026-08-14T12:00:00Z") } as never);
    vi.mocked(getWalletLocale).mockResolvedValue(locale);
    vi.mocked(addWalletTransaction).mockRejectedValue(new Error("storage failure"));
    const req = { header: (name: string) => name === "x-telegram-bot-api-secret-token" ? "test-secret" : undefined, body: { message: { chat: { id: 99 }, from: actor, text: "/add_expense 100 Food" } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(getWalletLocale).toHaveBeenCalledWith({ id: "321", firstName: "Alex", username: undefined, lastName: undefined });
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text).toBe(expectedText);
  });

  it.each([
    ["ru", "Не удалось сохранить операцию. Проверьте сумму и попробуйте снова."],
    ["en", "I could not save that transaction. Please check the amount and try again."],
  ] as const)("uses the stored %s locale when profile lookup fails early", async (locale, expectedText) => {
    vi.mocked(ensureWalletUser).mockRejectedValue(new Error("profile lookup failure"));
    vi.mocked(getWalletLocale).mockResolvedValue(locale);
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, text: "/balance" } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text).toBe(expectedText);
  });

  it.each([
    ["ru", "Не удалось сохранить операцию. Проверьте сумму и попробуйте снова."],
    ["en", "I could not save that transaction. Please check the amount and try again."],
  ] as const)("uses the stored %s locale when the language callback fails", async (locale, expectedText) => {
    vi.mocked(setWalletLocale).mockRejectedValue(new Error("profile update failure"));
    vi.mocked(getWalletLocale).mockResolvedValue(locale);
    const req = { header: () => "test-secret", body: { callback_query: { id: "callback-1", from: actor, data: `wallet_locale:${locale}`, message: { chat: { id: 99 } } } } } as never;
    const res = { json: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    const sendMessageCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/sendMessage"));
    const payload = JSON.parse(String(sendMessageCall?.[1]?.body));
    expect(payload.text).toBe(expectedText);
  });

  it("acknowledges a language callback directly in the webhook before persisting the locale or sending follow-up copy", async () => {
    const order: string[] = [];
    vi.mocked(setWalletLocale).mockImplementation(async () => {
      order.push("persist locale");
      return { firstName: "Alex" } as never;
    });
    vi.mocked(fetch).mockImplementation(async (url) => {
      order.push("send follow-up");
      return { ok: true } as Response;
    });
    const req = { header: () => "test-secret", body: { callback_query: { id: "callback-ack", from: actor, data: "wallet_locale:ru", message: { chat: { id: 99 } } } } } as never;
    const res = { json: vi.fn(() => order.push("respond direct acknowledgement")) } as never;

    await handleTelegramWebhook(req, res);

    expect(res.json).toHaveBeenCalledWith({ method: "answerCallbackQuery", callback_query_id: "callback-ack", text: "Русский выбран — настраиваю кошелёк." });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/answerCallbackQuery"))).toBe(false);
    expect(order).toEqual(["respond direct acknowledgement", "persist locale", "send follow-up"]);
  });

  it("acknowledges a language callback before locale persistence fails and its localized error is sent", async () => {
    const order: string[] = [];
    vi.mocked(setWalletLocale).mockImplementation(async () => {
      order.push("persist locale");
      throw new Error("profile update failure");
    });
    vi.mocked(getWalletLocale).mockResolvedValue("ru");
    vi.mocked(fetch).mockImplementation(async (url) => {
      order.push(String(url).endsWith("/sendMessage") ? "send localized error" : "unexpected Telegram request");
      return { ok: true } as Response;
    });
    const req = { header: () => "test-secret", body: { callback_query: { id: "callback-error-order", from: actor, data: "wallet_locale:ru", message: { chat: { id: 99 } } } } } as never;
    const res = { json: vi.fn(() => order.push("respond direct acknowledgement")) } as never;

    await handleTelegramWebhook(req, res);

    expect(order).toEqual(["respond direct acknowledgement", "persist locale", "send localized error"]);
  });

  it.each(["ru", "en"] as const)("creates a %s localized preview from free text without saving a transaction", async (locale) => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale, localeSelectedAt: new Date() } as never);
    vi.mocked(getWalletCategories).mockResolvedValue([{ name: "Продукты" }] as never);
    vi.mocked(interpretTransactionText).mockResolvedValue({ kind: "expense", amountCents: 45000, category: "Продукты", description: "такси", confidence: 92, usedAi: false });
    vi.mocked(createWalletDraft).mockResolvedValue({ id: "draft-preview" } as never);
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, text: "такси 450" } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(createWalletDraft).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ id: "321" }), kind: "expense", amountCents: 45000, source: "text" }));
    expect(addWalletTransaction).not.toHaveBeenCalled();
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.reply_markup.inline_keyboard[0][0].callback_data).toBe("wallet_draft:confirm:draft-preview");
    expect(payload.reply_markup.inline_keyboard[0][1].callback_data).toBe("wallet_draft:cancel:draft-preview");
  });

  it("turns a Telegram voice note into a confirmation-only draft without retaining the audio", async () => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale: "ru", localeSelectedAt: new Date() } as never);
    vi.mocked(getWalletCategories).mockResolvedValue([{ name: "Транспорт" }] as never);
    vi.mocked(transcribeTelegramVoice).mockResolvedValue({ text: "такси 450", language: "ru", duration: 1 } as never);
    vi.mocked(interpretTransactionText).mockResolvedValue({ kind: "expense", amountCents: 45000, category: "Транспорт", description: "такси", confidence: 93, usedAi: false });
    vi.mocked(createWalletDraft).mockResolvedValue({ id: "voice-draft" } as never);
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, voice: { file_id: "voice-file" } } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(transcribeTelegramVoice).toHaveBeenCalledWith({ file_id: "voice-file" }, "ru");
    expect(createWalletDraft).toHaveBeenCalledWith(expect.objectContaining({ source: "voice", rawText: "такси 450", amountCents: 45000 }));
    expect(addWalletTransaction).not.toHaveBeenCalled();
  });

  it("turns a Telegram receipt photo into a confirmation-only draft without retaining the image", async () => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale: "en", localeSelectedAt: new Date() } as never);
    vi.mocked(getWalletCategories).mockResolvedValue([{ name: "Food" }] as never);
    vi.mocked(interpretTelegramReceipt).mockResolvedValue({ kind: "expense", amountCents: 125050, category: "Food", description: "Receipt", confidence: 95, rawText: "Total 1,250.50" });
    vi.mocked(createWalletDraft).mockResolvedValue({ id: "receipt-draft" } as never);
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, photo: [{ file_id: "small" }, { file_id: "full" }] } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(interpretTelegramReceipt).toHaveBeenCalledWith({ file_id: "full" }, ["Food"]);
    expect(createWalletDraft).toHaveBeenCalledWith(expect.objectContaining({ source: "receipt", rawText: "Total 1,250.50", amountCents: 125050 }));
    expect(addWalletTransaction).not.toHaveBeenCalled();
  });

  it("offers the Russian manual-entry fallback when voice transcription cannot produce a safe draft", async () => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale: "ru", localeSelectedAt: new Date() } as never);
    vi.mocked(transcribeTelegramVoice).mockResolvedValue({ error: "unavailable" } as never);
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, voice: { file_id: "voice-fail" } } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(createWalletDraft).not.toHaveBeenCalled();
    const fallback = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(fallback.text).toBe(botCopy("ru").mediaHint);
    expect(fallback.reply_markup).toBeDefined();
  });

  it("offers the English manual-entry fallback when receipt extraction is malformed", async () => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale: "en", localeSelectedAt: new Date() } as never);
    vi.mocked(getWalletCategories).mockResolvedValue([{ name: "Food" }] as never);
    vi.mocked(interpretTelegramReceipt).mockResolvedValue(null);
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, photo: [{ file_id: "receipt-fail" }] } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(createWalletDraft).not.toHaveBeenCalled();
    const fallback = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(fallback.text).toBe(botCopy("en").mediaHint);
    expect(fallback.reply_markup).toBeDefined();
  });

  it.each([["ru", "сохран"], ["en", "saved"]] as const)("confirms a %s draft only after its explicit callback", async (locale, expectedText) => {
    vi.mocked(getWalletLocale).mockResolvedValue(locale);
    const req = { header: () => "test-secret", body: { callback_query: { id: `draft-confirm-${locale}`, from: actor, data: "wallet_draft:confirm:draft-42", message: { chat: { id: 99 } } } } } as never;
    const res = { json: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(res.json).toHaveBeenCalledWith({ method: "answerCallbackQuery", callback_query_id: `draft-confirm-${locale}` });
    expect(confirmWalletDraft).toHaveBeenCalledWith({ identity: expect.objectContaining({ id: "321" }), draftId: "draft-42" });
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text.toLowerCase()).toContain(expectedText);
  });

  it.each([["ru", "отмен"], ["en", "cancel"]] as const)("cancels a %s draft and sends a localized confirmation", async (locale, expectedText) => {
    vi.mocked(getWalletLocale).mockResolvedValue(locale);
    const req = { header: () => "test-secret", body: { callback_query: { id: `draft-cancel-${locale}`, from: actor, data: "wallet_draft:cancel:draft-42", message: { chat: { id: 99 } } } } } as never;
    const res = { json: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(cancelWalletDraft).toHaveBeenCalledWith({ identity: expect.objectContaining({ id: "321" }), draftId: "draft-42" });
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text.toLowerCase()).toContain(expectedText);
  });

  it.each([["ru", "Не удалось сохранить операцию. Проверьте сумму и попробуйте снова."], ["en", "I could not save that transaction. Please check the amount and try again."]] as const)("uses the stored %s locale for a failed draft confirmation", async (locale, expectedText) => {
    vi.mocked(getWalletLocale).mockResolvedValue(locale);
    vi.mocked(confirmWalletDraft).mockRejectedValueOnce(new Error("draft unavailable"));
    const req = { header: () => "test-secret", body: { callback_query: { id: `draft-error-${locale}`, from: actor, data: "wallet_draft:confirm:draft-42", message: { chat: { id: 99 } } } } } as never;
    const res = { json: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text).toBe(expectedText);
  });

  it.each([["ru", "Не удалось сохранить операцию. Проверьте сумму и попробуйте снова."], ["en", "I could not save that transaction. Please check the amount and try again."]] as const)("uses the stored %s locale for a failed draft cancellation", async (locale, expectedText) => {
    vi.mocked(getWalletLocale).mockResolvedValue(locale);
    vi.mocked(cancelWalletDraft).mockRejectedValueOnce(new Error("draft unavailable"));
    const req = { header: () => "test-secret", body: { callback_query: { id: `draft-cancel-error-${locale}`, from: actor, data: "wallet_draft:cancel:draft-42", message: { chat: { id: 99 } } } } } as never;
    const res = { json: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(res.json).toHaveBeenCalledWith({ method: "answerCallbackQuery", callback_query_id: `draft-cancel-error-${locale}` });
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text).toBe(expectedText);
  });

  it("accepts a valid deep-link invitation through the server service without trusting an account id from Telegram", async () => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale: "en", localeSelectedAt: new Date() } as never);
    vi.mocked(acceptWalletInvitation).mockResolvedValue({ account: { name: "Home budget" }, role: "member" } as never);
    const token = "11111111-1111-4111-8111-111111111111";
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, text: `/start invite_${token}` } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    expect(acceptWalletInvitation).toHaveBeenCalledWith({ identity: { id: "321", firstName: "Alex", username: undefined, lastName: undefined }, token });
    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text).toContain("Home budget");
  });

  it("returns a localized invitation error when an invite is expired or already consumed", async () => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale: "ru", localeSelectedAt: new Date() } as never);
    vi.mocked(acceptWalletInvitation).mockRejectedValue(new Error("expired"));
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, text: "/start invite_11111111-1111-4111-8111-111111111111" } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text).toBe(botCopy("ru").invitationError);
  });

  it("uses Telegram getMe server-side to build a public bot deep-link", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ result: { username: "wallet_test_bot" } }) } as Response);

    await expect(telegramStartDeepLink("invite_11111111-1111-4111-8111-111111111111")).resolves.toBe("https://t.me/wallet_test_bot?start=invite_11111111-1111-4111-8111-111111111111");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("/getMe");
  });

  it.each(["ru", "en"] as const)("sends localized %s help with the wallet button", async (locale) => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale, localeSelectedAt: new Date() } as never);
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, text: "/help" } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text).toBe(botCopy(locale).help);
    expect(payload.reply_markup.inline_keyboard[0][0].web_app.url).toBe("https://wallet.example/app");
  });

  it("opens the settings section from the localized /settings command", async () => {
    vi.mocked(ensureWalletUser).mockResolvedValue({ locale: "en", localeSelectedAt: new Date() } as never);
    const req = { header: () => "test-secret", body: { message: { chat: { id: 99 }, from: actor, text: "/settings" } } } as never;
    const res = { sendStatus: vi.fn() } as never;

    await handleTelegramWebhook(req, res);

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(payload.text).toBe(botCopy("en").settings);
    expect(payload.reply_markup.inline_keyboard[0][0].web_app.url).toBe("https://wallet.example/app?section=settings");
  });
});
