import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { PublicFrame } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { completeRegistration, signOut } from "@/app/actions";
import { messageFor } from "@/lib/identity";
export const metadata = { title: "Завершение регистрации" };
export default async function Page() {
  const { client, user, membership } = await getAccess();
  if (membership?.status === "active") redirect("/dashboard");
  const { error } = await client.rpc("complete_open_registration");
  if (!error) redirect("/dashboard");
  const enrollmentError =
    error.message === "CONSENT_REQUIRED" ? null : messageFor(error);
  return (
    <PublicFrame
      title={"Станьте частью\nнашей истории"}
      subtitle="За каждым ником — человек, с которым мы разделяем приключения."
    >
      <p className="eyebrow">ИГРОВОЙ ПРОФИЛЬ</p>
      <h2>Как вас зовут в игре?</h2>
      <p className="muted">
        Укажите логин и основной ник в ArcheAge. Доступ откроется сразу после
        сохранения.
      </p>
      {enrollmentError && (
        <p className="notice error" role="alert">
          {enrollmentError}
        </p>
      )}
      <ActionForm action={completeRegistration} label="Завершить регистрацию">
        <label>
          Логин
          <input
            name="login"
            required
            minLength={3}
            maxLength={32}
            autoComplete="username"
            defaultValue={user.user_metadata?.login ?? ""}
            placeholder="Например, dragon_xd"
          />
        </label>
        <p className="caption">
          Латинские буквы, цифры, точка, дефис и подчёркивание. Начните с буквы.
        </p>
        <label>
          Игровой ник <span className="required">*</span>
          <input
            name="nickname"
            required
            minLength={2}
            maxLength={32}
            defaultValue={user.user_metadata?.game_nickname ?? ""}
            autoComplete="off"
            placeholder="Ваш ник в ArcheAge"
            aria-describedby="nickname-help"
          />
        </label>
        <p id="nickname-help" className="caption">
          2–32 символа. Русские или латинские буквы, цифры, пробел, дефис и
          подчёркивание. Не смешивайте алфавиты.
        </p>
        <label className="check">
          <input type="checkbox" name="rules" required />
          <span>
            Принимаю{" "}
            <Link href="/rules" target="_blank">
              правила гильдии
            </Link>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" name="privacy" required />
          <span>
            Согласен на{" "}
            <Link href="/privacy" target="_blank">
              обработку необходимых данных
            </Link>
          </span>
        </label>
      </ActionForm>
      <p className="caption auth-foot">
        Одобрение администратора не требуется.
      </p>
      <form action={signOut}>
        <button className="text-button">Выйти из аккаунта</button>
      </form>
    </PublicFrame>
  );
}
