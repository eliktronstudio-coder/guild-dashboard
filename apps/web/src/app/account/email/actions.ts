"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { getConfig } from "@/lib/config";
import { checkOrigin } from "@/lib/mutations";
import { registrationAdmin, allowAuthAttempt } from "@/lib/registration-server";
import { emailLoginInput, attachEmailLogin } from "@/lib/email-login";
import type { FormState } from "@/lib/identity";
export async function connectEmailLogin(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { user, client } = await getAccess();
  if (!getConfig().email)
    return { error: "Вход по email временно недоступен." };
  const input = emailLoginInput(form);
  if (input.error) return { error: input.error };
  let linked = false;
  let next = "/account?notice=email_linked";
  try {
    if (!(await allowAuthAttempt("email_link", input.email, user.id)))
      return { error: "Слишком много попыток. Повторите позже." };
    const admin = registrationAdmin();
    const fresh = await admin.auth.admin.getUserById(user.id);
    if (fresh.error || fresh.data.user?.id !== user.id)
      return { error: "Не удалось проверить аккаунт. Повторите попытку." };
    const result = await attachEmailLogin(fresh.data.user, input, (id, attrs) =>
      admin.auth.admin.updateUserById(id, attrs),
    );
    if (result.error) return { error: result.error };
    linked = true;
    // Admin password updates revoke old Auth sessions. Establish a fresh session
    // for exactly the same account without requiring Telegram again.
    const signed = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (signed.error || signed.data.user?.id !== user.id) {
      if (signed.data.session) await client.auth.signOut({ scope: "local" });
      next = "/login?notice=email_linked";
    }
  } catch {
    if (!linked)
      return {
        error: "Не удалось подключить вход по email. Повторите попытку позже.",
      };
    next = "/login?notice=email_linked";
  }
  revalidatePath("/", "layout");
  redirect(next);
}
