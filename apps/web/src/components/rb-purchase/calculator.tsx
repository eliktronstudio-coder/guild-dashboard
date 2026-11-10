"use client";
import { useState } from "react";
import {
  allocateRbExperience,
  formatRbExperience,
  miniAttendance,
  parseRbExperience,
  type RbParticipant,
} from "@/lib/rb-purchase";
export function RbPurchaseCalculator({
  participants,
}: {
  participants: RbParticipant[];
}) {
  const [experience, setExperience] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [search, setSearch] = useState("");
  const total = parseRbExperience(experience),
    chosen = participants.filter((p) => selected.has(p.id));
  const allocation =
    total && chosen.length ? allocateRbExperience(total, chosen) : [];
  const byMember = new Map(allocation.map((row) => [row.id, row]));
  const query = search.trim().toLocaleLowerCase("ru-RU"),
    visible = participants.filter((p) =>
      p.nickname.toLocaleLowerCase("ru-RU").includes(query),
    );
  const sumWeight = chosen.reduce((sum, p) => sum + p.attendance_tenths, 0);
  return (
    <div className="rb-purchase-grid">
      <section className="panel section-panel">
        <h2>Опыт и состав</h2>
        <label className="form-stack">
          Опыт РБ, ед.
          <input
            name="rbExperience"
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            inputMode="numeric"
            maxLength={32}
            placeholder="Например, 100000"
            aria-describedby="rb-experience-help"
            aria-invalid={!!experience && total === null}
          />
        </label>
        <p id="rb-experience-help" className="caption">
          Введите целое число от 1 до 1 000 000 000 000 000 000. Весь опыт
          распределяется между выбранными участниками.
        </p>
        {!!experience && total === null && (
          <p className="notice error" role="alert">
            Укажите положительное целое количество опыта в пределах указанного
            диапазона.
          </p>
        )}
        <h3>Участники с посещаемостью Мини РБ от 20%</h3>
        <p className="caption">
          Отмечайте галочками участников покупки. Посещаемость учитывает
          подтверждённые активности расчётного периода.
        </p>
        {participants.length > 0 ? (
          <>
            <label className="form-stack">
              Поиск по нику
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Найти участника"
              />
            </label>
            <div className="filter-actions">
              <button
                type="button"
                className="button secondary inline"
                onClick={() =>
                  setSelected(new Set(participants.map((p) => p.id)))
                }
              >
                Выбрать всех
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setSelected(new Set())}
                disabled={!selected.size}
              >
                Снять выбор
              </button>
            </div>
            <p className="caption">
              Допущено: {participants.length} · Выбрано: {chosen.length}
            </p>
            <fieldset className="rb-candidate-list">
              <legend className="sr-only">Состав покупки РБ</legend>
              {visible.map((p) => (
                <label key={p.id} className="rb-candidate">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (checked) next.add(p.id);
                        else next.delete(p.id);
                        return next;
                      });
                    }}
                  />
                  <span>{p.nickname}</span>
                  <strong>{miniAttendance(p.attendance_tenths)}</strong>
                </label>
              ))}
              {!visible.length && <p>Участники по этому нику не найдены.</p>}
            </fieldset>
          </>
        ) : (
          <p className="empty-state">
            За этот период нет участников с посещаемостью Мини РБ от 20%.
          </p>
        )}
      </section>
      <section
        className="panel section-panel"
        aria-labelledby="rb-breakdown-title"
      >
        <h2 id="rb-breakdown-title">Разбивка по участникам</h2>
        <p>
          Доля опыта = посещаемость участника в Мини РБ ÷ сумма посещаемости
          выбранных участников.
        </p>
        <p className="caption">
          Округление — до целых единиц; остаток распределяется по наибольшим
          дробным частям. Итог равен введённому опыту.
        </p>
        {!chosen.length ? (
          <p className="empty-state">
            Выберите участников слева — они появятся в разбивке.
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="rb-breakdown">
                <thead>
                  <tr>
                    <th>Участник</th>
                    <th>Мини РБ</th>
                    <th>Доля опыта</th>
                    <th>Опыт, ед.</th>
                  </tr>
                </thead>
                <tbody>
                  {chosen.map((p) => {
                    const row = byMember.get(p.id);
                    return (
                      <tr key={p.id}>
                        <td>{p.nickname}</td>
                        <td>{miniAttendance(p.attendance_tenths)}</td>
                        <td>
                          {(
                            (p.attendance_tenths * 100) /
                            sumWeight
                          ).toLocaleString("ru-RU", {
                            maximumFractionDigits: 2,
                          })}
                          %
                        </td>
                        <td>
                          <strong>
                            {row ? formatRbExperience(row.units) : "—"}
                          </strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="rb-result" role="status">
              Распределено:{" "}
              <strong>
                {allocation.length
                  ? formatRbExperience(
                      allocation.reduce((sum, p) => sum + p.units, 0n),
                    )
                  : "—"}
              </strong>
              {total ? ` из ${formatRbExperience(total)} ед.` : " ед."}
            </p>
            {!total && (
              <p className="muted">
                Введите опыт РБ для расчёта количества единиц.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
