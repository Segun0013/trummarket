import { afterEach, describe, expect, it } from "vitest";
import { walletButton } from "./telegramBot";

const originalWebAppUrl = process.env.TELEGRAM_WEBAPP_URL;

afterEach(() => {
  process.env.TELEGRAM_WEBAPP_URL = originalWebAppUrl;
});

describe("Telegram /start WebApp button", () => {
  it("uses the configured public HTTPS wallet URL", () => {
    const configuredUrl = process.env.TELEGRAM_WEBAPP_URL;
    expect(configuredUrl).toBe("https://walletbot-mqqmoq7k.manus.space");
    expect(walletButton()).toEqual({
      inline_keyboard: [[{
        text: "Open my wallet",
        web_app: { url: "https://walletbot-mqqmoq7k.manus.space" },
      }]],
    });
  });

  it("does not offer a WebApp button when no URL is configured", () => {
    delete process.env.TELEGRAM_WEBAPP_URL;
    expect(walletButton()).toBeUndefined();
  });
});
