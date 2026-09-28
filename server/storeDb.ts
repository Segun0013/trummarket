import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import crypto from "node:crypto";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function getStorePool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    pool = mysql.createPool(process.env.DATABASE_URL);
  }
  return pool;
}

async function exec(sql: string) {
  await getStorePool().query(sql);
}

async function ensureColumn(tableName: string, columnName: string, definition: string) {
  const [rows] = await getStorePool().execute<DbRow[]>(`SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=? LIMIT 1`, [tableName, columnName]);
  if (!rows.length) await exec(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
}

export async function ensureStoreSchema() {
  if (!schemaReady) schemaReady = (async () => {
    await exec(`CREATE TABLE IF NOT EXISTS shop_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      telegram_id VARCHAR(32) NOT NULL UNIQUE,
      username VARCHAR(128) NULL,
      first_name VARCHAR(128) NOT NULL,
      last_name VARCHAR(128) NULL,
      balance_cents BIGINT NOT NULL DEFAULT 0,
      is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX shop_users_username_idx (username)
    ) ENGINE=InnoDB`);
    await exec(`CREATE TABLE IF NOT EXISTS shop_categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      description TEXT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    await exec(`CREATE TABLE IF NOT EXISTS shop_products (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      category_id INT UNSIGNED NOT NULL,
      name VARCHAR(180) NOT NULL,
      description TEXT NOT NULL,
      price_cents INT UNSIGNED NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'RUB',
      product_type ENUM('KEY','TEXT','LINK','CUSTOM') NOT NULL DEFAULT 'KEY',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_visible BOOLEAN NOT NULL DEFAULT TRUE,
      auto_delivery BOOLEAN NOT NULL DEFAULT TRUE,
      low_stock_threshold INT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX shop_products_category_idx (category_id),
      INDEX shop_products_active_idx (is_active, is_visible),
      CONSTRAINT shop_products_category_fk FOREIGN KEY (category_id) REFERENCES shop_categories(id)
    ) ENGINE=InnoDB`);
    await exec(`CREATE TABLE IF NOT EXISTS shop_orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      public_id VARCHAR(40) NOT NULL UNIQUE,
      user_id BIGINT UNSIGNED NOT NULL,
      product_id INT UNSIGNED NOT NULL,
      inventory_id BIGINT UNSIGNED NULL,
      amount_cents INT UNSIGNED NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'RUB',
      status ENUM('PENDING','PAID','DELIVERED','FAILED','REFUNDED','CANCELLED') NOT NULL DEFAULT 'PENDING',
      payment_id VARCHAR(100) NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP NULL,
      delivered_at TIMESTAMP NULL,
      INDEX shop_orders_user_idx (user_id),
      INDEX shop_orders_status_idx (status),
      CONSTRAINT shop_orders_user_fk FOREIGN KEY (user_id) REFERENCES shop_users(id),
      CONSTRAINT shop_orders_product_fk FOREIGN KEY (product_id) REFERENCES shop_products(id)
    ) ENGINE=InnoDB`);
    await exec(`CREATE TABLE IF NOT EXISTS shop_inventory (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      product_id INT UNSIGNED NOT NULL,
      value TEXT NOT NULL,
      status ENUM('AVAILABLE','RESERVED','SOLD','DISABLED') NOT NULL DEFAULT 'AVAILABLE',
      order_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sold_at TIMESTAMP NULL,
      UNIQUE KEY shop_inventory_product_value_unique (product_id, value(255)),
      INDEX shop_inventory_available_idx (product_id, status),
      CONSTRAINT shop_inventory_product_fk FOREIGN KEY (product_id) REFERENCES shop_products(id)
    ) ENGINE=InnoDB`);
    await exec(`CREATE TABLE IF NOT EXISTS shop_payments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      payment_id VARCHAR(100) NOT NULL UNIQUE,
      order_id BIGINT UNSIGNED NOT NULL,
      amount_cents INT UNSIGNED NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'RUB',
      status VARCHAR(32) NOT NULL,
      payload_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT shop_payments_order_fk FOREIGN KEY (order_id) REFERENCES shop_orders(id)
    ) ENGINE=InnoDB`);
    await exec(`CREATE TABLE IF NOT EXISTS shop_balance_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      type ENUM('DEPOSIT','PURCHASE','REFUND','BONUS','ADMIN_ADJUSTMENT') NOT NULL,
      amount_cents BIGINT NOT NULL,
      balance_before BIGINT NOT NULL,
      balance_after BIGINT NOT NULL,
      reference_id VARCHAR(100) NULL,
      description VARCHAR(500) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX shop_balance_user_idx (user_id),
      CONSTRAINT shop_balance_user_fk FOREIGN KEY (user_id) REFERENCES shop_users(id)
    ) ENGINE=InnoDB`);
    await exec(`CREATE TABLE IF NOT EXISTS shop_admin_actions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      admin_telegram_id VARCHAR(32) NOT NULL,
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(40) NOT NULL,
      target_id VARCHAR(80) NULL,
      details_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
    await ensureColumn("shop_orders", "promo_code", "VARCHAR(64) NULL");
    await ensureColumn("shop_orders", "discount_cents", "INT UNSIGNED NOT NULL DEFAULT 0");
    await exec(`CREATE TABLE IF NOT EXISTS shop_promocodes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      discount_percent TINYINT UNSIGNED NOT NULL,
      max_uses INT UNSIGNED NULL,
      uses_count INT UNSIGNED NOT NULL DEFAULT 0,
      expires_at TIMESTAMP NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (discount_percent BETWEEN 1 AND 100)
    ) ENGINE=InnoDB`);
    await exec(`CREATE TABLE IF NOT EXISTS shop_restock_subscriptions (
      product_id INT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (product_id, user_id),
      CONSTRAINT shop_restock_product_fk FOREIGN KEY (product_id) REFERENCES shop_products(id),
      CONSTRAINT shop_restock_user_fk FOREIGN KEY (user_id) REFERENCES shop_users(id)
    ) ENGINE=InnoDB`);
  })();
  return schemaReady;
}

