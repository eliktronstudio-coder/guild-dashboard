import Link from "next/link";
import { requireMember } from "@/lib/access";
import { GuildShell } from "@/components/shell";
import { GUILD_ID } from "@/lib/config";
import { redirect } from "next/navigation";
export const metadata = { title: "Обзор гильдии" };
export default async function Page() {
  const { client, membership, permission } = await requireMember();
  const canRead = await permission("members.read"),
    canReview = await permission("applications.review");
  const members = canRead
    ? await client
        .from("memberships")
        .select("id", { head: true, count: "exact" })
        .eq("guild_id", GUILD_ID)
        .eq("status", "active")
    : null;
  const pending = canReview
    ? await client
        .from("applications")
        .select("id", { head: true, count: "exact" })
        .eq("guild_id", GUILD_ID)
        .eq("status", "pending")
    : null;
  if (members?.error || pending?.error) redirect("/setup?problem=database");
  return (
    <GuildShell current="/dashboard">
      <section className="welcome">
        <p className="eyebrow">XD / ХД · ОБЩИЙ ПУТЬ</p>
        <h1>
          Добро пожаловать,
          <br />
          <em>{membership!.nickname}</em>
        </h1>
        <p>
          Ваше место в гильдии. Люди, с которыми начинается каждое приключение.
        </p>
        <Link className="button primary inline" href="/members">
          К составу гильдии <span>↗</span>
        </Link>
      </section>
      <div className="stats-grid">
        <article className="panel stat">
          <p>Участников в составе</p>
          <strong>{members?.count ?? "—"}</strong>
          <span className="caption">
            {canRead
              ? "Принятые в гильдию аккаунты"
              : "Недостаточно прав для просмотра"}
          </span>
        </article>
        <article className="panel stat">
          <p>Ваш статус</p>
          <strong className="stat-word">В гильдии</strong>
          <span className="caption">
            С{" "}
            {new Date(membership!.joined_at).toLocaleDateString("ru-RU", {
              timeZone: "UTC",
            })}
          </span>
        </article>
        <article className="panel stat">
          <p>{canReview ? "Заявок на рассмотрении" : "Ваш профиль"}</p>
          <strong>{canReview ? (pending?.count ?? 0) : "XD"}</strong>
          <Link
            className="caption"
            href={canReview ? "/admin" : `/members/${membership!.id}`}
          >
            {canReview ? "Перейти к заявкам →" : "Открыть аккаунт →"}
          </Link>
        </article>
      </div>
      <section className="panel section-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">КОМАНДНЫЙ ЦЕНТР</p>
            <h2>Начинаем с людей</h2>
          </div>
          <span className="badge gold">Состав гильдии</span>
        </div>
        <p className="muted">
          Уже доступны заявки, профили игроков, персонажи и управление доступом.
          Дальше появятся события и казна.
        </p>
        <div className="module-grid">
          {[
            ["03", "Активности", "События и посещаемость"],
            ["04", "Казна", "Имущество, продажи и выплаты"],
          ].map(([n, title, text]) => (
            <div className="module" key={n}>
              <span className="eyebrow">СЛЕДУЮЩИЕ ЭТАПЫ · {n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
        <p className="caption">
          Статистика посещаемости и золота появится вместе с данными
          соответствующих модулей.
        </p>
      </section>
    </GuildShell>
  );
}
