import "server-only";
export function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const origin = process.env.APP_ORIGIN;
  const configured = Boolean(url && key && origin);
  return {
    url: url ?? "",
    key: key ?? "",
    origin: origin ?? "http://localhost:3000",
    configured,
    telegram: configured && process.env.AUTH_TELEGRAM_ENABLED === "true",
    telegramProvider: process.env.AUTH_TELEGRAM_PROVIDER ?? "custom:telegram",
    email: configured && process.env.AUTH_EMAIL_ENABLED === "true",
    emailDelivery:
      configured && process.env.AUTH_EMAIL_DELIVERY_READY === "true",
  };
}
export const GUILD_ID = "00000000-0000-4000-8000-000000000001";
