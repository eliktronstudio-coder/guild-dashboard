import { createHmac, timingSafeEqual } from "node:crypto";

export const MINI_APP_TTL_SECONDS = 300;
type Validation =
  | { ok: true; telegramId: string; authDate: number }
  | { ok: false; code: "unauthorized" | "expired" };

/** Verify Telegram's original query string, never initDataUnsafe or a client user ID. */
export function verifyMiniAppData(
  raw: unknown,
  botToken: string,
  now = Date.now(),
): Validation {
  const invalid = { ok: false, code: "unauthorized" } as const;
  if (
    typeof raw !== "string" ||
    !raw ||
    raw.length > 12000 ||
    !botToken ||
    /%(?![0-9a-f]{2})/i.test(raw)
  )
    return invalid;
  const params = new URLSearchParams(raw);
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (!/^[a-z_]+$/.test(key) || seen.has(key) || /[\r\n]/.test(value))
      return invalid;
    seen.add(key);
  }
  if (seen.size > 32) return invalid;
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return invalid;
  params.delete("hash");
  params.sort();
  // Unlike third-party Ed25519 validation, HMAC includes the optional signature field.
  const check = [...params].map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return invalid;
  const date = params.get("auth_date");
  if (!date || !/^[0-9]{1,12}$/.test(date)) return invalid;
  const authDate = Number(date),
    current = Math.floor(now / 1000);
  if (authDate > current + 30) return invalid;
  if (current - authDate >= MINI_APP_TTL_SECONDS)
    return { ok: false, code: "expired" };
  try {
    const user = JSON.parse(params.get("user") ?? "null");
    if (
      !user ||
      Array.isArray(user) ||
      !Number.isSafeInteger(user.id) ||
      user.id <= 0 ||
      user.is_bot === true
    )
      return invalid;
    return { ok: true, telegramId: String(user.id), authDate };
  } catch {
    return invalid;
  }
}
