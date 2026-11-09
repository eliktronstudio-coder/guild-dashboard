import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { registrationAdmin } from "@/lib/registration-server";
export function discordReady() {
  return (process.env.DISCORD_IMPORT_SECRET?.length ?? 0) >= 32;
}
function key() {
  if (!discordReady()) throw Error("DISCORD_NOT_CONFIGURED");
  return createHash("sha256")
    .update(process.env.DISCORD_IMPORT_SECRET!)
    .digest();
}
export function encryptDiscordToken(token: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}
export function decryptDiscordToken(value: string) {
  const raw = Buffer.from(value, "base64");
  if (raw.length < 29) throw Error("INVALID_TOKEN");
  const c = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  c.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([c.update(raw.subarray(28)), c.final()]).toString(
    "utf8",
  );
}
export function authorizeDiscord(request: Request) {
  if (!discordReady()) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? ""),
    expected = Buffer.from("Bearer " + process.env.DISCORD_IMPORT_SECRET!);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
export const discordAdmin = registrationAdmin;
export function discordContext(value: unknown) {
  const v = value as Record<string, unknown>;
  if (
    !v ||
    !["server", "channel", "user"].every(
      (k) => typeof v[k] === "string" && /^\d{17,22}$/.test(v[k] as string),
    ) ||
    (v.parent != null && !/^\d{17,22}$/.test(String(v.parent)))
  )
    throw Error("INVALID_CONTEXT");
  return {
    p_server: v.server as string,
    p_channel: v.channel as string,
    p_parent: (v.parent as string | null) ?? null,
    p_user: v.user as string,
  };
}
export async function boundedJson(request: Request) {
  let size = 0;
  const parts: Uint8Array[] = [];
  const reader = request.body?.getReader();
  if (!reader) throw Error("EMPTY_BODY");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4_600_000) {
      await reader.cancel();
      throw Error("BODY_TOO_LARGE");
    }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
