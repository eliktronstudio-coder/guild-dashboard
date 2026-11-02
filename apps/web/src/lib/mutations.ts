import "server-only";
import { headers } from "next/headers";
import { getConfig } from "@/lib/config";
export async function checkOrigin() {
  const origin = (await headers()).get("origin");
  if (origin !== new URL(getConfig().origin).origin)
    throw new Error("UNTRUSTED_ORIGIN");
}
export const field = (form: FormData, key: string) =>
  String(form.get(key) ?? "");
