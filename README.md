# TrumMarket for Telegram

TrumMarket is a Telegram shop for digital goods. The active server contour uses store tables (`shop_*`), RollyPay checkout, signed payment callbacks, atomic inventory reservation, and automatic key delivery. The former wallet interface is no longer mounted by the server.

The buyer flow is `/start` → catalog → product → RollyPay payment → automatic delivery. The administrator manages categories, products, and inventory with `/admin` inside Telegram.

## Delivered functionality

| Area | Implementation |
| --- | --- |
| Catalog | Categories and visible products are shown with current stock and prices. |
| Checkout | A product reserves one inventory item atomically before a RollyPay checkout is created. Failed checkout creation releases the reservation. |
| Delivery | A signed RollyPay callback marks the payment and delivers the reserved digital item once. Duplicate callbacks are idempotent. |
| Administration | The configured administrator can create categories, create products, and upload one key per inventory line from Telegram. |
| Security | Telegram webhook requests use a secret token; RollyPay callbacks use HMAC-SHA256 over the raw request body. |

## Configuration

Copy `.env.example` to `.env` and set the Telegram, database, administrator, and RollyPay variables. Keep all secrets only on the server. Configure the RollyPay callback as:

`https://trummarket.online/api/payments/rollypay/callback`

## One-time Telegram connection

The bot uses an HTTPS webhook and a WebApp button, both supported by Telegram's Bot API and Mini Apps platform.[1][2]

| Required setting | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather. It is used only by server-side code to reply to commands. |
| `TELEGRAM_WEBHOOK_SECRET` | A long random value configured as the Telegram webhook secret token and checked on every webhook request. |
| `TELEGRAM_WEBAPP_URL` | The final public **HTTPS** address used in payment redirects, for example `https://trummarket.online`. |

After the application is publicly available over HTTPS, set `TELEGRAM_WEBAPP_URL` to its root URL and run the following command from a trusted environment that has the three variables configured:

```bash
node scripts/register-telegram.mjs
```

This registers the shop commands and points Telegram to `<TELEGRAM_WEBAPP_URL>/api/telegram/webhook`. Do not include the webhook path inside `TELEGRAM_WEBAPP_URL` itself.

## Local checks

```bash
pnpm test
pnpm check
```

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API"
[2]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"
