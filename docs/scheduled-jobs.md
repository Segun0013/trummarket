# Scheduled Financial Messages

Wallet Bot exposes two **protected** production endpoints: `POST /api/scheduled/wallet-reminder` and `POST /api/scheduled/wallet-report`. On 14 August 2026, unauthenticated `POST` requests to both published routes were rejected with HTTP `403`, confirming that the authorization boundary is active before business logic can run.

Each schedule is **opt-in and per user**. When a user enables a reminder or selects a report frequency in the Mini App, the server creates or updates a Heartbeat task and stores its opaque `taskUid` on that wallet user. The handler resolves the user only from that stored task UID; it does not trust identifiers supplied in a request body. Disabling the setting removes the relevant task. The platform project owns the job because Telegram WebApp identity is not a Manus OAuth session, but the preferences, delivery scope and task linkage remain isolated per wallet user.

The delivery ledger makes reminder and report deliveries idempotent. Repeated scheduler attempts for the same user, date and delivery kind cannot send the same financial message twice.
