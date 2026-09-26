import { describe, expect, it } from "vitest";

describe("Telegram bot credentials", () => {
  it("authenticates the configured bot through Telegram getMe", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token, "TELEGRAM_BOT_TOKEN must be configured").toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const payload = await response.json() as { ok?: boolean; result?: { is_bot?: boolean } };

    expect(response.ok).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.result?.is_bot).toBe(true);
  }, 15_000);

  it("uses a publicly reachable HTTPS URL for the Telegram WebApp", async () => {
    const value = process.env.TELEGRAM_WEBAPP_URL;
    expect(value, "TELEGRAM_WEBAPP_URL must be configured").toBeTruthy();
    const url = new URL(value!);
    expect(url.protocol).toBe("https:");

    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBeLessThan(500);
  }, 15_000);
});
