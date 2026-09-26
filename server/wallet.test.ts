import { describe, expect, it } from "vitest";
import type { Transaction } from "../drizzle/schema";
import { amountToCents, getWalletAnalyticsRange, toWalletSummary } from "./wallet";

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: 1,
    walletUserId: 1,
    kind: "expense",
    amountCents: 100,
    category: "Other",
    description: null,
    occurredAt: new Date("2026-08-10T10:00:00Z"),
    createdAt: new Date("2026-08-10T10:00:00Z"),
    ...overrides,
  };
}

describe("wallet monetary rules", () => {
  it("converts user-entered amounts into exact integer cents", () => {
    expect(amountToCents("1200.5")).toBe(120050);
    expect(amountToCents(" 0,01 ")).toBe(1);
    expect(() => amountToCents("12.345")).toThrow("up to two decimal places");
    expect(() => amountToCents("0")).toThrow("outside the supported range");
  });

  it("calculates the four dashboard metrics and category totals", () => {
    const result = toWalletSummary([
      transaction({ id: 1, kind: "income", amountCents: 100_000, category: "Salary" }),
      transaction({ id: 2, kind: "expense", amountCents: 25_000, category: "Food" }),
      transaction({ id: 3, kind: "expense", amountCents: 5_000, category: "Utilities" }),
      transaction({ id: 4, kind: "income", amountCents: 50_000, category: "Freelance", occurredAt: new Date("2026-07-10T10:00:00Z") }),
    ], new Date("2026-08-14T10:00:00Z"));

    expect(result).toMatchObject({
      currentBalanceCents: 120_000,
      monthlyIncomeCents: 100_000,
      monthlyExpensesCents: 30_000,
      savingsRate: 70,
      totalIncomeCents: 150_000,
      totalExpenseCents: 30_000,
    });
    expect(result.expensesByCategory).toEqual([
      { category: "Food", amountCents: 25_000 },
      { category: "Utilities", amountCents: 5_000 },
    ]);
  });
});

describe("wallet analytics time ranges", () => {
  it("uses the user's local month boundaries rather than UTC calendar boundaries", () => {
    const range = getWalletAnalyticsRange({ period: "month" }, "Europe/Moscow", new Date("2026-08-14T21:10:00Z"));

    expect(range.start.toISOString()).toBe("2026-07-31T21:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-08-31T21:00:00.000Z");
  });

  it("keeps a custom local date range correct through the New York DST transition", () => {
    const range = getWalletAnalyticsRange({ period: "custom", from: "2026-03-08", to: "2026-03-08" }, "America/New_York", new Date("2026-03-10T12:00:00Z"));

    expect(range.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(range.endExclusive.getTime() - range.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});
