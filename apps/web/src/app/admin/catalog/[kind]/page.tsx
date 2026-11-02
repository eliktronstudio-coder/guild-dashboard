import { CatalogPhotoInput } from "@/components/catalog-photo-input";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/access";
import { GUILD_ID } from "@/lib/config";
import { GuildShell } from "@/components/shell";
import { AdminTabs } from "@/components/admin-tabs";
import { ActionForm } from "@/components/action-form";
import { saveCatalog } from "../actions";
import { formatGold, goldInput } from "@/lib/treasury";
import { weightLabel } from "@/lib/catalog";
type Entry = {
  id: string;
  name: string;
  photo: string;
  price_units: string;
  weight: number;
  version: number;
  archived: boolean;
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ page?: string; archive?: string }>;
}) {
  const { kind } = await params;
  if (kind !== "loot" && kind !== "boss") notFound();
  const a = await requirePermission("catalog.manage");
  const p = await searchParams;
  const page = Math.max(1, Math.min(10000, parseInt(p.page ?? "1") || 1));
  const archive = p.archive === "1";
  const { data, error, count } = await a.client
    .from("guild_catalog")
    .select("id,name,photo,price_units::text,weight,version,archived", {
      count: "exact",
    })
    .eq("guild_id", GUILD_ID)
    .eq("kind", kind)
    .eq("archived", archive)
    .order("name")
    .order("id")
    .range((page - 1) * 20, page * 20 - 1);
  if (error) throw new Error("CATALOG_READ_FAILED");
  const url = `/admin/catalog/${kind}`;
  function fields(e: Entry) {
    return (
      <>
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="version" value={e.version} />
        <label>
          Название
          <input name="name" required maxLength={120} defaultValue={e.name} />
        </label>
        <label>
          Фото (PNG, JPEG, WebP, до 10 МБ)
          <CatalogPhotoInput />
        </label>
        {e.photo && (
          <label className="check">
            <input type="checkbox" name="removePhoto" />
            Удалить фото
          </label>
        )}
        {kind === "loot" ? (
          <label>
            Цена за единицу, золото
            <input
              name="price"
              inputMode="decimal"
              required
              defaultValue={goldInput(e.price_units)}
            />
          </label>
        ) : (
          <label>
            Коэффициент РБ (0,01–1000)
            <input
              name="weight"
              inputMode="decimal"
              required
              defaultValue={String(e.weight / 100)}
            />
          </label>
        )}
        {e.version > 0 && (
          <label className="check">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={e.archived}
            />
            В архиве
          </label>
        )}
      </>
    );
  }
  return (
    <GuildShell current="/admin">
      <AdminTabs current={url} />
      <div className="page-heading">
        <h1>{kind === "loot" ? "Список дропа" : "Рейд-боссы"}</h1>
        <p className="muted">
          {kind === "loot"
            ? "Справочная цена за один предмет. Фактическая сумма продажи записывается отдельно."
            : "Коэффициент задаёт вес события при распределении общего фонда. В событии сохраняется выбранное значение."}
        </p>
      </div>
      <section className="panel section-panel">
        <details>
          <summary>
            Добавить {kind === "loot" ? "предмет" : "рейд-босса"}
          </summary>
          <ActionForm action={saveCatalog} label="Добавить">
            {fields({
              id: randomUUID(),
              name: "",
              photo: "",
              price_units: "0",
              weight: 100,
              version: 0,
              archived: false,
            })}
          </ActionForm>
        </details>
      </section>
      <p>
        <Link href={`${url}?archive=${archive ? "0" : "1"}`}>
          {archive ? "Активные записи" : "Открыть архив"}
        </Link>
      </p>
      {((data as Entry[]) ?? []).map((e) => (
        <article className="panel section-panel" key={e.id}>
          <div className="catalog-heading">
            {e.photo ? (
              <img
                src={e.photo}
                width={50}
                height={50}
                className="catalog-photo"
                alt=""
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
              <h2>{e.name}</h2>
              <p>
                {kind === "loot"
                  ? `${formatGold(e.price_units)} зол. / шт.`
                  : `Коэффициент: ${weightLabel(e.weight)}`}
              </p>
            </div>
          </div>
          <details>
            <summary>Изменить</summary>
            <ActionForm
              action={saveCatalog}
              revision={e.version}
              label="Сохранить"
            >
              {fields(e)}
            </ActionForm>
          </details>
        </article>
      ))}
      {!data?.length && (
        <p className="panel section-panel">Записей пока нет.</p>
      )}
      <nav className="pagination" aria-label="Страницы справочника">
        {page > 1 && (
          <Link href={`${url}?page=${page - 1}&archive=${archive ? "1" : "0"}`}>
            ← Назад
          </Link>
        )}
        <span>
          {page} / {Math.max(1, Math.ceil((count ?? 0) / 20))}
        </span>
        {page * 20 < (count ?? 0) && (
          <Link href={`${url}?page=${page + 1}&archive=${archive ? "1" : "0"}`}>
            Далее →
          </Link>
        )}
      </nav>
    </GuildShell>
  );
}
