import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { acceptWalletInvitation, createWalletInvitation } from "./wallet";

const identity = { id: "321", firstName: "Alex" };
const user = { id: 7, telegramId: "321", firstName: "Alex" };
const sharedAccount = { id: 44, name: "Family", type: "shared", currency: "RUB" };
const personalAccount = { id: 5, name: "Alex’s wallet", type: "personal", currency: "RUB" };

function databaseWithSelectResults(results: unknown[][]) {
  const next = () => results.shift() ?? [];
  const complete = () => ({ limit: vi.fn(async () => next()) });
  const from = () => ({ where: complete, innerJoin: () => ({ where: complete }) });
  const insert = vi.fn(() => ({ values: vi.fn(() => ({ onDuplicateKeyUpdate: vi.fn(async () => undefined) })) }));
  return { select: vi.fn(() => ({ from })), insert } as never;
}

describe("shared wallet invitations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not allow an admin to create another admin invitation", async () => {
    mocks.getDb.mockResolvedValue(databaseWithSelectResults([[user], [{ account: sharedAccount, role: "admin" }]]));

    await expect(createWalletInvitation({ identity, accountId: 44, role: "admin" })).rejects.toThrow("Only the owner can invite an admin");
  });

  it("rejects an expired invitation before it can add a member", async () => {
    const expiredInvitation = { id: 10, accountId: 44, token: "11111111-1111-4111-8111-111111111111", role: "member", acceptedAt: null, revokedAt: null, expiresAt: new Date("2020-01-01T00:00:00Z") };
    const db = databaseWithSelectResults([[user], [personalAccount], [expiredInvitation]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(acceptWalletInvitation({ identity, token: expiredInvitation.token })).rejects.toThrow("invalid or has expired");
    expect(db.insert).toHaveBeenCalled();
  });

  it("rejects an already-used invitation for a different Telegram user", async () => {
    const consumedInvitation = { id: 10, accountId: 44, token: "11111111-1111-4111-8111-111111111111", role: "member", acceptedAt: new Date(), acceptedByWalletUserId: 999, revokedAt: null, expiresAt: new Date("2030-01-01T00:00:00Z") };
    mocks.getDb.mockResolvedValue(databaseWithSelectResults([[user], [personalAccount], [consumedInvitation]]));

    await expect(acceptWalletInvitation({ identity, token: consumedInvitation.token })).rejects.toThrow("already been used");
  });
});
