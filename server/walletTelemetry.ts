export type WalletTelemetryEvent =
  | "telegram_webhook_accepted"
  | "telegram_webhook_rejected"
  | "telegram_callback_acknowledged"
  | "telegram_callback_ignored"
  | "telegram_command_received"
  | "telegram_update_failed"
  | "scheduled_delivery_processed"
  | "scheduled_delivery_failed"
  | "wallet_schedule_updated";

type SafeTelemetryValue = string | number | boolean | null | undefined;

/**
 * Emits compact JSON lines suitable for local and production log aggregation.
 * Callers must only supply operational metadata: never Telegram IDs, message
 * text, invitation tokens, financial amounts, task UIDs, or raw errors.
 */
export function logWalletEvent(event: WalletTelemetryEvent, fields: Record<string, SafeTelemetryValue> = {}) {
  const metadata = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  console.info(JSON.stringify({ service: "wallet-bot", event, ...metadata, timestamp: new Date().toISOString() }));
}
