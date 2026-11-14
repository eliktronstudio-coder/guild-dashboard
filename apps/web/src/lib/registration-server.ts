import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { getConfig } from "./config";
export function registrationAdmin() {
  const c = getConfig(),
    key = process.env.SUPABASE_SECRET_KEY;
  if (!c.configured || !key) throw Error("REGISTRATION_NOT_CONFIGURED");
  return createClient(c.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export async function allowAuthAttempt(
  kind: "signup" | "login",
  email?: string,
) {
  const h = await headers();
  // nginx overwrites X-Real-IP. Use the last forwarded hop only as a fallback.
  const ip =
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "unknown";
  const admin = registrationAdmin();
  const keys: [string, number, number][] = [
    [
      `${kind}:ip:${ip}`,
      kind === "signup" ? 5 : 30,
      kind === "signup" ? 3600 : 600,
    ],
  ];
  if (email) keys.push([`${kind}:email:${email}`, 3, 3600]);
  for (const [key, limit, seconds] of keys) {
    const { data, error } = await admin.rpc("claim_auth_attempt", {
      p_key: createHmac("sha256", process.env.SUPABASE_SECRET_KEY!)
        .update(key)
        .digest("hex"),
      p_limit: limit,
      p_seconds: seconds,
    });
    if (error || data !== true) return false;
  }
  return true;
}
