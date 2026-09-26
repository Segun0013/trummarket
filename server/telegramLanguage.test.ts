import { describe, expect, it } from "vitest";
import { botCopy, isWalletLocale } from "./i18n";
import { languagePicker, localeFromCallback, walletButton } from "./telegramBot";

describe("Telegram language onboarding", () => {
  it("offers exactly Russian and English language choices", () => {
    expect(languagePicker()).toEqual({
      inline_keyboard: [[
        { text: "Русский", callback_data: "wallet_locale:ru" },
        { text: "English", callback_data: "wallet_locale:en" },
      ]],
    });
  });

  it("recognizes only the two supported callback locales", () => {
    expect(localeFromCallback("wallet_locale:ru")).toBe("ru");
    expect(localeFromCallback("wallet_locale:en")).toBe("en");
    expect(localeFromCallback("wallet_locale:es")).toBeNull();
    expect(isWalletLocale("ru")).toBe(true);
    expect(isWalletLocale("en")).toBe(true);
    expect(isWalletLocale("de")).toBe(false);
  });

  it("returns localized wallet button and bot copy", () => {
    expect(botCopy("ru").openWallet).toBe("Открыть кошелёк");
    expect(botCopy("en").openWallet).toBe("Open my wallet");
    expect(walletButton("ru")?.inline_keyboard[0][0].text).toBe("Открыть кошелёк");
    expect(walletButton("en")?.inline_keyboard[0][0].text).toBe("Open my wallet");
  });

  it("keeps meaningful bot replies in the selected language", () => {
    expect(botCopy("ru").welcome("Алекс")).toContain("кошелёк настроен");
    expect(botCopy("ru").addUsage("/add_income")).toContain("Используйте /add_income");
    expect(botCopy("ru").error).toBe("Не удалось сохранить операцию. Проверьте сумму и попробуйте снова.");
    expect(botCopy("en").welcome("Alex")).toContain("You're all set");
    expect(botCopy("en").addUsage("/add_expense")).toContain("Use /add_expense");
    expect(botCopy("en").error).toBe("I could not save that transaction. Please check the amount and try again.");
  });
});
