import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { getDb } from "./db";
import { setWalletLocale } from "./wallet";

const identity = { id: "445566", firstName: "Alex", username: "alex" };
const currentUser = {
  id: 7,
  telegramId: "445566",
  username: "alex",
  firstName: "Alex",
  lastName: null,
  locale: "en" as const,
  localeSelectedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("wallet language persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the selected locale and selection timestamp on the wallet profile", async () => {
    const updatedUser = { ...currentUser, locale: "ru" as const, localeSelectedAt: new Date("2026-08-14T12:00:00Z") };
    const limit = vi.fn().mockResolvedValueOnce([currentUser]).mockResolvedValueOnce([updatedUser]);
    const where = vi.fn(() => ({ limit }));
    const db = {
      insert: vi.fn(() => ({ values: vi.fn(() => ({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) })) })),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await setWalletLocale(identity, "ru");

    expect(result.locale).toBe("ru");
    expect(result.localeSelectedAt).toEqual(updatedUser.localeSelectedAt);
    const updateValues = vi.mocked(db.update).mock.results[0]?.value.set.mock.calls[0]?.[0];
    expect(updateValues).toMatchObject({ locale: "ru" });
    expect(updateValues?.localeSelectedAt).toBeInstanceOf(Date);
  });
});
