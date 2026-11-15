export type EmailLoginAccount = {
  id: string;
  email?: string;
  identities?: { provider: string }[];
  user_metadata?: Record<string, unknown>;
};
export function canAttachEmailLogin(user: EmailLoginAccount) {
  return Boolean(
    user.identities?.length &&
    user.identities.every((i) => i.provider === "custom:telegram"),
  );
}
export function emailLoginInput(form: FormData) {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");
  const error =
    email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? "Укажите корректный email."
      : password.length < 12 || password.length > 128
        ? "Пароль должен содержать от 12 до 128 символов."
        : password !== form.get("confirmation")
          ? "Пароли не совпадают."
          : form.get("confirm") !== "on"
            ? "Подтвердите подключение входа к текущему аккаунту."
            : null;
  return { email, password, error };
}
/** The account ID comes exclusively from the verified session, never from the form. */
export async function attachEmailLogin(
  user: EmailLoginAccount,
  input: ReturnType<typeof emailLoginInput>,
  update: (
    id: string,
    attributes: {
      email: string;
      password: string;
      email_confirm: true;
      user_metadata: Record<string, unknown>;
    },
  ) => Promise<{ data: { user: EmailLoginAccount | null }; error: unknown }>,
) {
  if (input.error) return { error: input.error };
  if (!canAttachEmailLogin(user))
    return {
      error:
        "Вход по email уже подключён или для аккаунта используется другой способ входа. Изменить пароль можно в личном кабинете.",
    };
  const { data, error } = await update(user.id, {
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      ...user.user_metadata,
      email_ownership_verified: false,
      email_login_linked_at: new Date().toISOString(),
    },
  });
  if (
    error ||
    data.user?.id !== user.id ||
    data.user.email?.toLowerCase() !== input.email
  )
    return {
      error:
        "Не удалось подключить email. Возможно, адрес уже занят. Аккаунты не объединяются; используйте другой адрес или обратитесь к администратору.",
    };
  return { success: true };
}
