import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { CatalogPhotoInput } from "@/components/catalog-photo-input";
import { weightLabel } from "@/lib/catalog";
import { saveActivityBanner, deleteActivityBanner } from "./actions";
export const metadata = { title: "Баннеры активностей" };
type Entry = {
  id: string;
  name: string;
  photo: string;
  weight: number;
  version: number;
};
function Fields({ entry }: { entry: Entry }) {
  return (
    <>
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="version" value={entry.version} />
      <label>
        Название активности
        <input name="name" required maxLength={120} defaultValue={entry.name} />
      </label>
      <label>
        Фото активности (PNG, JPEG, WebP, до 10 МБ)
        <CatalogPhotoInput banner />
      </label>
      {entry.photo && (
        <label className="check">
          <input type="checkbox" name="removePhoto" />
          Удалить фото
        </label>
      )}
      <label>
        Коэффициент активности (0,01–1000)
        <input
          name="weight"
          inputMode="decimal"
          required
          maxLength={16}
          defaultValue={String(entry.weight / 100)}
        />
      </label>
    </>
  );
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const a = await requirePermission("members.manage");
  const enabled = await a.permission("activity_banners.manage");
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, parseInt(params.page ?? "1") || 1));
  const q = (params.q ?? "").trim().slice(0, 120);
  let query = a.client
    .from("guild_activity_banners")
    .select("id,name,photo,weight,version", { count: "exact" })
    .eq("guild_id", GUILD_ID);
  if (q) query = query.ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  const result = enabled
    ? await query
        .order("name")
        .order("id")
        .range((page - 1) * 20, page * 20 - 1)
    : null;
  const ready = enabled && !result?.error;
  const entries = (result?.data ?? []) as Entry[];
  const href = (p: number) =>
    `/admin/activity-banners?${new URLSearchParams({ q, page: String(p) })}`;
  return (
    <GuildShell current="/admin">
      <Link href="/admin">← Управление гильдией</Link>
      <div className="page-heading">
        <p className="eyebrow">XD · АДМИНИСТРАТОР</p>
        <h1>Баннеры активностей</h1>
        <p className="muted">
          Фото, название и коэффициент активности. При выборе баннера в новом
          событии сохраняется его текущая версия.
        </p>
      </div>
      {!ready ? (
        <section className="panel section-panel">
          <h2>Баннеры ожидают настройки базы</h2>
          <p>
            Для включения реестра нужно применить миграцию
            202611090020_activity_banners.sql в Supabase. Существующие данные не
            меняются.
          </p>
        </section>
      ) : (
        <>
          <section className="panel section-panel">
            <details>
              <summary>Добавить активность</summary>
              <ActionForm
                action={saveActivityBanner}
                label="Добавить активность"
              >
                <Fields
                  entry={{
                    id: randomUUID(),
                    name: "",
                    photo: "",
                    weight: 100,
                    version: 0,
                  }}
                />
              </ActionForm>
            </details>
          </section>
          <form className="filter-bar" method="get">
            <label>
              Поиск по названию
              <input name="q" maxLength={120} defaultValue={q} />
            </label>
            <button className="button secondary" type="submit">
              Найти
            </button>
            {q && <Link href="/admin/activity-banners">Сбросить</Link>}
          </form>
          <p className="muted">Найдено: {result?.count ?? 0}</p>
          {entries.map((entry) => (
            <article className="panel section-panel" key={entry.id}>
              <div className="activity-banner-heading">
                {entry.photo ? (
                  <img
                    src={entry.photo}
                    width={480}
                    height={180}
                    className="activity-banner-preview"
                    alt={entry.name}
                  />
                ) : (
                  <span
                    className="catalog-photo catalog-placeholder"
                    aria-hidden="true"
                  >
                    ◇
                  </span>
                )}
                <div>
                  <h2>{entry.name}</h2>
                  <p>{weightLabel(entry.weight)} ×</p>
                </div>
              </div>
              <details>
                <summary>Редактировать</summary>
                <ActionForm
                  action={saveActivityBanner}
                  revision={entry.version}
                  label="Сохранить"
                >
                  <Fields entry={entry} />
                </ActionForm>
              </details>
              <details>
                <summary>Удалить</summary>
                <ActionForm
                  action={deleteActivityBanner}
                  revision={entry.version}
                  label="Удалить баннер"
                >
                  <input type="hidden" name="id" value={entry.id} />
                  <input type="hidden" name="version" value={entry.version} />
                  <p>Запись «{entry.name}» будет удалена из реестра.</p>
                  <label className="check">
                    <input type="checkbox" name="confirm" required />
                    Подтверждаю удаление
                  </label>
                </ActionForm>
              </details>
            </article>
          ))}
          {!entries.length && (
            <p className="panel section-panel">
              {q
                ? "По этому запросу ничего не найдено."
                : "Баннеров пока нет. Добавьте первую активность."}
            </p>
          )}
          <nav className="pagination" aria-label="Страницы реестра">
            {page > 1 && <Link href={href(page - 1)}>← Назад</Link>}
            <span>
              {page} / {Math.max(1, Math.ceil((result?.count ?? 0) / 20))}
            </span>
            {page * 20 < (result?.count ?? 0) && (
              <Link href={href(page + 1)}>Далее →</Link>
            )}
          </nav>
        </>
      )}
    </GuildShell>
  );
}