type DbRow = RowDataPacket & Record<string, any>;
export type StoreUser = { id: number; telegramId: string; username: string | null; firstName: string; lastName: string | null; balanceCents: number; isBlocked: number };
export type Product = { id: number; categoryId: number; categoryName: string; name: string; description: string; priceCents: number; currency: string; productType: string; autoDelivery: number; stock: number; sold: number };

export async function upsertUser(actor: { id: number; username?: string; first_name: string; last_name?: string }) {
  await ensureStoreSchema();
  await getStorePool().execute(
    `INSERT INTO shop_users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE username=VALUES(username), first_name=VALUES(first_name), last_name=VALUES(last_name)`,
    [String(actor.id), actor.username ?? null, actor.first_name, actor.last_name ?? null]
  );
  const [rows] = await getStorePool().execute<DbRow[]>("SELECT id, telegram_id telegramId, username, first_name firstName, last_name lastName, balance_cents balanceCents, is_blocked isBlocked FROM shop_users WHERE telegram_id=?", [String(actor.id)]);
  return rows[0] as StoreUser;
}

export async function listCategories() {
  await ensureStoreSchema();
  const [rows] = await getStorePool().query<DbRow[]>("SELECT id, name, description FROM shop_categories WHERE is_active=1 ORDER BY sort_order, name");
  return rows;
}

export async function listCategoriesAdmin() {
  await ensureStoreSchema();
  const [rows] = await getStorePool().query<DbRow[]>(`SELECT c.id, c.name, c.description, c.is_active isActive,
    (SELECT COUNT(*) FROM shop_products p WHERE p.category_id=c.id) productCount
    FROM shop_categories c ORDER BY c.is_active DESC, c.sort_order, c.name`);
  return rows;
}

export async function listProducts(categoryId?: number) {
  await ensureStoreSchema();
  const [rows] = await getStorePool().execute<DbRow[]>(`SELECT p.id, p.category_id categoryId, c.name categoryName, p.name, p.description, p.price_cents priceCents, p.currency, p.product_type productType, p.auto_delivery autoDelivery,
    (SELECT COUNT(*) FROM shop_inventory i WHERE i.product_id=p.id AND i.status='AVAILABLE') stock,
    (SELECT COUNT(*) FROM shop_inventory i WHERE i.product_id=p.id AND i.status='SOLD') sold
    FROM shop_products p JOIN shop_categories c ON c.id=p.category_id WHERE p.is_active=1 AND p.is_visible=1 AND c.is_active=1 ${categoryId ? "AND p.category_id=?" : ""} ORDER BY p.id DESC`, categoryId ? [categoryId] : []);
  return rows as Product[];
}

