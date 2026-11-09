import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { AVATAR_STYLES, isUuid, type Character } from "@/lib/members";
import { GuildShell } from "@/components/shell";
import { MemberAvatar } from "@/components/members/avatar";
import { ActionForm } from "@/components/action-form";
import {
  CharacterEditor,
  CharacterArchiveForm,
} from "@/components/members/character-editor";
import { AccessEditor } from "@/components/members/access-editor";
import { updateProfile, changeNickname } from "../actions";
export const metadata = { title: "Профиль участника" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ historyPage?: string }>;
}) {
  const a = await requireMember();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data: member, error } = await a.client
    .from("memberships")
    .select(
      "id,user_id,nickname,joined_at,status,about,avatar_style,profile_version,membership_roles(roles(code,name))",
    )
    .eq("guild_id", GUILD_ID)
    .eq("id", id)
    .maybeSingle();
  if (error) redirect("/setup?problem=database");
  if (!member) notFound();
  const [manage, assign] = await Promise.all([
    a.permission("members.manage"),
    a.permission("roles.assign"),
  ]);
  const roles = (member.membership_roles ?? []).flatMap((m) =>
    Array.isArray(m.roles) ? m.roles : m.roles ? [m.roles] : [],
  );
  const owner = roles.some((r) => r.code === "owner"),
    own = member.user_id === a.user.id;
  const canEdit = member.status === "active" && (own || (manage && !owner)),
    canHistory = own || manage;
  const { historyPage } = await searchParams;
  const hp = Math.max(
    1,
    Math.min(10000, Number.parseInt(historyPage ?? "1", 10) || 1),
  );
  const [characters, archived, history, profile] = await Promise.all([
    a.client
      .from("characters")
      .select(
        "id,name,game_server,character_class,specialization,is_main,archived_at,version",
      )
      .eq("guild_id", GUILD_ID)
      .eq("membership_id", id)
      .is("archived_at", null)
      .order("is_main", { ascending: false })
      .order("created_at")
      .order("id")
      .limit(20),
    canEdit
      ? a.client
          .from("characters")
          .select("id,name,archived_at")
          .eq("guild_id", GUILD_ID)
          .eq("membership_id", id)
          .not("archived_at", "is", null)
          .order("archived_at", { ascending: false })
          .limit(20)
      : null,
    canHistory
      ? a.client
          .from("nickname_history")
          .select("id,old_nickname,new_nickname,reason,changed_at", {
            count: "exact",
          })
          .eq("guild_id", GUILD_ID)
          .eq("membership_id", id)
          .order("id", { ascending: false })
          .range((hp - 1) * 20, hp * 20 - 1)
      : null,
    manage
      ? a.client
          .from("profiles")
          .select("blocked")
          .eq("id", member.user_id)
          .maybeSingle()
      : null,
  ]);
  if (characters.error || archived?.error || history?.error || profile?.error)
    redirect("/setup?problem=database");
  const list = (characters.data ?? []) as Character[];
  const activeMain = list.find((c) => c.is_main);
  const historyPages = Math.max(1, Math.ceil((history?.count ?? 0) / 20));
  if (canHistory && hp > historyPages)
    redirect(`/members/${id}?historyPage=${historyPages}#nickname-history`);
  return (
    <GuildShell current="/members">
      <nav className="form-links">
        <Link href={"/statistics?q=" + encodeURIComponent(member.nickname)}>
          Посещаемость и статистика →
        </Link>
        <Link href="/treasury#settlements">Начисления и выплаты →</Link>
      </nav>
      <Link href="/members" className="text-button">
        ← Состав гильдии
      </Link>
      <section className="panel section-panel profile-header">
        <MemberAvatar
          nickname={member.nickname}
          style={member.avatar_style}
          large
        />
        <div>
          <p className="eyebrow">XD · ПРОФИЛЬ УЧАСТНИКА</p>
          <h1>{member.nickname}</h1>
          <p className="muted">
            {roles.map((r) => r.name).join(", ") || "Без роли"}
          </p>
          <div className="profile-badges">
            <span
              className={`badge ${member.status === "active" ? "green" : "gold"}`}
            >
              {member.status === "active" ? "В составе" : "Покинул гильдию"}
            </span>
            {profile?.data?.blocked && (
              <span className="badge red">Доступ заблокирован</span>
            )}
            <span className="caption">
              В гильдии с{" "}
              {new Date(member.joined_at).toLocaleDateString("ru-RU", {
                timeZone: "UTC",
              })}
            </span>
          </div>
        </div>
      </section>
      <div className="profile-overview">
        <section className="panel section-panel">
          <h2>Об участнике</h2>
          <p className="profile-about">
            {member.about || "Участник пока не добавил описание."}
          </p>
        </section>
        <section className="panel section-panel">
          <h2>Основной персонаж</h2>
          {activeMain ? (
            <>
              <h3>{activeMain.name}</h3>
              <p className="muted">
                {activeMain.character_class || "Класс не указан"} ·{" "}
                {activeMain.game_server || "Сервер не указан"}
              </p>
              <p className="caption">
                {activeMain.specialization || "Специализация не указана"}
              </p>
            </>
          ) : (
            <p className="muted">Персонажи ещё не добавлены.</p>
          )}
        </section>
      </div>
      <section className="panel section-panel">
        <div className="section-heading">
          <h2>
            Персонажи <span className="caption">{list.length}</span>
          </h2>
          {canEdit && list.length < 20 && (
            <a href="#add-character" className="text-button">
              Добавить ↓
            </a>
          )}
        </div>
        {list.length ? (
          <div className="characters-grid">
            {list.map((character) => (
              <article key={character.id} className="character-card">
                <div className="section-heading">
                  <h3>{character.name}</h3>
                  {character.is_main && (
                    <span className="badge gold">Основной</span>
                  )}
                </div>
                <dl className="character-details">
                  <dt>Сервер</dt>
                  <dd>{character.game_server || "Не указан"}</dd>
                  <dt>Класс</dt>
                  <dd>{character.character_class || "Не указан"}</dd>
                  <dt>Специализация</dt>
                  <dd>{character.specialization || "Не указана"}</dd>
                </dl>
                {canEdit && (
                  <>
                    <details>
                      <summary>Изменить персонажа</summary>
                      <CharacterEditor
                        memberId={id}
                        characterId={character.id}
                        character={character}
                      />
                    </details>
                    <details className="archive-control">
                      <summary>Перенести в архив</summary>
                      <CharacterArchiveForm
                        memberId={id}
                        character={character}
                      />
                    </details>
                  </>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>Приключение начинается с персонажа</h3>
            <p>
              {canEdit
                ? "Добавьте первого персонажа — он станет основным."
                : "Участник ещё не добавил персонажей."}
            </p>
          </div>
        )}
      </section>
      {canEdit && (
        <>
          <section id="add-character" className="panel section-panel">
            <h2>Добавить персонажа</h2>
            {list.length < 20 ? (
              <CharacterEditor
                key={randomUUID()}
                memberId={id}
                characterId={randomUUID()}
              />
            ) : (
              <p className="notice">
                Добавлено 20 активных персонажей. Чтобы добавить нового,
                перенесите неиспользуемого в архив.
              </p>
            )}
          </section>
          <details className="panel section-panel">
            <summary>Редактировать профиль</summary>
            <ActionForm
              revision={member.profile_version}
              action={updateProfile}
              label="Сохранить профиль"
            >
              <input type="hidden" name="memberId" value={id} />
              <input
                type="hidden"
                name="version"
                value={member.profile_version}
              />
              <label>
                Об участнике
                <textarea
                  name="about"
                  defaultValue={member.about}
                  maxLength={500}
                  rows={4}
                  placeholder="Игровые интересы и роль в гильдии"
                />
              </label>
              <label>
                Цвет аватара
                <select name="avatarStyle" defaultValue={member.avatar_style}>
                  {AVATAR_STYLES.map(([v, name]) => (
                    <option value={v} key={v}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="caption">
                Описание видно участникам с доступом к составу. Аватар пока
                использует первую букву игрового ника.
              </p>
            </ActionForm>
          </details>
          <details className="panel section-panel">
            <summary>Изменить игровой ник</summary>
            <ActionForm
              revision={member.profile_version}
              action={changeNickname}
              label="Изменить ник"
            >
              <input type="hidden" name="memberId" value={id} />
              <input
                type="hidden"
                name="version"
                value={member.profile_version}
              />
              <label>
                Новый игровой ник
                <input
                  name="nickname"
                  defaultValue={member.nickname}
                  minLength={2}
                  maxLength={32}
                  required
                  autoComplete="off"
                />
              </label>
              <label>
                Причина изменения
                <textarea
                  name="reason"
                  minLength={3}
                  maxLength={500}
                  required
                  rows={2}
                />
              </label>
              <label className="check">
                <input name="confirm" type="checkbox" required />
                <span>
                  Подтверждаю изменение ника. Прежний ник останется в истории и
                  станет доступен другим участникам.
                </span>
              </label>
            </ActionForm>
          </details>
          {!!archived?.data?.length && (
            <details className="panel section-panel">
              <summary>Архив персонажей · последние 20</summary>
              <ul className="audit-list">
                {archived.data.map((c) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong>
                    <time className="caption">
                      {new Date(c.archived_at).toLocaleString("ru-RU", {
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </time>
                  </li>
                ))}
              </ul>
              <p className="caption">
                Записи сохранены для истории; в составе эти персонажи не
                отображаются.
              </p>
            </details>
          )}
        </>
      )}
      {canHistory && (
        <section id="nickname-history" className="panel section-panel">
          <h2>История игровых ников</h2>
          <p className="caption">Видна владельцу профиля и администрации.</p>
          {history?.data?.length ? (
            <>
              <ul className="audit-list">
                {history.data.map((h) => (
                  <li key={h.id}>
                    <div>
                      <strong>
                        {h.old_nickname} → {h.new_nickname}
                      </strong>
                      <p className="caption">{h.reason}</p>
                    </div>
                    <time className="caption">
                      {new Date(h.changed_at).toLocaleString("ru-RU", {
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </time>
                  </li>
                ))}
              </ul>
              <nav className="pagination" aria-label="История ников">
                {hp > 1 && (
                  <Link
                    href={`/members/${id}?historyPage=${hp - 1}#nickname-history`}
                  >
                    ← Новее
                  </Link>
                )}
                <span>
                  {hp} / {historyPages}
                </span>
                {hp < historyPages && (
                  <Link
                    href={`/members/${id}?historyPage=${hp + 1}#nickname-history`}
                  >
                    Старее →
                  </Link>
                )}
              </nav>
            </>
          ) : (
            <p className="muted">Ник ещё не менялся.</p>
          )}
        </section>
      )}
      {manage && !owner && !own && (
        <AccessEditor
          memberId={id}
          blocked={profile?.data?.blocked ?? false}
          currentRole={roles[0]?.code ?? "member"}
          canAssign={assign}
        />
      )}
      <p className="caption">
        <Link href="/attendance">Отчёт посещаемости →</Link> История событий в
        профиле, начисления и выплаты появятся в следующих версиях.
      </p>
    </GuildShell>
  );
}
