import type { Request, Response } from "express";
import { addInventory, attachPayment, cancelReservedOrder, clearRestockSubscribers, createCategory, createProduct, createPromoCode, createReservedOrder, deliverPaidOrder, exportInventoryCsv, exportOrdersCsv, getCategory, getProduct, getProductAdminList, listCategories, listCategoriesAdmin, listProducts, listPromoCodes, listRestockSubscribers, listUserOrders, recordAdminAction, setCategoryActive, setPromoCodeActive, subscribeToRestock, updateCategory, ensureStoreSchema, upsertUser } from "./storeDb";
import { createRollyPayPayment, verifyRollyPaySignature } from "./rollypay";

type Actor = { id: number; username?: string; first_name: string; last_name?: string };
type TelegramMessage = { chat: { id: number }; from?: Actor; text?: string; caption?: string; document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number } };
type Update = { message?: TelegramMessage; callback_query?: { id: string; from: Actor; data?: string; message?: { chat: { id: number; }; message_id: number } } };
type AdminState =
  | { kind: "category" }
  | { kind: "category_name"; categoryId: number }
  | { kind: "category_description"; categoryId: number }
  | { kind: "product" }
  | { kind: "keys"; productId?: number }
  | { kind: "promo_checkout"; productId: number }
  | { kind: "promo_create" };