export async function getProduct(id: number) {
  const products = await listProducts();
  return products.find(p => p.id === id);
}

export async function createCategory(name: string, description = "") {
  await ensureStoreSchema();
  const [result] = await getStorePool().execute<any>("INSERT INTO shop_categories (name, description) VALUES (?, ?)", [name.trim(), description.trim()]);
  return Number(result.insertId);
}

export async function getCategory(id: number) {
  await ensureStoreSchema();
  const [rows] = await getStorePool().execute<DbRow[]>("SELECT id, name, description, is_active isActive FROM shop_categories WHERE id=? LIMIT 1", [id]);
  return rows[0];
}

export async function updateCategory(id: number, input: { name: string; description: string }) {
  await ensureStoreSchema();
  const [result] = await getStorePool().execute<any>("UPDATE shop_categories SET name=?, description=? WHERE id=? AND is_active=1", [input.name.trim(), input.description.trim() || null, id]);
  return Number(result.affectedRows) > 0;
}

export async function setCategoryActive(id: number, active: boolean) {
  await ensureStoreSchema();
  const [result] = await getStorePool().execute<any>("UPDATE shop_categories SET is_active=? WHERE id=?", [active ? 1 : 0, id]);
  return Number(result.affectedRows) > 0;
}

export async function createProduct(input: { categoryId: number; name: string; description: string; priceCents: number; type?: string }) {
  await ensureStoreSchema();
  const [result] = await getStorePool().execute<any>("INSERT INTO shop_products (category_id,name,description,price_cents,product_type) VALUES (?,?,?,?,?)", [input.categoryId, input.name.trim(), input.description.trim(), input.priceCents, input.type ?? "KEY"]);
  return Number(result.insertId);
}

