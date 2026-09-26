import { describe, expect, it } from "vitest";

describe("published Telegram WebApp", () => {
  it("is configured as a publicly reachable HTTPS page", async () => {
    const configuredUrl = process.env.TELEGRAM_WEBAPP_URL;
    expect(configuredUrl, "TELEGRAM_WEBAPP_URL must be configured").toBeTruthy();

    const url = new URL(configuredUrl!);
    expect(url.protocol).toBe("https:");

    const response = await fetch(url, { redirect: "follow" });
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/html");
  }, 15_000);
});
