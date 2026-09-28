import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { handleRollyPayWebhook, handleStoreTelegramWebhook, initializeStore } from "../storeBot";
import { releaseExpiredReservations } from "../storeDb";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.post("/api/telegram/webhook", express.json({ limit: "1mb" }), handleStoreTelegramWebhook);
  app.post("/api/payments/rollypay/callback", express.raw({ type: "application/json", limit: "256kb" }), handleRollyPayWebhook);
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.get("/", (_req, res) => res.type("html").send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TrumMarket</title><style>body{font-family:system-ui;background:#101827;color:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:560px;padding:32px;text-align:center}a{display:inline-block;background:#36a9e1;color:white;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700}</style></head><body><main><h1>TrumMarket</h1><p>Магазин цифровых товаров с автоматической выдачей в Telegram.</p><a href="https://t.me/${process.env.TELEGRAM_BOT_USERNAME || "trummarketbot"}">Открыть магазин в Telegram</a></main></body></html>`));
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  await initializeStore();
  releaseExpiredReservations().catch(error => console.error("[Store] Reservation cleanup failed", error));
  const reservationSweeper = setInterval(() => {
    releaseExpiredReservations().catch(error => console.error("[Store] Reservation cleanup failed", error));
  }, 30_000);
  reservationSweeper.unref();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
