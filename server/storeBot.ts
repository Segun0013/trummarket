import type { Request, Response } from "express";
import { cancelReservedOrder, createCategory, createProduct, createReservedOrder, deliverPaidOrder, getProduct, getProductAdminList, listCategories, listProducts, listUserOrders, addInventory, attachPayment, ensureStoreSchema, upsertUser } from "./storeDb";
import { createRollyPayPayment, verifyRollyPaySignature } from "./rollypay";

type Actor = { id: number; username?: string; first_name: string; last_name?: string };
type Update = { message?: { chat: { id: number }; from?: Actor; text?: string }; callback_query?: { id: string; from: Actor; data?: string; message?: { chat: { id: number; }; message_id: number } } };
const states = new Map<number, "category" | "product" | "keys">();
const adminIds = () => new Set((process.env.ADMIN_IDS || process.env.OWNER_OPEN_ID || "").split(",").map(x => x.trim()).filter(Boolean));
const isAdmin = (id: number) => adminIds().has(String(id));
const escapeHtml = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (cents: number) => `${new Intl.NumberFormat("ru-RU").format(cents / 100)} ₽`;
const kb = (inline_keyboard: Record<string, unknown>[][]) => ({ inline_keyboard });
const webUrl = () => process.env.TELEGRAM_WEBAPP_URL || "https://trummarket.online";

async function telegram(method: string, payload: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`${method} failed`);
  return body.result;
}

