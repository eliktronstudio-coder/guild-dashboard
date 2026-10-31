import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { PublicFrame } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { submitApplication, signOut } from "@/app/actions";
import { GUILD_ID } from "@/lib/config";
export const metadata = { title: "Заявка в гильдию" };
export default async function Page() {
  const { client, user, membership } = await getAccess();
  if (membership?.status === "active") redirect("/dashboard");
  const { data, error } = await client
    .from("applications")
    .select("id")
    .eq("guild_id", GUILD_ID)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();
  if (error) redirect("/setup?problem=database");
  if (data) redirect("/application");
  return (
    <PublicFrame
      title={"Станьте частью\nнашей истории"}
      subtitle="За каждым ником — человек, с которым мы разделяем приключения."
    >
      <p className="eyebrow">ШАГ 2 ИЗ 3 · ИГРОВОЙ ПРОФИЛЬ</p>
      <h2>Как вас зовут в игре?</h2>
      <p className="muted">
        Укажите основной ник в ArcheAge. Его увидит администрация при
        рассмотрении заявки.
      </p>
      <ActionForm action={submitApplication} label="Отправить заявку">
        <label>
          Игровой ник <span className="required">*</span>
          <input
            name="nickname"
            required
            minLength={2}
            maxLength={64}
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
        Отправка заявки не открывает доступ автоматически.
      </p>
      <form action={signOut}>
        <button className="text-button">Выйти из аккаунта</button>
      </form>
    </PublicFrame>
  );
}
