import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Telegram webhook registration", () => {
  it("subscribes to messages and language-selection callback queries", async () => {
    const source = await readFile(new URL("../scripts/register-telegram.mjs", import.meta.url), "utf8");

    expect(source).toContain('allowed_updates: ["message", "callback_query"]');
  });
});
