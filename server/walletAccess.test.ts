import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { addWalletTransaction, resolveWalletAccount, softDeleteWalletTransaction } from "./wallet";

const identity = { id: "501", firstName: "Alex" };
const user = { id: 7, telegramId: "501", firstName: "Alex" };
const account = { id: 44, name: "Family", type: "shared", currency: "RUB" };
const transaction = { id: 91, accountId: 44, amountCents: 4_500, idempotencyKey: "voice:message-1", deletedAt: null };

function databaseWithSelectResults(results: unknown[][]) {
  const next = () => results.shift() ?? [];
  const complete = () => ({ limit: vi.fn(async () => next()) });
  const from = () => ({ where: complete, innerJoin: () => ({ where: complete }) });
  const insert = vi.fn(() => ({ values: vi.fn(() => ({ onDuplicateKeyUpdate: vi.fn(async () => undefined) })) }));
  const where = vi.fn(async () => undefined);
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where })) }));
  return { select: vi.fn(() => ({ from })), insert, update, where } as never;
}

describe("wallet account access boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not resolve a requested account without a membership row", async () => {
    mocks.getDb.mockResolvedValue(databaseWithSelectResults([[user], []]));

    await expect(resolveWalletAccount({ identity, accountId: 44 })).rejects.toThrow("do not have access");
  });

  it("soft-deletes only a transaction resolved within the active account", async () => {
    const db = databaseWithSelectResults([[user], [{ account, role: "member" }], [transaction]]);
    mocks.getDb.mockResolvedValue(db);

    const result = await softDeleteWalletTransaction({ identity, accountId: 44, transactionId: 91 });

    expect(result.transaction).toBe(transaction);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
  });

  it("returns the original transaction without another insert for the same account idempotency key", async () => {
    const db = databaseWithSelectResults([[user], [{ account, role: "member" }], [transaction]]);
    mocks.getDb.mockResolvedValue(db);

    const result = await addWalletTransaction({ identity, accountId: 44, kind: "expense", amount: "45", category: "Taxi", idempotencyKey: "voice:message-1" });

    expect(result).toMatchObject({ amountCents: 4_500, transaction, duplicate: true });
    expect(db.insert).toHaveBeenCalledTimes(1); // ensureWalletUser only; transaction was not inserted again.
  });
});
