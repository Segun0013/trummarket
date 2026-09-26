import { timingSafeEqual } from "crypto";
import type { RequestHandler } from "express";
import { logWalletEvent } from "./walletTelemetry";

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxRequests = 120, private readonly windowMs = 60_000) {}

  consume(key: string, now = Date.now()) {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.maxRequests) return false;
    current.count += 1;
    return true;
  }

  prune(now = Date.now()) {
    Array.from(this.windows.entries()).forEach(([key, entry]) => { if (entry.resetAt <= now) this.windows.delete(key); });
  }
}

function hasExpectedSecret(received: string | undefined, expected: string | undefined) {
  if (!received || !expected) return false;
  const actual = Buffer.from(received);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function telegramActorKey(body: unknown, fallback: string) {
  const update = body as { message?: { from?: { id?: string | number } }; callback_query?: { from?: { id?: string | number } }; edited_message?: { from?: { id?: string | number } } };
  const actorId = update.callback_query?.from?.id ?? update.message?.from?.id ?? update.edited_message?.from?.id;
  return actorId === undefined ? `fallback:${fallback}` : `actor:${actorId}`;
}

/**
 * Rejects invalid webhook secrets before parsing business logic and limits a
 * verified Telegram actor rather than shared Telegram ingress IP addresses.
 */
export function createTelegramWebhookLimiter(limiter = new FixedWindowRateLimiter()): RequestHandler {
  return (req, res, next) => {
    const received = req.header("x-telegram-bot-api-secret-token") ?? undefined;
    if (!hasExpectedSecret(received, process.env.TELEGRAM_WEBHOOK_SECRET)) {
      logWalletEvent("telegram_webhook_rejected", { reason: "invalid_secret" });
      res.status(403).json({ ok: false });
      return;
    }
    limiter.prune();
    const fallback = req.ip || req.socket.remoteAddress || "unknown";
    if (!limiter.consume(telegramActorKey(req.body, fallback))) {
      logWalletEvent("telegram_webhook_rejected", { reason: "rate_limited" });
      res.status(429).json({ ok: false });
      return;
    }
    logWalletEvent("telegram_webhook_accepted", { updateKind: req.body?.callback_query ? "callback" : req.body?.message ? "message" : "other" });
    next();
  };
}

export const limitTelegramWebhook = createTelegramWebhookLimiter();
