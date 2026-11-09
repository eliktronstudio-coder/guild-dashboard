"use server";
import { checkOrigin, field } from "@/lib/mutations";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getConfig } from "@/lib/config";
import {
  loginError,
  normalizeLogin,
  registrationInput,
} from "@/lib/registration";
import { allowAuthAttempt, registrationAdmin } from "@/lib/registration-server";
import { getAccess, requirePermission } from "@/lib/access";
import {
  nicknameError,
  normalizeNickname,
  messageFor,
  type FormState,
} from "@/lib/identity";

export async function login(_: FormState, form: FormData): Promise<FormState> {
  await checkOrigin();
  if (!getConfig().email) return { error: "Вход по почте пока не подключён." };
  const failure = {
    error: "Не удалось войти. Проверьте email или логин и пароль.",
  };
  const identifier =
    field(form, "identifier").trim() || field(form, "email").trim();
  if (
    !identifier ||
    identifier.length > 254 ||
    !field(form, "password") ||
    field(form, "password").length > 128
  )
    return failure;
  let email = identifier.toLowerCase();
  try {
    if (!(await allowAuthAttempt("login")))
      return {
        error: "Слишком много попыток входа. Повторите через 10 минут.",
      };
    if (!identifier.includes("@")) {
      const name = normalizeLogin(identifier);
      if (loginError(name)) return failure;
      const result = await registrationAdmin().rpc("registration_login_email", {
        p_login: name,
      });
      if (result.error) return failure;
      // An unknown login takes the same password-auth path and reveals no account data.
      email = result.data || "unknown-login@invalid.example";
    }
    const client = await createClient();
    const { error } = await client.auth.signInWithPassword({
      email,
      password: field(form, "password"),
    });
    if (error) return failure;
  } catch {
    return failure;
  }
  redirect("/onboarding");
}
export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  await checkOrigin();
  if (!getConfig().email) return { error: "Регистрация временно недоступна." };
  const input = registrationInput(form);
  if (input.error) return { error: input.error };
  try {
    if (!(await allowAuthAttempt("signup", input.email)))
      return {
        error: "Слишком много попыток регистрации. Повторите через час.",
      };
    // Open registration intentionally does not send or require an email confirmation.
    // createUser never updates or links an existing email account.
    const { error } = await registrationAdmin().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        registration_flow: "open_email_v1",
        login: input.login,
        game_nickname: input.nickname,
        rules_accepted: true,
        privacy_accepted: true,
        email_ownership_verified: false,
      },
    });
    if (error)
      return {
        error:
          "Не удалось создать аккаунт. Возможно, email или логин уже занят. Попробуйте войти или выберите другой логин.",
      };
    const client = await createClient();
    const result = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (result.error)
      return {
        success:
          "Аккаунт создан. Перейдите ко входу и используйте email или логин и свой пароль.",
      };
  } catch {
    return { error: "Регистрация временно недоступна. Повторите позже." };
  }
  redirect("/onboarding");
}
export async function completeRegistration(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await getAccess();
  const login = normalizeLogin(field(form, "login")),
    nickname = normalizeNickname(field(form, "nickname"));
  const error = loginError(login) ?? nicknameError(nickname);
  if (error) return { error };
  const result = await client.rpc("complete_open_registration", {
    p_login: login,
    p_nickname: nickname,
    p_rules: form.get("rules") === "on",
    p_privacy: form.get("privacy") === "on",
  });
  if (result.error)
    return {
      error:
        result.error.code === "23505"
          ? "Этот логин уже занят. Выберите другой."
          : messageFor(result.error),
    };
  revalidatePath("/members");
  redirect("/dashboard");
}
export async function telegramLogin(): Promise<void> {
  await checkOrigin();
  const c = getConfig();
  if (!c.telegram || !/^custom:[a-z0-9-]+$/.test(c.telegramProvider))
    redirect("/login?notice=provider");
  const client = await createClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: c.telegramProvider as `custom:${string}`,
    options: {
      redirectTo: `${c.origin}/auth/callback`,
      scopes: "openid profile",
    },
  });
  if (error || !data.url) redirect("/login?notice=provider");
  redirect(data.url);
}
export async function submitApplication(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await getAccess();
  const nickname = normalizeNickname(field(form, "nickname"));
  const error = nicknameError(nickname);
  if (error) return { error };
  const { error: dbError } = await client.rpc("submit_application", {
    nickname,
    rules_accepted: form.get("rules") === "on",
    privacy_accepted: form.get("privacy") === "on",
  });
  if (dbError) return { error: messageFor(dbError) };
  revalidatePath("/application");
  redirect("/application");
}
export async function reviewApplication(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client } = await requirePermission("applications.review");
  if (form.get("confirm") !== "on")
    return { error: "Подтвердите, что проверили игрока." };
  const { error } = await client.rpc("review_application", {
    application_id: field(form, "applicationId"),
    decision: field(form, "decision"),
    reason: field(form, "reason").trim(),
  });
  if (error) return { error: messageFor(error) };
  revalidatePath("/admin");
  revalidatePath("/members");
  return { success: "Решение сохранено." };
}
export async function manageMember(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const action = field(form, "action");
  const { client } = await requirePermission(
    action === "role" ? "roles.assign" : "members.manage",
  );
  if (form.get("confirm") !== "on") return { error: "Подтвердите изменение." };
  const { error } =
    action === "role"
      ? await client.rpc("assign_member_role", {
          member_id: field(form, "memberId"),
          role_code: field(form, "role"),
        })
      : await client.rpc("set_member_blocked", {
          member_id: field(form, "memberId"),
          blocked: field(form, "blocked") === "true",
        });
  if (error) return { error: messageFor(error) };
  revalidatePath("/members");
  revalidatePath(`/members/${field(form, "memberId")}`);
  revalidatePath("/admin");
  return { success: "Изменение сохранено." };
}
export async function signOut(form: FormData) {
  await checkOrigin();
  if (!getConfig().configured) redirect("/login");
  const client = await createClient();
  const all = field(form, "scope") === "global";
  if (all && form.get("confirm") !== "on") redirect("/account");
  // Revoke in the application DB before dropping cookies, so an old access JWT is denied.
  const { error } = await client.rpc("revoke_my_sessions", {
    all_sessions: all,
  });
  if (error && all) redirect("/account?notice=revoke_failed");
  await client.auth.signOut({ scope: all ? "global" : "local" });
  redirect("/login");
}
export async function forgotPassword(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const c = getConfig();
  if (!c.email || !c.emailDelivery)
    return { error: "Восстановление по почте пока не подключено." };
  const client = await createClient();
  const { error } = await client.auth.resetPasswordForEmail(
    field(form, "email").trim(),
    { redirectTo: `${c.origin}/auth/callback?next=/account/password` },
  );
  if (error)
    return {
      error: "Сервис отправки писем сейчас недоступен. Повторите позже.",
    };
  return {
    success:
      "Если такой адрес зарегистрирован, вы получите письмо для восстановления доступа.",
  };
}
export async function updatePassword(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await checkOrigin();
  const { client, user } = await getAccess();
  if (!getConfig().email || !user.email)
    return { error: "Для аккаунта не подключён вход по почте." };
  const { data: claimsData } = await client.auth.getClaims();
  const amr = claimsData?.claims.amr as
    Array<{ timestamp: number }> | undefined;
  if (!amr?.some((item) => item.timestamp * 1000 > Date.now() - 10 * 60 * 1000))
    return {
      error:
        "Для изменения пароля войдите заново или откройте свежую ссылку восстановления.",
    };
  const password = field(form, "password");
  if (
    password.length < 12 ||
    password.length > 128 ||
    password !== field(form, "confirmation")
  )
    return {
      error: "Пароли должны совпадать и содержать от 12 до 128 символов.",
    };
  const { error } = await client.auth.updateUser({ password });
  if (error)
    return {
      error:
        "Не удалось изменить пароль. Откройте свежую ссылку восстановления или войдите заново.",
    };
  const { error: revokeError } = await client.rpc("revoke_my_sessions", {
    all_sessions: true,
  });
  await client.auth.signOut({ scope: "global" });
  redirect(
    revokeError ? "/login?notice=password_sessions" : "/login?notice=password",
  );
}
