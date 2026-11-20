import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/config";
export async function createClient() {
  const config = getConfig();
  if (!config.configured) throw new Error("SUPABASE_NOT_CONFIGURED");
  const jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server Components are read-only. proxy.ts refreshes cookies. */
        }
      },
    },
  });
}
