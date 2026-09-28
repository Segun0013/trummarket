const token = process.env.TELEGRAM_BOT_TOKEN;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
const webAppUrl = process.env.TELEGRAM_WEBAPP_URL;

if (!token || !secretToken || !webAppUrl) {
  throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_WEBAPP_URL must be configured.");
}

const webhookUrl = new URL("/api/telegram/webhook", webAppUrl).toString();
const apiBase = `https://api.telegram.org/bot${token}`;

async function telegram(method, body) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(`${method} failed: ${payload.description || response.status}`);
  return payload.result;
}

await telegram("setMyDescription", {
  description: "TrumMarket — магазин цифровых товаров с автоматической выдачей после оплаты.",
});

await telegram("setMyShortDescription", {
  short_description: "Магазин цифровых товаров",
});

await telegram("setMyCommands", {
  commands: [
    { command: "start", description: "Открыть магазин" },
    { command: "catalog", description: "Каталог товаров" },
    { command: "orders", description: "Мои покупки" },
    { command: "admin", description: "Панель администратора" },
  ],
});

await telegram("setWebhook", {
  url: webhookUrl,
  secret_token: secretToken,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false,
});

const webhook = await telegram("getWebhookInfo", {});
console.log(JSON.stringify({ webhookUrl: webhook.url, pendingUpdates: webhook.pending_update_count }, null, 2));
