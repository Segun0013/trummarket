import { describe, expect, it } from "vitest";

describe("Telegram webhook secret", () => {
  it("uses Telegram's permitted secret-token characters", () => {
    expect(process.env.TELEGRAM_WEBHOOK_SECRET, "TELEGRAM_WEBHOOK_SECRET must be configured").toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  });

  it("authenticates a harmless empty update at the published webhook", async () => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const webAppUrl = process.env.TELEGRAM_WEBAPP_URL;
    expect(secret, "TELEGRAM_WEBHOOK_SECRET must be configured").toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(webAppUrl, "TELEGRAM_WEBAPP_URL must be configured").toBeTruthy();

    const webhookUrl = new URL("/api/telegram/webhook", webAppUrl);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret!,
      },
      body: "{}",
    });

    expect(response.status).toBe(200);
  }, 15_000);
});
