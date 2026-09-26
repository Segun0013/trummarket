import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

export type TelegramIdentity = {
  id: string;
  username?: string;
  firstName: string;
  lastName?: string;
};

type TelegramWebAppUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export function verifyTelegramInitData(initData: string, botToken: string): TelegramIdentity {
  const params = new URLSearchParams(initData);
  const suppliedHash = params.get("hash");
  const rawUser = params.get("user");
  const authDate = Number(params.get("auth_date"));

  if (!suppliedHash || !rawUser || !Number.isFinite(authDate)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Telegram authorization data is incomplete." });
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > 86_400 || ageSeconds < -60) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Telegram authorization data has expired." });
  }

  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  if (expectedHash.length !== suppliedHash.length || !timingSafeEqual(Buffer.from(expectedHash), Buffer.from(suppliedHash))) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Telegram authorization verification failed." });
  }

  try {
    const user = JSON.parse(rawUser) as TelegramWebAppUser;
    if (!user.id || !user.first_name) throw new Error("Missing user identity");
    return {
      id: String(user.id),
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
    };
  } catch {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Telegram user data is invalid." });
  }
}

export function telegramUserFromRequest(request: { headers: Record<string, string | string[] | undefined> }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const rawHeader = request.headers["x-telegram-init-data"];
  const initData = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (!token || !initData) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Open this wallet from the Telegram bot to continue." });
  }

  return verifyTelegramInitData(initData, token);
}
