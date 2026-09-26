import { afterEach, describe, expect, it, vi } from "vitest";
import { logWalletEvent } from "./walletTelemetry";

describe("wallet telemetry", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  afterEach(() => info.mockClear());

  it("writes compact structured operational metadata without undefined fields", () => {
    logWalletEvent("telegram_callback_acknowledged", { callbackKind: "draft", source: undefined, authenticated: true });

    expect(info).toHaveBeenCalledOnce();
    const entry = JSON.parse(String(info.mock.calls[0][0]));
    expect(entry).toMatchObject({ service: "wallet-bot", event: "telegram_callback_acknowledged", callbackKind: "draft", authenticated: true });
    expect(entry).not.toHaveProperty("source");
    expect(entry.timestamp).toEqual(expect.any(String));
  });
});
