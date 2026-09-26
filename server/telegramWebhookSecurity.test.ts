import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramWebhookLimiter, FixedWindowRateLimiter } from "./telegramWebhookSecurity";

describe("Telegram webhook rate limiting", () => {
  it("allows ordinary webhook traffic then rejects only excess requests in the same window", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);

    expect(limiter.consume("telegram-edge", 1_000)).toBe(true);
    expect(limiter.consume("telegram-edge", 1_200)).toBe(true);
    expect(limiter.consume("telegram-edge", 1_300)).toBe(false);
    expect(limiter.consume("telegram-edge", 2_000)).toBe(true);
  });

  it("keeps rate windows separate by source", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);

    expect(limiter.consume("edge-a", 1_000)).toBe(true);
    expect(limiter.consume("edge-a", 1_001)).toBe(false);
    expect(limiter.consume("edge-b", 1_001)).toBe(true);
  });
});

describe("Telegram webhook security middleware", () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  afterEach(() => { process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret; });

  function invoke(body: unknown, secret = "expected-secret", limiter = new FixedWindowRateLimiter(1, 60_000)) {
    process.env.TELEGRAM_WEBHOOK_SECRET = "expected-secret";
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const next = vi.fn();
    createTelegramWebhookLimiter(limiter)({
      header: vi.fn(() => secret), body, ip: "149.154.167.220", socket: { remoteAddress: "149.154.167.220" },
    } as never, res as never, next);
    return { next, res };
  }

  it("allows a verified callback synchronously and scopes the rate key to its Telegram actor", () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000);
    const first = invoke({ callback_query: { from: { id: 101 } } }, "expected-secret", limiter);
    const otherActor = invoke({ callback_query: { from: { id: 202 } } }, "expected-secret", limiter);
    const repeated = invoke({ callback_query: { from: { id: 101 } } }, "expected-secret", limiter);

    expect(first.next).toHaveBeenCalledOnce();
    expect(otherActor.next).toHaveBeenCalledOnce();
    expect(repeated.res.status).toHaveBeenCalledWith(429);
  });

  it("rejects an invalid webhook secret before the callback handler can execute", () => {
    const result = invoke({ callback_query: { from: { id: 101 } } }, "wrong-secret");

    expect(result.next).not.toHaveBeenCalled();
    expect(result.res.status).toHaveBeenCalledWith(403);
  });
});
