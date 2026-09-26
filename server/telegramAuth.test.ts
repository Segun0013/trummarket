import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramInitData } from "./telegramAuth";
import { commandFrom } from "./telegramBot";

function signedInitData(token: string) {
  const parameters = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAH7VQMAAAAAAPtVAwABXzLq",
    user: JSON.stringify({ id: 215803, first_name: "Alex", username: "alex" }),
  });
  const dataCheckString = Array.from(parameters.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  parameters.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return parameters.toString();
}

describe("Telegram identity and command handling", () => {
  it("accepts signed Telegram init data and rejects a modified signature", () => {
    const token = "123456:unit-test-token";
    const initData = signedInitData(token);
    expect(verifyTelegramInitData(initData, token)).toMatchObject({ id: "215803", firstName: "Alex", username: "alex" });
    expect(() => verifyTelegramInitData(`${initData}0`, token)).toThrow("verification failed");
  });

  it("parses standard commands and removes a bot username suffix", () => {
    expect(commandFrom("/add_income@WalletBot 2500 Salary August")).toEqual({
      command: "/add_income",
      args: ["2500", "Salary", "August"],
    });
  });
});
