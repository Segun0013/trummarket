import { describe, expect, it } from "vitest";
import { transactionInput, walletAnalyticsInput, walletBudgetInput, walletScheduleSettingsInput } from "./routers";

describe("wallet transaction input contract", () => {
  it("accepts a complete valid transaction", () => {
    expect(transactionInput.parse({
      kind: "income",
      amount: "2500.50",
      category: "Freelance",
      description: "August project",
      occurredAt: new Date("2026-08-14T00:00:00Z"),
      accountId: 14,
      source: "text",
      idempotencyKey: "telegram-update-123",
    })).toMatchObject({ kind: "income", category: "Freelance", accountId: 14, source: "text" });
  });

  it("rejects invalid money, empty categories, excessive descriptions, and unsupported kinds", () => {
    expect(() => transactionInput.parse({ kind: "expense", amount: "2.999", category: "Food" })).toThrow();
    expect(() => transactionInput.parse({ kind: "expense", amount: "20", category: "  " })).toThrow();
    expect(() => transactionInput.parse({ kind: "expense", amount: "20", category: "Food", description: "x".repeat(501) })).toThrow();
    expect(() => transactionInput.parse({ kind: "transfer", amount: "20", category: "Food" })).toThrow();
    expect(() => transactionInput.parse({ kind: "expense", amount: "20", category: "Food", accountId: 0 })).toThrow();
    expect(() => transactionInput.parse({ kind: "expense", amount: "20", category: "Food", idempotencyKey: "x".repeat(129) })).toThrow();
  });
});

describe("wallet analytics and schedule input contracts", () => {
  it("accepts bounded analytics, monthly budgets, and an IANA schedule preference", () => {
    expect(walletAnalyticsInput.parse({ period: "custom", from: "2026-08-01", to: "2026-08-14", accountId: 3 })).toMatchObject({ period: "custom", accountId: 3 });
    expect(walletBudgetInput.parse({ categoryId: 9, amount: "12500.00", accountId: 3 })).toMatchObject({ categoryId: 9, amount: "12500.00" });
    expect(walletScheduleSettingsInput.parse({ timezone: "Europe/Moscow", reminderEnabled: true, reminderHour: 20, reportFrequency: "weekly" })).toMatchObject({ timezone: "Europe/Moscow", reminderHour: 20 });
  });

  it("rejects incomplete custom periods and unsafe schedule values", () => {
    expect(() => walletAnalyticsInput.parse({ period: "custom", from: "2026-08-01" })).toThrow();
    expect(() => walletAnalyticsInput.parse({ period: "month", from: "14-08-2026" })).toThrow();
    expect(() => walletBudgetInput.parse({ categoryId: 0, amount: "30" })).toThrow();
    expect(() => walletScheduleSettingsInput.parse({ timezone: "", reminderEnabled: true, reminderHour: 24, reportFrequency: "daily" })).toThrow();
  });
});