export async function addInventory(productId: number, values: string[]) {
  await ensureStoreSchema();
  let added = 0;
  const connection = await getStorePool().getConnection();
  try {
    await connection.beginTransaction();
    for (const value of [...new Set(values.map(v => v.trim()).filter(Boolean))]) {
      try { await connection.execute("INSERT INTO shop_inventory (product_id,value) VALUES (?,?)", [productId, value]); added++; } catch (error: any) { if (error?.code !== "ER_DUP_ENTRY") throw error; }
    }
    await connection.commit();
    return added;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function createPromoCode(input: { code: string; discountPercent: number; maxUses?: number | null }) {
  await ensureStoreSchema();
  const [result] = await getStorePool().execute<any>("INSERT INTO shop_promocodes (code, discount_percent, max_uses) VALUES (?, ?, ?)", [input.code.trim().toUpperCase(), input.discountPercent, input.maxUses ?? null]);
  return Number(result.insertId);
}

export async function listPromoCodes() {
  await ensureStoreSchema();
  const [rows] = await getStorePool().query<DbRow[]>("SELECT code, discount_percent discountPercent, max_uses maxUses, uses_count usesCount, is_active isActive FROM shop_promocodes ORDER BY id DESC LIMIT 30");
  return rows;
}

export async function setPromoCodeActive(code: string, active: boolean) {
  await ensureStoreSchema();
  await getStorePool().execute("UPDATE shop_promocodes SET is_active=? WHERE code=?", [active ? 1 : 0, code.toUpperCase()]);
}

export async function subscribeToRestock(productId: number, userId: number) {
  await ensureStoreSchema();
  await getStorePool().execute("INSERT IGNORE INTO shop_restock_subscriptions (product_id,user_id) VALUES (?,?)", [productId, userId]);
}

export async function listRestockSubscribers(productId: number) {
  await ensureStoreSchema();
  const [rows] = await getStorePool().execute<DbRow[]>("SELECT u.telegram_id telegramId FROM shop_restock_subscriptions s JOIN shop_users u ON u.id=s.user_id WHERE s.product_id=?", [productId]);
  return rows as Array<{ telegramId: string }>;
}

export async function clearRestockSubscribers(productId: number) {
  await ensureStoreSchema();
  await getStorePool().execute("DELETE FROM shop_restock_subscriptions WHERE product_id=?", [productId]);
}

export async function createReservedOrder(userId: number, product: Product, promoCode?: string) {
  const connection = await getStorePool().getConnection();
  try {
    await connection.beginTransaction();
    const [available] = await connection.execute<DbRow[]>("SELECT id FROM shop_inventory WHERE product_id=? AND status='AVAILABLE' ORDER BY id LIMIT 1 FOR UPDATE", [product.id]);
    if (!available[0]) throw new Error("OUT_OF_STOCK");
    let discountCents = 0;
    let normalizedPromo: string | null = null;
    if (promoCode) {
      normalizedPromo = promoCode.trim().toUpperCase();
      const [promos] = await connection.execute<DbRow[]>("SELECT code, discount_percent discountPercent, max_uses maxUses, uses_count usesCount FROM shop_promocodes WHERE code=? AND is_active=1 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP) FOR UPDATE", [normalizedPromo]);
      const promo = promos[0];
      if (!promo || (promo.maxUses !== null && Number(promo.usesCount) >= Number(promo.maxUses))) throw new Error("PROMO_INVALID");
      discountCents = Math.floor(product.priceCents * Number(promo.discountPercent) / 100);
      await connection.execute("UPDATE shop_promocodes SET uses_count=uses_count+1 WHERE code=?", [normalizedPromo]);
    }
    const publicId = `TM-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    const [orderResult] = await connection.execute<any>("INSERT INTO shop_orders (public_id,user_id,product_id,inventory_id,amount_cents,promo_code,discount_cents) VALUES (?,?,?,?,?,?,?)", [publicId, userId, product.id, available[0].id, product.priceCents - discountCents, normalizedPromo, discountCents]);
    await connection.execute("UPDATE shop_inventory SET status='RESERVED', order_id=? WHERE id=?", [orderResult.insertId, available[0].id]);
    await connection.commit();
    return { id: Number(orderResult.insertId), publicId, amountCents: product.priceCents - discountCents, discountCents, promoCode: normalizedPromo };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function attachPayment(orderId: number, payment: { paymentId: string; amountCents: number; status: string; payload: unknown }) {
  await ensureStoreSchema();
  await getStorePool().execute("UPDATE shop_orders SET payment_id=? WHERE id=?", [payment.paymentId, orderId]);
  await getStorePool().execute("INSERT INTO shop_payments (payment_id,order_id,amount_cents,status,payload_json) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),payload_json=VALUES(payload_json)", [payment.paymentId, orderId, payment.amountCents, payment.status, JSON.stringify(payment.payload)]);
}

export async function cancelReservedOrder(orderId: number) {
  await ensureStoreSchema();
  const connection = await getStorePool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<DbRow[]>("SELECT promo_code FROM shop_orders WHERE id=? AND status='PENDING' FOR UPDATE", [orderId]);
    if (!rows[0]) { await connection.commit(); return; }
    await connection.execute("UPDATE shop_inventory i JOIN shop_orders o ON o.inventory_id=i.id SET i.status='AVAILABLE', i.order_id=NULL WHERE o.id=? AND o.status='PENDING' AND i.status='RESERVED'", [orderId]);
    if (rows[0].promo_code) await connection.execute("UPDATE shop_promocodes SET uses_count=GREATEST(uses_count-1,0) WHERE code=?", [rows[0].promo_code]);
    await connection.execute("UPDATE shop_orders SET status='CANCELLED' WHERE id=? AND status='PENDING'", [orderId]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function deliverPaidOrder(paymentId: string, amountCents: number, status: string) {
  const connection = await getStorePool().getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.execute<DbRow[]>("SELECT o.*, u.telegram_id telegramId, p.name productName, p.id productId, i.value inventoryValue FROM shop_orders o JOIN shop_users u ON u.id=o.user_id JOIN shop_products p ON p.id=o.product_id LEFT JOIN shop_inventory i ON i.id=o.inventory_id WHERE o.payment_id=? FOR UPDATE", [paymentId]);
    const order = orders[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (Number(order.amount_cents) !== amountCents) throw new Error("AMOUNT_MISMATCH");
    await connection.execute("UPDATE shop_payments SET status=?, payload_json=payload_json WHERE payment_id=?", [status, paymentId]);
    if (status !== "paid") {
      if (["canceled", "expired"].includes(status)) {
        await connection.execute("UPDATE shop_inventory SET status='AVAILABLE', order_id=NULL WHERE id=? AND status='RESERVED'", [order.inventory_id]);
        if (order.promo_code) await connection.execute("UPDATE shop_promocodes SET uses_count=GREATEST(uses_count-1,0) WHERE code=?", [order.promo_code]);
        await connection.execute("UPDATE shop_orders SET status='CANCELLED' WHERE id=? AND status='PENDING'", [order.id]);
      }
      await connection.commit();
      return { action: "ignored", order };
    }
    if (order.status === "DELIVERED") { await connection.commit(); return { action: "already_delivered", order }; }
    await connection.execute("UPDATE shop_inventory SET status='SOLD', sold_at=CURRENT_TIMESTAMP WHERE id=? AND status='RESERVED'", [order.inventory_id]);
    await connection.execute("UPDATE shop_orders SET status='DELIVERED', paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP), delivered_at=COALESCE(delivered_at,CURRENT_TIMESTAMP) WHERE id=?", [order.id]);
    await connection.commit();
    return { action: "delivered", order };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function listUserOrders(userId: number) {
  await ensureStoreSchema();
  const [rows] = await getStorePool().execute<DbRow[]>("SELECT o.public_id publicId, o.status, o.amount_cents amountCents, p.name productName, i.value inventoryValue, o.created_at createdAt FROM shop_orders o JOIN shop_products p ON p.id=o.product_id LEFT JOIN shop_inventory i ON i.id=o.inventory_id WHERE o.user_id=? ORDER BY o.id DESC LIMIT 20", [userId]);
  return rows;
}

export async function getProductAdminList() {
  await ensureStoreSchema();
  const [rows] = await getStorePool().query<DbRow[]>("SELECT p.id,p.name,p.price_cents priceCents,c.name categoryName,(SELECT COUNT(*) FROM shop_inventory i WHERE i.product_id=p.id AND i.status='AVAILABLE') stock,p.is_active isActive FROM shop_products p JOIN shop_categories c ON c.id=p.category_id ORDER BY p.id DESC");
  return rows;
}

export async function exportOrdersCsv() {
  await ensureStoreSchema();
  const [rows] = await getStorePool().query<DbRow[]>(`SELECT o.public_id orderId,u.telegram_id telegramId,u.username,p.name product,o.status,o.amount_cents amountCents,o.promo_code promoCode,o.created_at createdAt,o.paid_at paidAt
    FROM shop_orders o JOIN shop_users u ON u.id=o.user_id JOIN shop_products p ON p.id=o.product_id ORDER BY o.id DESC LIMIT 50000`);
  return rows as Array<Record<string, unknown>>;
}

export async function exportInventoryCsv() {
  await ensureStoreSchema();
  const [rows] = await getStorePool().query<DbRow[]>(`SELECT p.id productId,p.name product,c.name category,i.status,i.value item,i.created_at addedAt,i.sold_at soldAt,o.public_id orderId
    FROM shop_inventory i JOIN shop_products p ON p.id=i.product_id JOIN shop_categories c ON c.id=p.category_id LEFT JOIN shop_orders o ON o.id=i.order_id ORDER BY p.id,i.id LIMIT 50000`);
  return rows as Array<Record<string, unknown>>;
}

export async function recordAdminAction(adminId: number, action: string, targetType: string, targetId?: string, details?: unknown) {
  await ensureStoreSchema();
  await getStorePool().execute("INSERT INTO shop_admin_actions (admin_telegram_id,action,target_type,target_id,details_json) VALUES (?,?,?,?,?)", [String(adminId), action, targetType, targetId ?? null, details ? JSON.stringify(details) : null]);
}
