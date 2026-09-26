import express from "express";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setWalletLocale: vi.fn() }));
vi.mock("./wallet", () => ({
  setWalletLocale: mocks.setWalletLocale,
  acceptWalletInvitation: vi.fn(),
  addWalletTransaction: vi.fn(),
  cancelWalletDraft: vi.fn(),
  confirmWalletDraft: vi.fn(),
  createWalletDraft: vi.fn(),
  ensureWalletUser: vi.fn(),
  getWalletCategories: vi.fn(),
  getWalletDashboard: vi.fn(),
  getWalletLocale: vi.fn(),
}));

import { handleTelegramWebhook } from "./telegramBot";
import { createTelegramWebhookLimiter, FixedWindowRateLimiter } from "./telegramWebhookSecurity";

const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const previousBotToken = process.env.TELEGRAM_BOT_TOKEN;

async function postWebhook(payload: unknown) {
  const app = express();
  app.post("/api/telegram/webhook", express.json({ limit: "256b" }), createTelegramWebhookLimiter(new FixedWindowRateLimiter(4, 60_000)), handleTelegramWebhook);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server failed to listen.");
  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/telegram/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
      body: JSON.stringify(payload),
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe("Telegram webhook route security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.TELEGRAM_BOT_TOKEN = "";
    mocks.setWalletLocale.mockResolvedValue({ firstName: "Alex" });
  });
  afterEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
    process.env.TELEGRAM_BOT_TOKEN = previousBotToken;
  });

  it("returns the immediate callback acknowledgement through JSON parsing and verified rate limiting", async () => {
    const response = await postWebhook({ callback_query: { id: "callback-1", data: "wallet_locale:ru", from: { id: 77, first_name: "Alex" }, message: { chat: { id: 77 } } } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ method: "answerCallbackQuery", callback_query_id: "callback-1" });
  });

  it("rejects an oversized webhook payload before it reaches the callback handler", async () => {
    const response = await postWebhook({ padding: "x".repeat(400) });

    expect(response.status).toBe(413);
    expect(mocks.setWalletLocale).not.toHaveBeenCalled();
  });
});
