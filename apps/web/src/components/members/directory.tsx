import Link from "next/link";
import type { DirectoryMember } from "@/lib/members";
import { MemberAvatar } from "./avatar";
const joined = (value: string) =>
  new Date(value).toLocaleDateString("ru-RU", { timeZone: "UTC" });
export function MemberDirectory({ members }: { members: DirectoryMember[] }) {
  return (
    <>
      <div className="table-wrap directory-desktop">
        <table>
          <caption className="sr-only">
            Участники гильдии и их основные персонажи
          </caption>
          <thead>
            <tr>
              <th>Участник</th>
              <th>Роль</th>
              <th>Основной персонаж</th>
              <th>Класс / сервер</th>
              <th>Вступил</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link className="member-name" href={`/members/${m.id}`}>
                    <MemberAvatar
                      nickname={m.nickname}
                      style={m.avatar_style}
                    />
                    <strong>{m.nickname}</strong>
                  </Link>
                </td>
                <td>{m.role_names.join(", ") || "Без роли"}</td>
                <td>
                  {m.main_character ?? <span className="muted">Не указан</span>}
                </td>
                <td>
                  <span>{m.character_class || "Не указан"}</span>
                  <p className="caption">
                    {m.game_server || "Сервер не указан"}
                  </p>
                </td>
                <td>{joined(m.joined_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="directory-mobile">
        {members.map((m) => (
          <article className="member-card" key={m.id}>
            <Link href={`/members/${m.id}`} className="member-card-link">
              <MemberAvatar nickname={m.nickname} style={m.avatar_style} />
              <div>
                <h2>{m.nickname}</h2>
                <p className="caption">
                  {m.role_names.join(", ") || "Без роли"}
                </p>
              </div>
              <span aria-hidden="true">↗</span>
            </Link>
            <dl>
              <dt>Персонаж</dt>
              <dd>{m.main_character || "Не указан"}</dd>
              <dt>Класс</dt>
              <dd>{m.character_class || "Не указан"}</dd>
              <dt>Сервер</dt>
              <dd>{m.game_server || "Не указан"}</dd>
              <dt>В гильдии с</dt>
              <dd>{joined(m.joined_at)}</dd>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