const states = new Map<number, AdminState>();
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
async function sendDocument(chatId: number | string, filename: string, contents: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("document", new Blob([contents], { type: "text/csv;charset=utf-8" }), filename);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error("sendDocument failed");
}
async function edit(chatId: number, messageId: number, text: string, markup?: Record<string, unknown>) { return telegram("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }); }
async function answer(id: string) { return telegram("answerCallbackQuery", { callback_query_id: id }); }
async function readTelegramDocument(document: NonNullable<TelegramMessage["document"]>) {
  const maxBytes = 2 * 1024 * 1024;
  if (document.file_size && document.file_size > maxBytes) throw new Error("FILE_TOO_LARGE");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const file = await telegram("getFile", { file_id: document.file_id }) as { file_path?: string };
  if (!file.file_path) throw new Error("FILE_PATH_MISSING");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error("FILE_DOWNLOAD_FAILED");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("FILE_TOO_LARGE");
  return bytes.toString("utf8").replace(/^\uFEFF/, "");
}

async function addKeysFromInput(actor: Actor, chatId: number, input: string, productId?: number) {
  const lines = input.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const resolvedProductId = productId ?? Number(lines.shift());
  if (!resolvedProductId || !lines.length) return send(chatId, "Укажите ID товара и хотя бы один ключ.");
  const added = await addInventory(resolvedProductId, lines);
  if (added > 0) {
    const subscribers = await listRestockSubscribers(resolvedProductId);
    const product = await getProduct(resolvedProductId);
    const name = escapeHtml(product?.name || `Товар #${resolvedProductId}`);
    for (const subscriber of subscribers) {
      try { await send(subscriber.telegramId, `🔔 <b>Товар снова в наличии</b>\n\n${name}\nДоступно: ${product?.stock ?? added}`); } catch { /* a blocked chat should not abort restock */ }
    }
    await clearRestockSubscribers(resolvedProductId);
    for (const adminId of adminIds()) {
      if (adminId === String(actor.id)) continue;
      try { await send(adminId, `📦 Пополнение склада: ${name}\nДобавлено ключей: ${added}`); } catch { /* unavailable admin chat */ }
    }
  }
  states.delete(actor.id);
  return send(chatId, `✅ Добавлено ключей: ${added}${added > 0 ? "\n🔔 Подписчики уведомлены." : ""}`, adminMenu());
}
function mainMenu() { return kb([[{ text: "🛒 Каталог", callback_data: "catalog" }], [{ text: "👤 Профиль", callback_data: "profile" }, { text: "📦 Мои покупки", callback_data: "orders" }], [{ text: "📞 Поддержка", callback_data: "support" }]]); }
function adminMenu() { return kb([[{ text: "📦 Товары", callback_data: "admin:products" }], [{ text: "📁 Категории", callback_data: "admin:categories" }], [{ text: "📁 Добавить категорию", callback_data: "admin:add_category" }], [{ text: "➕ Добавить товар", callback_data: "admin:add_product" }], [{ text: "🔑 Добавить ключи", callback_data: "admin:add_keys" }], [{ text: "🎟 Промокоды", callback_data: "admin:promos" }], [{ text: "📊 Выгрузить базу CSV", callback_data: "admin:exports" }], [{ text: "◀️ В магазин", callback_data: "home" }]]); }

async function showAdminCategories(chatId: number, messageId: number) {
  const categories = await listCategoriesAdmin();
  const rows = categories.map(c => [{ text: `${c.isActive ? "🟢" : "⚪"} #${c.id} ${c.name} · ${c.productCount} тов.`, callback_data: `admin:category:${c.id}` }]);
  return edit(chatId, messageId, categories.length ? "📁 <b>Категории</b>\n\nВыберите категорию для редактирования:" : "📁 Категорий пока нет.", kb([...rows, [{ text: "➕ Добавить категорию", callback_data: "admin:add_category" }], [{ text: "◀️ В админ-панель", callback_data: "admin:home" }]]));
}

async function showAdminCategory(chatId: number, messageId: number, categoryId: number) {
  const category = await getCategory(categoryId);
  if (!category) return edit(chatId, messageId, "Категория не найдена.", adminMenu());
  const description = category.description ? `\n\n${escapeHtml(category.description)}` : "\n\nОписание не задано.";
  const actions = category.isActive
    ? [[{ text: "✏️ Переименовать", callback_data: `admin:category:rename:${categoryId}` }], [{ text: "📝 Изменить описание", callback_data: `admin:category:description:${categoryId}` }], [{ text: "🗑 Архивировать", callback_data: `admin:category:delete:${categoryId}` }]]
    : [[{ text: "♻️ Восстановить", callback_data: `admin:category:restore:${categoryId}` }]];
  return edit(chatId, messageId, `📁 <b>${escapeHtml(category.name)}</b>${description}`, kb([...actions, [{ text: "◀️ К категориям", callback_data: "admin:categories" }]]));
}

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
  const out = `📦 <b>${escapeHtml(product.name)}</b>\n\n${escapeHtml(product.description)}\n\n💰 Цена: <b>${money(product.priceCents)}</b>\n✅ Продано: <b>${product.sold}</b>\n📦 В наличии: <b>${product.stock}</b>`;
  return edit(chatId, messageId, out, kb([...(product.stock ? [[{ text: `🛒 Купить за ${money(product.priceCents)}`, callback_data: `buy:${product.id}` }]] : [[{ text: "🔔 Уведомить о поступлении", callback_data: `restock:${product.id}` }]]), [{ text: "◀️ Назад", callback_data: `category:${product.categoryId}` }]]));
}

async function handleBuy(actor: Actor, chatId: number, messageId: number | undefined, productId: number, promoCode?: string) {
  const user = await upsertUser(actor);
  const product = await getProduct(productId);
  if (!product) return edit(chatId, messageId, "Товар не найден.", mainMenu());
  let order: { id: number; publicId: string; amountCents: number; discountCents: number; promoCode: string | null };
  const fail = (text: string, markup?: Record<string, unknown>) => messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
  try { order = await createReservedOrder(user.id, product, promoCode); } catch (error) { if ((error as Error).message === "OUT_OF_STOCK") return fail("❌ Товар только что закончился.", mainMenu()); if ((error as Error).message === "PROMO_INVALID") return fail("❌ Промокод недействителен или лимит использований исчерпан.", kb([[{ text: "Попробовать другой промокод", callback_data: `buy:${product.id}` }], [{ text: "Без промокода", callback_data: `buyplain:${product.id}` }]])); throw error; }
  try {
    const payment = await createRollyPayPayment({ amountCents: order.amountCents, orderId: order.publicId, description: `TrumMarket: ${product.name}`, webUrl: webUrl() });
    await attachPayment(order.id, { paymentId: payment.payment_id, amountCents: order.amountCents, status: payment.status || "created", payload: payment });
    const priceLine = order.discountCents ? `Цена: <s>${money(product.priceCents)}</s>\nСкидка: ${money(order.discountCents)}\n` : "";
    const receipt = `🧾 <b>Заказ ${order.publicId}</b>\n\nТовар: ${escapeHtml(product.name)}\n${priceLine}Сумма: <b>${money(order.amountCents)}</b>\n\nПосле оплаты товар выдастся автоматически.`;
    const markup = kb([[{ text: "💳 Перейти к оплате", url: payment.pay_url }], [{ text: "📦 Мои покупки", callback_data: "orders" }], [{ text: "◀️ В меню", callback_data: "home" }]]);
    return messageId ? edit(chatId, messageId, receipt, markup) : send(chatId, receipt, markup);
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
  if (data.startsWith("buy:")) { const productId = Number(data.slice(4)); states.set(actor.id, { kind: "promo_checkout", productId }); return send(chatId, "Введите промокод или отправьте /skip, чтобы продолжить без скидки."); }
  if (data.startsWith("buyplain:")) { states.delete(actor.id); return handleBuy(actor, chatId, messageId, Number(data.slice(9))); }
  if (data.startsWith("restock:")) { const productId = Number(data.slice(8)); const user = await upsertUser(actor); await subscribeToRestock(productId, user.id); return edit(chatId, messageId, "🔔 Готово. Напишу сюда, когда товар снова появится.", kb([[{ text: "◀️ В меню", callback_data: "home" }]])); }
  if (data === "profile") { const user = await upsertUser(actor); return edit(chatId, messageId, `👤 <b>Профиль</b>\n\nTelegram ID: <code>${actor.id}</code>\nБаланс: ${money(user.balanceCents)}`, kb([[{ text: "📦 Мои покупки", callback_data: "orders" }], [{ text: "◀️ В меню", callback_data: "home" }]])); }
  if (data === "orders") { const user = await upsertUser(actor); const orders = await listUserOrders(user.id); return edit(chatId, messageId, orders.length ? `📦 <b>Мои покупки</b>\n\n${orders.map(o => `${o.publicId} · ${escapeHtml(o.productName)} · ${o.status === "DELIVERED" ? "✅ выдан" : o.status === "PENDING" ? "⏳ ожидает оплаты" : "❌ закрыт"}`).join("\n")}` : "📦 Покупок пока нет.", mainMenu()); }
  if (data === "support") return edit(chatId, messageId, `📞 <b>Поддержка</b>\n\n${escapeHtml(process.env.SUPPORT_CONTACT || "Поддержка пока не настроена.")}`, mainMenu());
  if (!data.startsWith("admin:") || !isAdmin(actor.id)) return;
  if (data === "admin:home") return edit(chatId, messageId, "⚙️ <b>Админ-панель магазина</b>", adminMenu());
  if (data.startsWith("admin:keys:")) { const productId = Number(data.slice("admin:keys:".length)); states.set(actor.id, { kind: "keys", productId }); return send(chatId, `Отправьте ключи для товара #${productId}: текстом по одному в строке или TXT/CSV-файлом.\n/cancel — отмена`); }
  if (data === "admin:promos") { const promos = await listPromoCodes(); const rows = promos.map(p => [{ text: `${p.isActive ? "🟢" : "⚪"} ${p.code} · ${p.discountPercent}% · ${p.usesCount}${p.maxUses ? `/${p.maxUses}` : ""}`, callback_data: `admin:promo:toggle:${p.code}` }]); return edit(chatId, messageId, promos.length ? "🎟 <b>Промокоды</b>\nНажмите на код, чтобы включить или отключить его." : "🎟 Промокодов пока нет.", kb([...rows, [{ text: "➕ Создать промокод", callback_data: "admin:promo:create" }], [{ text: "◀️ В админ-панель", callback_data: "admin:home" }]])); }
  if (data === "admin:promo:create") { states.set(actor.id, { kind: "promo_create" }); return send(chatId, "Введите 3 строки: код, скидка в процентах (1-100), лимит использований (0 = без лимита). Например:\nSUMMER10\n10\n100\n/cancel — отмена"); }
  if (data.startsWith("admin:promo:toggle:")) { const code = data.slice("admin:promo:toggle:".length); const promos = await listPromoCodes(); const promo = promos.find(p => p.code === code); if (promo) await setPromoCodeActive(code, !promo.isActive); return edit(chatId, messageId, "Статус промокода обновлён.", kb([[{ text: "◀️ К промокодам", callback_data: "admin:promos" }]])); }
  if (data === "admin:exports") { const [orders, inventory] = await Promise.all([exportOrdersCsv(), exportInventoryCsv()]); const csv = (rows: Array<Record<string, unknown>>) => "\uFEFF" + (rows.length ? [Object.keys(rows[0]), ...rows.map(row => Object.values(row))].map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n") : "Нет данных"); await sendDocument(chatId, "trummarket-orders.csv", csv(orders)); await sendDocument(chatId, "trummarket-inventory.csv", csv(inventory)); await recordAdminAction(actor.id, "export_csv", "database"); return send(chatId, "✅ Выгрузки отправлены. Файл остатков содержит сами цифровые ключи, храните его конфиденциально.", adminMenu()); }
  if (data === "admin:categories") return showAdminCategories(chatId, messageId);
  if (data.startsWith("admin:category:rename:")) { const categoryId = Number(data.split(":").pop()); states.set(actor.id, { kind: "category_name", categoryId }); return send(chatId, "Введите новое название категории.\n/cancel — отмена"); }
  if (data.startsWith("admin:category:description:")) { const categoryId = Number(data.split(":").pop()); states.set(actor.id, { kind: "category_description", categoryId }); return send(chatId, "Введите новое описание категории.\n/cancel — отмена"); }
  if (data.startsWith("admin:category:delete:")) { const categoryId = Number(data.split(":").pop()); return edit(chatId, messageId, "Архивировать категорию? Товары и заказы сохранятся, но категория исчезнет из каталога.", kb([[{ text: "✅ Да, архивировать", callback_data: `admin:category:confirm_delete:${categoryId}` }], [{ text: "Отмена", callback_data: `admin:category:${categoryId}` }]])); }
  if (data.startsWith("admin:category:confirm_delete:")) { const categoryId = Number(data.split(":").pop()); await setCategoryActive(categoryId, false); return showAdminCategories(chatId, messageId); }
  if (data.startsWith("admin:category:restore:")) { const categoryId = Number(data.split(":").pop()); await setCategoryActive(categoryId, true); return showAdminCategories(chatId, messageId); }
  if (data.startsWith("admin:category:")) return showAdminCategory(chatId, messageId, Number(data.split(":").pop()));
  if (data === "admin:add_category") { states.set(actor.id, { kind: "category" }); return send(chatId, "Введите название новой категории.\n/cancel — отмена"); }
  if (data === "admin:add_product") { states.set(actor.id, { kind: "product" }); return send(chatId, "Введите 4 строки:\nID категории\nНазвание товара\nЦена в рублях\nОписание\n/cancel — отмена"); }
  if (data === "admin:add_keys") { states.set(actor.id, { kind: "keys" }); return send(chatId, "Отправьте ID товара и ключи текстом: первая строка — ID товара, остальные строки — ключи. Можно также прикрепить TXT/CSV-файл с первой строкой ID товара.\n/cancel — отмена"); }
  if (data === "admin:products") { const products = await getProductAdminList(); const rows = products.flatMap(p => [[{ text: `#${p.id} ${p.name} · ${p.stock} в наличии`, callback_data: `admin:keys:${p.id}` }]]); return edit(chatId, messageId, products.length ? "📦 <b>Товары</b>\n\nВыберите товар, чтобы пополнить его склад.": "Товаров пока нет.", kb([...rows, [{ text: "◀️ В админ-панель", callback_data: "admin:home" }]])); }
}

async function handleMessage(message: NonNullable<Update["message"]>) {
  if (!message.from) return; const actor = message.from; const chatId = message.chat.id; const text = message.text?.trim() || "";
  const user = await upsertUser(actor); if (user.isBlocked) return send(chatId, "Доступ ограничен.");
  if (text === "/cancel") { states.delete(actor.id); return send(chatId, "Действие отменено.", isAdmin(actor.id) ? adminMenu() : mainMenu()); }
  const state = states.get(actor.id);
  if (state?.kind === "promo_checkout") { states.delete(actor.id); return handleBuy(actor, chatId, undefined, state.productId, text === "/skip" ? undefined : text); }
  if (state?.kind === "promo_create" && isAdmin(actor.id)) { const lines = text.split(/\r?\n/).map(value => value.trim()); const discount = Number(lines[1]); const maxUses = Number(lines[2]); if (!lines[0] || !Number.isInteger(discount) || discount < 1 || discount > 100 || !Number.isInteger(maxUses) || maxUses < 0) return send(chatId, "Нужно 3 строки: код, скидка 1-100, лимит 0 или больше."); await createPromoCode({ code: lines[0], discountPercent: discount, maxUses: maxUses || null }); states.delete(actor.id); return send(chatId, "✅ Промокод создан.", adminMenu()); }
  if (state?.kind === "category" && isAdmin(actor.id)) { const id = await createCategory(text); states.delete(actor.id); return send(chatId, `✅ Категория создана: #${id}`, adminMenu()); }
  if (state?.kind === "category_name" && isAdmin(actor.id)) { if (!text) return send(chatId, "Название не может быть пустым."); await updateCategory(state.categoryId, { name: text, description: String((await getCategory(state.categoryId))?.description ?? "") }); states.delete(actor.id); return send(chatId, "✅ Категория переименована.", adminMenu()); }
  if (state?.kind === "category_description" && isAdmin(actor.id)) { await updateCategory(state.categoryId, { name: String((await getCategory(state.categoryId))?.name ?? ""), description: text }); states.delete(actor.id); return send(chatId, "✅ Описание обновлено.", adminMenu()); }
  if (state?.kind === "product" && isAdmin(actor.id)) { const lines = text.split(/\r?\n/).map(x => x.trim()); const price = Number(lines[2]?.replace(",", ".")); if (lines.length < 4 || !Number.isInteger(price * 100) || price <= 0) return send(chatId, "Нужно 4 строки, цена должна быть положительной."); const id = await createProduct({ categoryId: Number(lines[0]), name: lines[1], priceCents: Math.round(price * 100), description: lines.slice(3).join("\n") }); states.delete(actor.id); return send(chatId, `✅ Товар создан: #${id}`, adminMenu()); }
  if (state?.kind === "keys" && isAdmin(actor.id) && text) return addKeysFromInput(actor, chatId, text, state.productId);
  if (state?.kind === "keys" && isAdmin(actor.id) && message.document) { try { return addKeysFromInput(actor, chatId, await readTelegramDocument(message.document), state.productId); } catch (error) { return send(chatId, (error as Error).message === "FILE_TOO_LARGE" ? "Файл слишком большой. Максимум 2 МБ." : "Не удалось прочитать файл. Отправьте TXT или CSV в UTF-8."); } }
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