async function send(chatId: number | string, text: string, markup?: Record<string, unknown>) { return telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }); }
async function edit(chatId: number, messageId: number, text: string, markup?: Record<string, unknown>) { return telegram("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }); }
async function answer(id: string) { return telegram("answerCallbackQuery", { callback_query_id: id }); }
function mainMenu() { return kb([[{ text: "🛒 Каталог", callback_data: "catalog" }], [{ text: "👤 Профиль", callback_data: "profile" }, { text: "📦 Мои покупки", callback_data: "orders" }], [{ text: "📞 Поддержка", callback_data: "support" }]]); }
function adminMenu() { return kb([[{ text: "📦 Товары", callback_data: "admin:products" }], [{ text: "📁 Добавить категорию", callback_data: "admin:add_category" }], [{ text: "➕ Добавить товар", callback_data: "admin:add_product" }], [{ text: "🔑 Добавить ключи", callback_data: "admin:add_keys" }], [{ text: "◀️ В магазин", callback_data: "home" }]]); }

async function showCatalog(chatId: number, messageId?: number) {
  const categories = await listCategories();
  const markup = kb([...categories.map(c => [{ text: `📁 ${c.name}`, callback_data: `category:${c.id}` }]), [{ text: "◀️ В меню", callback_data: "home" }]]);
  const text = categories.length ? "🛒 <b>Каталог</b>\n\nВыберите категорию:" : "🛒 <b>Каталог</b>\n\nКаталог пока пуст.";
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function showCategory(chatId: number, messageId: number, categoryId: number) {
  const products = await listProducts(categoryId);
  return edit(chatId, messageId, products.length ? "📦 <b>Товары</b>\n\nВыберите товар:" : "📦 В этой категории пока нет товаров.", kb([...products.map(p => [{ text: `${p.name} · ${money(p.priceCents)}${p.stock ? ` · ${p.stock} шт.` : " · нет"}`, callback_data: `product:${p.id}` }]), [{ text: "◀️ К категориям", callback_data: "catalog" }]]));
}

async function showProduct(chatId: number, messageId: number, productId: number) {
  const product = await getProduct(productId);
  if (!product) return edit(chatId, messageId, "Товар не найден.", mainMenu());
  const out = `📦 <b>${escapeHtml(product.name)}</b>\n\n${escapeHtml(product.description)}\n\n💰 Цена: <b>${money(product.priceCents)}</b>\n📦 В наличии: <b>${product.stock}</b>`;
  return edit(chatId, messageId, out, kb([...(product.stock ? [[{ text: `🛒 Купить за ${money(product.priceCents)}`, callback_data: `buy:${product.id}` }]] : [[{ text: "🔔 Уведомить о поступлении", callback_data: `restock:${product.id}` }]]), [{ text: "◀️ Назад", callback_data: `category:${product.categoryId}` }]]));
}

async function handleBuy(actor: Actor, chatId: number, messageId: number, productId: number) {
  const user = await upsertUser(actor);
  const product = await getProduct(productId);
  if (!product) return edit(chatId, messageId, "Товар не найден.", mainMenu());
  let order: { id: number; publicId: string };
  try { order = await createReservedOrder(user.id, product); } catch (error) { if ((error as Error).message === "OUT_OF_STOCK") return edit(chatId, messageId, "❌ Товар только что закончился.", mainMenu()); throw error; }
  try {
    const payment = await createRollyPayPayment({ amountCents: product.priceCents, orderId: order.publicId, description: `TrumMarket: ${product.name}`, webUrl: webUrl() });
    await attachPayment(order.id, { paymentId: payment.payment_id, amountCents: product.priceCents, status: payment.status || "created", payload: payment });
    return edit(chatId, messageId, `🧾 <b>Заказ ${order.publicId}</b>\n\nТовар: ${escapeHtml(product.name)}\nСумма: <b>${money(product.priceCents)}</b>\n\nПосле оплаты товар выдастся автоматически.`, kb([[{ text: "💳 Перейти к оплате", url: payment.pay_url }], [{ text: "📦 Мои покупки", callback_data: "orders" }], [{ text: "◀️ В меню", callback_data: "home" }]]));
  } catch (error) { await cancelReservedOrder(order.id); throw error; }
}

async function handleCallback(update: NonNullable<Update["callback_query"]>) {
  const data = update.data || ""; const actor = update.from; const chatId = update.message?.chat.id; const messageId = update.message?.message_id;
  await answer(update.id); if (!chatId || !messageId) return;
  await upsertUser(actor);
  if (data === "home") return edit(chatId, messageId, "🛍 <b>TRUM MARKET</b>\n\nЦифровые товары с автоматической выдачей.", mainMenu());
  if (data === "catalog") return showCatalog(chatId, messageId);
  if (data.startsWith("category:")) return showCategory(chatId, messageId, Number(data.slice(9)));
  if (data.startsWith("product:")) return showProduct(chatId, messageId, Number(data.slice(8)));
  if (data.startsWith("buy:")) return handleBuy(actor, chatId, messageId, Number(data.slice(4)));
  if (data === "profile") { const user = await upsertUser(actor); return edit(chatId, messageId, `👤 <b>Профиль</b>\n\nTelegram ID: <code>${actor.id}</code>\nБаланс: ${money(user.balanceCents)}`, kb([[{ text: "📦 Мои покупки", callback_data: "orders" }], [{ text: "◀️ В меню", callback_data: "home" }]])); }
  if (data === "orders") { const user = await upsertUser(actor); const orders = await listUserOrders(user.id); return edit(chatId, messageId, orders.length ? `📦 <b>Мои покупки</b>\n\n${orders.map(o => `${o.publicId} · ${escapeHtml(o.productName)} · ${o.status === "DELIVERED" ? "✅ выдан" : o.status === "PENDING" ? "⏳ ожидает оплаты" : "❌ закрыт"}`).join("\n")}` : "📦 Покупок пока нет.", mainMenu()); }
  if (data === "support") return edit(chatId, messageId, `📞 <b>Поддержка</b>\n\n${escapeHtml(process.env.SUPPORT_CONTACT || "Поддержка пока не настроена.")}`, mainMenu());
  if (!data.startsWith("admin:") || !isAdmin(actor.id)) return;
  if (data === "admin:home") return edit(chatId, messageId, "⚙️ <b>Админ-панель магазина</b>", adminMenu());
  if (data === "admin:add_category") { states.set(actor.id, "category"); return send(chatId, "Введите название новой категории.\n/cancel — отмена"); }
  if (data === "admin:add_product") { states.set(actor.id, "product"); return send(chatId, "Введите 4 строки:\nID категории\nНазвание товара\nЦена в рублях\nОписание\n/cancel — отмена"); }
  if (data === "admin:add_keys") { states.set(actor.id, "keys"); return send(chatId, "Введите ID товара первой строкой, затем по одному ключу в строке.\n/cancel — отмена"); }
  if (data === "admin:products") { const products = await getProductAdminList(); return edit(chatId, messageId, products.length ? `📦 <b>Товары</b>\n\n${products.map(p => `#${p.id} ${escapeHtml(p.name)} · ${money(p.priceCents)} · ${p.stock} шт.`).join("\n")}` : "Товаров пока нет.", adminMenu()); }
}

async function handleMessage(message: NonNullable<Update["message"]>) {
  if (!message.from) return; const actor = message.from; const chatId = message.chat.id; const text = message.text?.trim() || "";
  const user = await upsertUser(actor); if (user.isBlocked) return send(chatId, "Доступ ограничен.");
  if (text === "/cancel") { states.delete(actor.id); return send(chatId, "Действие отменено.", isAdmin(actor.id) ? adminMenu() : mainMenu()); }
  const state = states.get(actor.id);
  if (state === "category" && isAdmin(actor.id)) { const id = await createCategory(text); states.delete(actor.id); return send(chatId, `✅ Категория создана: #${id}`, adminMenu()); }
  if (state === "product" && isAdmin(actor.id)) { const lines = text.split(/\r?\n/).map(x => x.trim()); const price = Number(lines[2]?.replace(",", ".")); if (lines.length < 4 || !Number.isInteger(price * 100) || price <= 0) return send(chatId, "Нужно 4 строки, цена должна быть положительной."); const id = await createProduct({ categoryId: Number(lines[0]), name: lines[1], priceCents: Math.round(price * 100), description: lines.slice(3).join("\n") }); states.delete(actor.id); return send(chatId, `✅ Товар создан: #${id}`, adminMenu()); }
  if (state === "keys" && isAdmin(actor.id)) { const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean); const productId = Number(lines.shift()); if (!productId || !lines.length) return send(chatId, "Укажите ID товара и хотя бы один ключ."); const added = await addInventory(productId, lines); states.delete(actor.id); return send(chatId, `✅ Добавлено ключей: ${added}`, adminMenu()); }
  if (text === "/start" || text === "/menu") return send(chatId, "🛍 <b>TRUM MARKET</b>\n\nЦифровые товары с автоматической выдачей.", mainMenu());
  if (text === "/catalog") return showCatalog(chatId);
  if (text === "/orders") { const orders = await listUserOrders(user.id); return send(chatId, orders.length ? `📦 <b>Мои покупки</b>\n\n${orders.map(o => `${o.publicId} · ${escapeHtml(o.productName)} · ${o.status === "DELIVERED" ? "✅ выдан" : o.status === "PENDING" ? "⏳ ожидает оплаты" : "❌ закрыт"}`).join("\n")}` : "📦 Покупок пока нет.", mainMenu()); }
  if (text === "/admin" && isAdmin(actor.id)) return send(chatId, "⚙️ <b>Админ-панель магазина</b>", adminMenu());
  if (text === "/admin") return send(chatId, "Нет доступа.", mainMenu());
  return send(chatId, "Выберите действие в меню.", mainMenu());
}

export async function handleStoreTelegramWebhook(req: Request, res: Response) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || req.header("x-telegram-bot-api-secret-token") !== expected) return res.sendStatus(401);
  res.sendStatus(200);
  try { const update = req.body as Update; if (update.callback_query) await handleCallback(update.callback_query); else if (update.message) await handleMessage(update.message); } catch (error) { console.error("[Store] Telegram update failed", error); }
}

export async function handleRollyPayWebhook(req: Request, res: Response) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyRollyPaySignature(raw, req.header("x-timestamp") ?? undefined, req.header("x-signature") ?? undefined)) return res.sendStatus(403);
  try {
    const event = JSON.parse(raw.toString("utf8")) as { payment_id?: string; amount?: string; status?: string };
    if (!event.payment_id || !event.status) return res.sendStatus(400);
    const result = await deliverPaidOrder(event.payment_id, Math.round(Number(event.amount || 0) * 100), event.status);
    if (result.action === "delivered") await telegram("sendMessage", { chat_id: result.order.telegramId, text: `✅ <b>Покупка успешно завершена</b>\n\nТовар: ${escapeHtml(result.order.productName)}\n\nВаш товар:\n<code>${escapeHtml(result.order.inventoryValue)}</code>`, parse_mode: "HTML" });
    res.sendStatus(200);
  } catch (error) { console.error("[Store] RollyPay webhook failed", error); res.sendStatus(500); }
}

export async function initializeStore() { await ensureStoreSchema(); }
