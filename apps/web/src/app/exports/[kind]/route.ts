import { requireMember } from "@/lib/access";
import { monthRange } from "@/lib/events";
import { csv } from "@/lib/csv";
const columns = {
  members: [
    ["nickname", "Ник"],
    ["joined_at", "Вступление UTC"],
    ["main_character", "Персонаж"],
    ["character_class", "Класс"],
    ["specialization", "Специализация"],
    ["game_server", "Сервер"],
    ["role_names", "Роли"],
  ],
  attendance: [
    ["nickname", "Ник"],
    ["present", "Присутствовал"],
    ["absent", "Отсутствовал"],
    ["excused", "Уважительная причина"],
    ["excluded", "Не учитывается"],
    ["percentage", "Посещаемость %"],
  ],
};
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (kind !== "members" && kind !== "attendance")
    return new Response("Not found", { status: 404, headers });
  const a = await requireMember();
  const month = new URL(request.url).searchParams.get("month");
  if (
    kind === "attendance" &&
    (!month || !/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(month))
  )
    return new Response("Укажите месяц YYYY-MM", { status: 400, headers });
  const range = monthRange(month ?? undefined);
  const { data, error } = await a.client.rpc("guild_export", {
    p_kind: kind,
    p_from: kind === "attendance" ? range.from : null,
    p_until: kind === "attendance" ? range.until : null,
  });
  if (error)
    return new Response(
      error.message === "FORBIDDEN"
        ? "Нет доступа"
        : "Не удалось сформировать полный экспорт. Попробуйте позже или обратитесь к администратору.",
      { status: error.message === "FORBIDDEN" ? 403 : 503, headers },
    );
  const rows = data as Record<string, unknown>[];
  if (!Array.isArray(rows))
    return new Response("Сервис недоступен", { status: 503, headers });
  const fields = columns[kind];
  return new Response(
    csv([
      fields.map((x) => x[1]),
      ...rows.map((r) => fields.map((x) => r[x[0]])),
    ]),
    {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="xd-${kind}${kind === "attendance" ? "-" + range.month : ""}.csv"`,
      },
    },
  );
}
