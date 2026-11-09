import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { CatalogPhotoInput } from "@/components/catalog-photo-input";
import { formatGold, goldInput } from "@/lib/treasury";
import { saveDrop, deleteDrop } from "./actions";
export const metadata = { title: "Реестр дропа" };
type Entry = {
  id: string;
  name: string;
  photo: string;
  price_units: string;
  version: number;
};
function Fields({ entry }: { entry: Entry }) {
  return (
    <>
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="version" value={entry.version} />
      <label>
        Название дропа
        <input name="name" required maxLength={120} defaultValue={entry.name} />
      </label>
      <label>
        Фото дропа (PNG, JPEG, WebP, до 10 МБ)
        <CatalogPhotoInput />
      </label>
      {entry.photo && (
        <label className="check">
          <input type="checkbox" name="removePhoto" />
          Удалить фото
        </label>
      )}
      <label>
        Цена за единицу, золото
        <input
          name="price"
          inputMode="decimal"
          required
          maxLength={16}
          defaultValue={goldInput(entry.price_units)}
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
  const enabled = await a.permission("drops.manage");
  const params = await searchParams;
  const page = Math.max(1, Math.min(10000, parseInt(params.page ?? "1") || 1));
  const q = (params.q ?? "").trim().slice(0, 120);
  let query = a.client
    .from("guild_drop_registry")
    .select("id,name,photo,price_units::text,version", { count: "exact" })
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
    `/admin/drops?${new URLSearchParams({ q, page: String(p) })}`;
  return (
    <GuildShell current="/admin">
      <Link href="/admin">← Управление гильдией</Link>
      <div className="page-heading">
        <p className="eyebrow">XD · АДМИНИСТРАТОР</p>
        <h1>Реестр дропа</h1>
        <p className="muted">
          Фото, название и справочная цена за единицу. Изменения не
          пересчитывают уже записанные продажи и выплаты.
        </p>
      </div>
      {!ready ? (
        <section className="panel section-panel">
          <h2>Реестр ожидает настройки базы</h2>
          <p>
            Для включения реестра нужно применить миграцию
            202611090019_drop_registry.sql в Supabase. Существующие данные не
            меняются.
          </p>
        </section>
      ) : (
        <>
          <section className="panel section-panel">
            <details>
              <summary>Добавить дроп</summary>
              <ActionForm action={saveDrop} label="Добавить дроп">
                <Fields
                  entry={{
                    id: randomUUID(),
                    name: "",
                    photo: "",
                    price_units: "0",
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
            {q && <Link href="/admin/drops">Сбросить</Link>}
          </form>
          <p className="muted">Найдено: {result?.count ?? 0}</p>
          {entries.map((entry) => (
            <article className="panel section-panel" key={entry.id}>
              <div className="catalog-heading">
                {entry.photo ? (
                  <img
                    src={entry.photo}
                    width={100}
                    height={100}
                    className="catalog-photo"
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
                  <p>{formatGold(entry.price_units)} зол. / шт.</p>
                </div>
              </div>
              <details>
                <summary>Редактировать</summary>
                <ActionForm
                  action={saveDrop}
                  revision={entry.version}
                  label="Сохранить"
                >
                  <Fields entry={entry} />
                </ActionForm>
              </details>
              <details>
                <summary>Удалить</summary>
                <ActionForm
                  action={deleteDrop}
                  revision={entry.version}
                  label="Удалить дроп"
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
                : "Реестр пуст. Добавьте первый дроп."}
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
