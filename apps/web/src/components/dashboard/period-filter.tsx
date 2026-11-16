import { PERIOD_CLOSING_ENABLED } from "@/lib/config";
import type { DashboardPeriod } from "@/lib/dashboard";
export function PeriodFilter({
  range,
  category = "",
  detailed = false,
}: {
  range: DashboardPeriod;
  category?: string;
  detailed?: boolean;
}) {
  return (
    <form method="get" className="panel section-panel command-filters">
      {PERIOD_CLOSING_ENABLED && (
        <label>
          Расчётный период
          <select name="period" defaultValue={range.period}>
            <option value="current">Текущий · 15 → 15</option>
            <option value="previous">Предыдущий · 15 → 15</option>
            <option value="7">Последние 7 дней</option>
            <option value="30">Последние 30 дней</option>
            <option value="week">Эта неделя</option>
            <option value="month">Календарный месяц</option>
            <option value="custom">Произвольный диапазон</option>
          </select>
        </label>
      )}
      {detailed && (
        <label>
          Категория посещаемости
          <select name="category" defaultValue={category}>
            <option value="">Все активности</option>
            {["Прайм", "Мини-РБ", "PvE", "PvP"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      )}
      {PERIOD_CLOSING_ENABLED && (
        <>
          <label>
            С даты
            <input name="from" type="date" defaultValue={range.from} />
          </label>
          <label>
            По дату
            <input name="to" type="date" defaultValue={range.to} />
          </label>
        </>
      )}
      <button className="button primary">Показать</button>
      <p className="caption">
        {PERIOD_CLOSING_ENABLED
          ? "Свои даты используются при выборе произвольного диапазона. Время UTC."
          : "Посещаемость по всем сохранённым активностям, без ограничения по датам."}
      </p>
    </form>
  );
}
