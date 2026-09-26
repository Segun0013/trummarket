declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        HapticFeedback?: { notificationOccurred: (type: "success" | "error" | "warning") => void };
      };
    };
  }
}

export function getTelegramInitData() {
  return typeof window === "undefined" ? "" : window.Telegram?.WebApp?.initData ?? "";
}

export function isTelegramWebApp() {
  return Boolean(getTelegramInitData());
}

export function prepareTelegramWebApp() {
  const app = window.Telegram?.WebApp;
  if (!app) return;
  app.ready();
  app.expand();
  app.setHeaderColor?.("#f4f6f5");
  app.setBackgroundColor?.("#f4f6f5");
}
