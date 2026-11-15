import "server-only";
import { getConfig } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
/** PKCE cookies are written in the current request; no provider URL is cached. */
export async function telegramLoginUrl(): Promise<string | null> {
  const c = getConfig();
  if (!c.telegram || !/^custom:[a-z0-9-]+$/.test(c.telegramProvider))
    return null;
  try {
    const client = await createClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: c.telegramProvider as `custom:${string}`,
      options: {
        redirectTo: `${c.origin}/auth/callback`,
        scopes: "openid profile",
      },
    });
    return error ? null : data.url;
  } catch {
    // Auth outages show a retry notice, never an application error or secrets.
    return null;
  }
}
