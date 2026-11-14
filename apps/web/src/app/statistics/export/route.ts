import { loadCommandReport } from "@/lib/command-report";
import { csv } from "@/lib/csv";
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams),
    result = await loadCommandReport(params);
  const headers = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="xd-statistics.csv"',
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (result.error || !result.summary)
    return new Response(result.error ?? "Отчёт недоступен", {
      status: 400,
      headers,
    });
  const rows = result.summary.rows.filter(
    (r) =>
      (!params.q ||
        r.nickname
          .toLocaleLowerCase("ru")
          .includes(params.q.toLocaleLowerCase("ru"))) &&
      (!params.class || r.characterClass === params.class),
  );
  return new Response(
    csv([
      [
        "Участник",
        "Класс",
        "Посещено",
        "Доступно",
        "Общая %",
        "Прайм %",
        "Мини-РБ %",
        "PvP",
      ],
      ...rows.map((r) => [
        r.nickname,
        r.characterClass,
        r.present,
        r.available,
        r.percentage,
        r.prime,
        r.mini,
        r.pvp,
      ]),
    ]),
    { headers },
  );
}
