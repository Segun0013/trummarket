import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createHeartbeatJob: vi.fn(),
  deleteHeartbeatJob: vi.fn(),
  updateHeartbeatJob: vi.fn(),
  ensureWalletUser: vi.fn(),
  getWalletAnalytics: vi.fn(),
  getZonedDateParts: vi.fn(),
  isSupportedWalletTimezone: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/heartbeat", () => ({
  createHeartbeatJob: mocks.createHeartbeatJob,
  deleteHeartbeatJob: mocks.deleteHeartbeatJob,
  updateHeartbeatJob: mocks.updateHeartbeatJob,
}));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("./telegramBot", () => ({ sendTelegramMessage: vi.fn(), walletButton: vi.fn() }));
vi.mock("./wallet", () => ({
  ensureWalletUser: mocks.ensureWalletUser,
  getWalletAnalytics: mocks.getWalletAnalytics,
  getZonedDateParts: mocks.getZonedDateParts,
  isSupportedWalletTimezone: mocks.isSupportedWalletTimezone,
}));

import { claimScheduledDelivery, updateWalletScheduleSettings, WALLET_SCHEDULE_CRON } from "./walletSchedule";

function databaseForClaim(insertResult: () => Promise<unknown>) {
  const limit = vi.fn(async () => []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const values = vi.fn(insertResult);
  return { select: vi.fn(() => ({ from })), insert: vi.fn(() => ({ values })), values };
}

describe("wallet scheduled delivery idempotency", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.isSupportedWalletTimezone.mockReturnValue(true); });

  it("uses a fifteen-minute UTC cadence and leaves local due-time checks to the handler", () => {
    expect(WALLET_SCHEDULE_CRON).toBe("0 */15 * * * *");
  });

  it("accepts the first atomic delivery claim", async () => {
    const db = databaseForClaim(async () => undefined);
    mocks.getDb.mockResolvedValue(db);

    await expect(claimScheduledDelivery("task-a", 7, "reminder", "2026-08-14")).resolves.toBe(true);
    expect(db.values).toHaveBeenCalledTimes(1);
  });

  it("treats a unique-key race as an already delivered message", async () => {
    const db = databaseForClaim(async () => { throw new Error("Duplicate entry 'walletScheduledDeliveries_unique'"); });
    mocks.getDb.mockResolvedValue(db);

    await expect(claimScheduledDelivery("task-a", 7, "report", "weekly:2026-08-03:2026-08-09")).resolves.toBe(false);
  });

  it("does not hide database failures other than a duplicate claim", async () => {
    const db = databaseForClaim(async () => { throw new Error("connection lost"); });
    mocks.getDb.mockResolvedValue(db);

    await expect(claimScheduledDelivery("task-a", 7, "report", "monthly:2026-07-01:2026-07-31")).rejects.toThrow("connection lost");
  });
});

describe("wallet schedule lifecycle", () => {
  const identity = { id: "123", firstName: "Alex" };
  const user = { id: 7, reminderCronTaskUid: null, reportCronTaskUid: null };
  const settingsDb = () => ({ update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })) });

  beforeEach(() => { vi.clearAllMocks(); mocks.isSupportedWalletTimezone.mockReturnValue(true); });

  it("creates a per-user reminder task under the project owner when only Telegram identity exists", async () => {
    mocks.getDb.mockResolvedValue(settingsDb());
    mocks.ensureWalletUser.mockResolvedValue(user);
    mocks.createHeartbeatJob.mockResolvedValue({ taskUid: "reminder-task" });

    await updateWalletScheduleSettings({ identity, timezone: "Europe/Moscow", reminderEnabled: true, reminderHour: 20, reportFrequency: "off" });

    expect(mocks.createHeartbeatJob).toHaveBeenCalledWith(expect.objectContaining({ name: "wallet-reminder-7", path: "/api/scheduled/wallet-reminder" }), "");
    expect(mocks.deleteHeartbeatJob).not.toHaveBeenCalled();
  });

  it("removes stored per-user tasks when the user turns both deliveries off", async () => {
    mocks.getDb.mockResolvedValue(settingsDb());
    mocks.ensureWalletUser.mockResolvedValue({ ...user, reminderCronTaskUid: "reminder-task", reportCronTaskUid: "report-task" });

    await updateWalletScheduleSettings({ identity, timezone: "Europe/Moscow", reminderEnabled: false, reminderHour: 20, reportFrequency: "off" });

    expect(mocks.deleteHeartbeatJob).toHaveBeenCalledWith("reminder-task", "");
    expect(mocks.deleteHeartbeatJob).toHaveBeenCalledWith("report-task", "");
  });
});
