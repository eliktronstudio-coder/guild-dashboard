import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { PublicFrame } from "@/components/shell";
import { signOut } from "@/app/actions";
export const metadata = { title: "Статус заявки" };
export default async function Page() {
  const { client, user, membership } = await getAccess();
  if (membership?.status === "active") redirect("/dashboard");
  const { data, error } = await client
    .from("applications")
    .select("nickname,status,reason,created_at")
    .eq("guild_id", GUILD_ID)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) redirect("/setup?problem=database");
  if (!data) redirect("/onboarding");
  const pending = data.status === "pending";
  return (
    <PublicFrame
      title={"До встречи\nпо ту сторону гавани"}
      subtitle="Ваш аккаунт подтверждён. Осталось решение администрации."
    >
      <p className="eyebrow">ШАГ 3 ИЗ 3 · ПРОВЕРКА ЗАЯВКИ</p>
      <span className={`badge ${pending ? "gold" : "red"}`}>
        {pending ? "Ожидает подтверждения" : "Заявка отклонена"}
      </span>
      <h2>{data.nickname}</h2>
      <p className="muted">
        {pending
          ? "Администратор проверит игровой ник и примет решение. Повторно отправлять заявку не нужно."
          : "Администрация не одобрила заявку. Уточните данные и причину отказа перед повторной отправкой."}
      </p>
      {data.reason && <p className="notice">{data.reason}</p>}
      <Link
        className="button primary"
        href={pending ? "/application" : "/onboarding"}
      >
        {pending ? "Проверить статус" : "Подать новую заявку"}
        <span>↗</span>
      </Link>
      <form action={signOut}>
        <button className="text-button">Выйти из аккаунта</button>
      </form>
    </PublicFrame>
  );
}
