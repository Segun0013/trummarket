# Wallet for Telegram

Wallet is a Telegram Mini App and bot for isolated personal-income and expense tracking. Each record belongs to the verified Telegram identity that created it; the dashboard never accepts a user ID from the client.

## Delivered functionality

| Area | Implementation |
| --- | --- |
| Telegram commands | `/start`, `/balance`, `/add_income`, and `/add_expense` are handled through a protected webhook. Income and expense commands accept `<amount> <category> [description]`. |
| Private dashboard | A Telegram WebApp provides exactly four summary metrics: **Current Balance**, **Monthly Income**, **Monthly Expenses**, and **Savings Rate**. |
| Financial tools | Users can add entries, browse filtered history, compare cash flow, and view spending categories. Amounts are stored as integer cents to avoid rounding errors. |
| Isolation | Every query is scoped to the wallet user recovered from cryptographically verified Telegram `initData`. |

## One-time Telegram connection

The bot uses an HTTPS webhook and a WebApp button, both supported by Telegram's Bot API and Mini Apps platform.[1][2]

| Required setting | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather. It is used only by server-side code to reply to commands. |
| `TELEGRAM_WEBHOOK_SECRET` | A long random value configured as the Telegram webhook secret token and checked on every webhook request. |
| `TELEGRAM_WEBAPP_URL` | The final public **HTTPS** address of the deployed application, for example `https://wallet.example.com`. |

After the application is publicly available over HTTPS, set `TELEGRAM_WEBAPP_URL` to its root URL and run the following command from a trusted environment that has the three variables configured:

```bash
node scripts/register-telegram.mjs
```

This registers the four bot commands and points Telegram to `<TELEGRAM_WEBAPP_URL>/api/telegram/webhook`. Do not include the webhook path inside `TELEGRAM_WEBAPP_URL` itself.

## Local checks

```bash
pnpm test
pnpm check
```

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API"
[2]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"
