import crypto from "node:crypto";

const configuredBaseUrl = (process.env.ROLLYPAY_API_URL || "https://rollypay.io").replace(/\/$/, "");
const baseUrl = configuredBaseUrl.replace(/^https:\/\/panel\.rollypay\.io(?=\/|$)/i, "https://rollypay.io");
const apiKey = process.env.ROLLYPAY_API_KEY;
const terminalId = process.env.ROLLYPAY_TERMINAL_ID;
const signingSecret = process.env.ROLLYPAY_SIGNING_SECRET;

function headers() {
  if (!apiKey) throw new Error("ROLLYPAY_API_KEY is not configured");
  return { "content-type": "application/json", "X-API-Key": apiKey, "X-Nonce": crypto.randomUUID() };
}

async function requestPayment(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}/api/v1/payments`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { message: raw.slice(0, 300) }; }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function createRollyPayPayment(input: { amountCents: number; orderId: string; description: string; webUrl: string }) {
  const payload = {
    amount: (input.amountCents / 100).toFixed(2),
    payment_currency: "RUB",
    order_id: input.orderId,
    ...(terminalId ? { terminal_id: terminalId } : {}),
    description: input.description,
    success_redirect_url: `${input.webUrl}/payment/success`,
    fail_redirect_url: `${input.webUrl}/payment/fail`,
    metadata: { source: "trummarket" },
  };
  let { response, body } = await requestPayment(payload);
  const message = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "";
  if (response.status === 400 && /terminal\s+not\s+found/i.test(message) && terminalId) {
    const retry = { ...payload };
    delete retry.terminal_id;
    ({ response, body } = await requestPayment(retry));
  }
  if (!response.ok || !body.pay_url || !body.payment_id) {
    const detail = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "invalid response";
    throw new Error(`RollyPay payment creation failed: ${response.status} (${detail})`);
  }
  return body as { payment_id: string; pay_url: string; status: string; amount: string };
}

export function verifyRollyPaySignature(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined) {
  if (!signingSecret || !timestamp || !signature) return false;
  const expected = crypto.createHmac("sha256", signingSecret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const actual = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

export function isRollyPayConfigured() { return Boolean(apiKey && signingSecret); }
