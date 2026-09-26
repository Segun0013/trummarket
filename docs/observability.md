# Operational Observability

Wallet Bot writes compact JSON log lines to standard output. The logs intentionally exclude Telegram IDs, usernames, message text, financial amounts, invitation tokens, raw webhook secrets, task UIDs and raw errors.

| Flow | Events | What to monitor |
| --- | --- | --- |
| Telegram ingress | `telegram_webhook_accepted`, `telegram_webhook_rejected` | Unexpected rises in `invalid_secret` or `rate_limited` rejections. |
| Telegram interactions | `telegram_callback_acknowledged`, `telegram_callback_ignored`, `telegram_command_received`, `telegram_update_failed` | Callback acknowledgement volume and update failure trend. |
| Scheduled messages | `scheduled_delivery_processed`, `scheduled_delivery_failed`, `wallet_schedule_updated` | Outcomes `sent`, `duplicate`, `not-due` and `orphan`; any delivery failures. |

During local diagnosis, use `.manus-logs/devserver.log` and `.manus-logs/browserConsole.log`. For a published deployment, use the project production-log view or `manus-webdev-logs` when the hosting environment exposes a deployment log stream. Never enable request-body logging for this service.
