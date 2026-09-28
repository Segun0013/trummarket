import crypto from "node:crypto";

const baseUrl = (process.env.ROLLYPAY_API_URL || "https://rollypay.io").replace(/\/$/, "");
const apiKey = process.env.ROLLYPAY_API_KEY;
const terminalId = process.env.ROLLYPAY_TERMINAL_ID;
const signingSecret = process.env.ROLLYPAY_SIGNING_SECRET;

function headers() {
  if (!apiKey) throw new Error("ROLLYPAY_API_KEY is not configured");
  return { "content-type": "application/json", "X-API-Key": apiKey, "X-Nonce": crypto.randomUUID() };
}

export async function createRollyPayPayment(input: { amountCents: number; orderId: string; description: string; webUrl: string }) {
  const response = await fetch(`${baseUrl}/api/v1/payments`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      amount: (input.amountCents / 100).toFixed(2),
      payment_currency: "RUB",
      order_id: input.orderId,
      ...(terminalId ? { terminal_id: terminalId } : {}),
      description: input.description,
      success_redirect_url: `${input.webUrl}/payment/success`,
      fail_redirect_url: `${input.webUrl}/payment/fail`,
      metadata: { source: "trummarket" },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.pay_url || !body.payment_id) throw new Error(`RollyPay payment creation failed: ${response.status}`);
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
