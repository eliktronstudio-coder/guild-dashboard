"use client";
import Link from "next/link";
import { useActionState, useId, useMemo, useState } from "react";
import { recordActivity, saveActivity } from "@/app/events/workspace-actions";
import { EvidenceInput } from "./evidence-input";
import {
  DIFFICULTIES,
  type ActivityDetail,
  type ActivityMember,
  type ActivityTemplate,
  type DropOption,
  type Evidence,
  type ActivityFacts,
} from "@/lib/activity-workspace";
import { formatGold, goldInput } from "@/lib/treasury";
import { resolveAttendanceFund } from "@/lib/activity-weights";
export function ActivityForm({
  templates,
  members,
  catalog,
  requestId,
  initial,
  canRoster,
  canTreasury,
  selectedBanner,
}: {
  templates: ActivityTemplate[];
  members: ActivityMember[];
  catalog: DropOption[];
  requestId: string;
  initial?: ActivityDetail;
  canRoster: boolean;
  canTreasury: boolean;
  selectedBanner?: string;
}) {
  const existing = initial?.event,
    selected = templates.find(
      (t) => t.id === (existing?.banner ?? selectedBanner),
    );
  const listId = useId();
  const [title, setTitle] = useState(existing?.title ?? selected?.name ?? ""),
    [banner, setBanner] = useState(selected?.id ?? ""),
    [source, setSource] = useState(
      existing?.source ??
        (selected && resolveAttendanceFund(selected.name, "PvE") === "Мини-РБ"
          ? "mini_rb"
          : "prime"),
    );
  const [kind, setKind] = useState(
      existing?.kind ??
        (selected?.name.toLowerCase().includes("алтарь") ? "pvp" : "raid"),
    ),
    [coefficient, setCoefficient] = useState(
      String((existing?.weight ?? selected?.weight ?? 100) / 100),
    ),
    [date, setDate] = useState(
      existing?.starts_at.slice(0, 16) ?? new Date().toISOString().slice(0, 16),
    );
  const [status, setStatus] = useState(existing?.status ?? "completed"),
    [difficulty, setDifficulty] = useState(
      initial?.report.difficulty ?? "normal",
    ),
    [night, setNight] = useState(initial?.report.night ?? false),
    [reward, setReward] = useState(
      goldInput(initial?.report.reward_units ?? "0"),
    );
  const [chosen, setChosen] = useState<string[]>(
      initial?.selected_members ?? [],
    ),
    [memberSearch, setMemberSearch] = useState(""),
    [dropSearch, setDropSearch] = useState(""),
    [dropSelection, setDropSelection] = useState<
      Record<string, { quantity: number; request_id: string }>
    >({});
  const [guestInput, setGuestInput] = useState(""),
    [guests, setGuests] = useState<string[]>(initial?.report.guests ?? []),
    [confirmRoster, setConfirmRoster] = useState(existing?.finalized ?? false),
    [counts, setCounts] = useState(existing?.counts ?? true),
    [description, setDescription] = useState(existing?.description ?? "");
  const [rosterImages, setRosterImages] = useState<Evidence[]>([]),
    [lootImages, setLootImages] = useState<Evidence[]>([]),
    [removeImages, setRemoveImages] = useState<string[]>([]),
    [facts, setFacts] = useState<ActivityFacts>(
      initial?.report.facts ?? { pvp_result: "none", full_participation: [] },
    ),
    [factsConfirmed, setFactsConfirmed] = useState(!!initial);
  const [rosterBusy, setRosterBusy] = useState(false),
    [lootBusy, setLootBusy] = useState(false);
  const [state, action, pending] = useActionState(
    initial ? saveActivity : recordActivity,
    {},
  );
  const visibleMembers = useMemo(
    () =>
      members.filter((m) =>
        m.nickname
          .toLocaleLowerCase("ru")
          .includes(memberSearch.toLocaleLowerCase("ru")),
      ),
    [members, memberSearch],
  );
  const visibleDrops = useMemo(
    () =>
      catalog.filter((d) =>
        d.name
          .toLocaleLowerCase("ru")
          .includes(dropSearch.toLocaleLowerCase("ru")),
      ),
    [catalog, dropSearch],
  );
  const template = templates.find((t) => t.id === banner);
  const payload = JSON.stringify({
    title,
    banner,
    bannerVersion: template?.version,
    startsAt: date,
    status,
    kind,
    source,
    coefficient,
    reward,
    difficulty,
    night,
    counts,
    description,
    guests,
    ...(canRoster ? { members: chosen } : {}),
    confirmRoster,
    evidence: [...rosterImages, ...lootImages],
    removeEvidence: removeImages,
    loot:
      !initial && status === "completed"
        ? Object.entries(dropSelection).map(([id, value]) => ({
            id,
            ...value,
            version: catalog.find((c) => c.id === id)!.version,
          }))
        : [],
    facts: status === "completed" ? facts : {},
    factsConfirmed,
  });
  function chooseMember(id: string, checked: boolean) {
    setChosen(
      checked ? [...chosen, id] : chosen.filter((value) => value !== id),
    );
    if (!checked)
      setFacts({
        ...facts,
        full_participation: (facts.full_participation ?? []).filter(
          (value) => value !== id,
        ),
      });
  }
  function selectTitle(value: string) {
    setTitle(value);
    const t = templates.find((b) => b.name === value);
    setBanner(t?.id ?? "");
    if (t) {
      setCoefficient(String(t.weight / 100));
      setSource(
        resolveAttendanceFund(t.name, "PvE") === "Мини-РБ"
          ? "mini_rb"
          : "prime",
      );
      setKind(t.name.toLowerCase().includes("алтарь") ? "pvp" : "raid");
    }
  }
  return (
    <form
      action={action}
      className="activity-editor"
      aria-label={
        initial ? "Редактирование активности" : "Добавление активности"
      }
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="payload" value={payload} />
      {existing && (
        <>
          <input type="hidden" name="eventId" value={existing.id} />
          <input type="hidden" name="version" value={existing.version} />
        </>
      )}
      <fieldset disabled={pending}>
        <div className="activity-form-grid">
          <label>
            Название
            <input
              list={listId}
              required
              minLength={3}
              maxLength={120}
              placeholder="Выберите или введите новое"
              value={title}
              onChange={(e) => selectTitle(e.target.value)}
            />
            <datalist id={listId}>
              {templates.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
          </label>
          <label>
            Дата и время UTC
            <input
              type="datetime-local"
              required
              value={date}
              readOnly={!!initial}
              onChange={(e) => setDate(e.target.value)}
              min="2000-01-01T00:00"
              max="2100-12-31T23:59"
            />
          </label>
          <label>
            Вид
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="prime">Прайм</option>
              <option value="mini_rb">Мини-РБ</option>
              {source === "none" && <option value="none">Без пометки</option>}
            </select>
          </label>
          <label>
            Режим
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option
                value={
                  existing?.kind && existing.kind !== "pvp"
                    ? existing.kind
                    : "raid"
                }
              >
                PvE
              </option>
              <option value="pvp">PvP</option>
            </select>
          </label>
          <label>
            Сложность
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {Object.entries(DIFFICULTIES).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Золото за посещение — план
            <input
              inputMode="decimal"
              required
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              maxLength={20}
            />
          </label>
          <label>
            Коэффициент
            <input
              inputMode="decimal"
              required
              value={coefficient}
              onChange={(e) => setCoefficient(e.target.value)}
              maxLength={10}
            />
          </label>
          <label className="check activity-night">
            <input
              type="checkbox"
              checked={night}
              onChange={(e) => setNight(e.target.checked)}
            />
            Ночная активность
          </label>
          {!initial && (
            <label>
              Статус
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="completed">Завершена — записать отчёт</option>
                <option value="scheduled">Запланирована</option>
              </select>
            </label>
          )}
        </div>
        {canRoster && (
          <section className="activity-form-section" id="roster">
            <h2>
              Состав <span>(только зарегистрированные на сайте)</span>
            </h2>
            <label className="sr-only" htmlFor={listId + "-members"}>
              Поиск участника
            </label>
            <input
              id={listId + "-members"}
              type="search"
              placeholder="Поиск по нику…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            <p className="caption">Выбрано: {chosen.length}</p>
            <div className="activity-member-picker">
              {visibleMembers.map((m) => (
                <label className="activity-member-chip" key={m.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(m.id)}
                    onChange={(e) => chooseMember(m.id, e.target.checked)}
                  />
                  <strong>{m.nickname}</strong>
                  <span>· {m.character_class || "Без роли"}</span>
                </label>
              ))}
              {!visibleMembers.length && <p>Участники не найдены.</p>}
            </div>
            {status === "completed" && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmRoster}
                  onChange={(e) => setConfirmRoster(e.target.checked)}
                />
                Подтверждаю состав: выбранные присутствовали, остальные
                применимые участники отсутствовали. Включить отчёт в статистику.
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={counts}
                onChange={(e) => setCounts(e.target.checked)}
              />
              Учитывать активность в посещаемости
            </label>
          </section>
        )}
        <section className="activity-form-section" id="guests">
          <h2>
            Незарегистрированные участники{" "}
            <span>(для информации, не учитываются в статистике)</span>
          </h2>
          <div className="activity-inline-form">
            <input
              aria-label="Имя незарегистрированного игрока"
              value={guestInput}
              maxLength={80}
              placeholder="Имя игрока"
              onChange={(e) => setGuestInput(e.target.value)}
            />
            <button
              type="button"
              className="button secondary"
              disabled={!guestInput.trim() || guests.length >= 50}
              onClick={() => {
                if (!guests.includes(guestInput.trim()))
                  setGuests([...guests, guestInput.trim()]);
                setGuestInput("");
              }}
            >
              Добавить
            </button>
          </div>
          <div className="activity-chips">
            {guests.map((name, i) => (
              <span className="activity-member-chip" key={i}>
                {name}
                <button
                  className="text-button"
                  type="button"
                  aria-label={"Убрать гостя " + name}
                  onClick={() => setGuests(guests.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>
        {!initial && canTreasury && (
          <section className="activity-form-section">
            <h2>
              Дроп <span>(необязательно, из реестра)</span>
            </h2>
            <input
              type="search"
              aria-label="Поиск дропа"
              placeholder="Поиск по названию…"
              value={dropSearch}
              onChange={(e) => setDropSearch(e.target.value)}
            />
            {status === "scheduled" ? (
              <p className="notice">
                Дроп вносится после завершения активности.
              </p>
            ) : (
              <div className="activity-drop-picker">
                {visibleDrops.map((d) => (
                  <div key={d.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!dropSelection[d.id]}
                        onChange={(e) => {
                          const next = { ...dropSelection };
                          if (e.target.checked)
                            next[d.id] = {
                              quantity: 1,
                              request_id: crypto.randomUUID(),
                            };
                          else delete next[d.id];
                          setDropSelection(next);
                        }}
                      />
                      <strong>{d.name}</strong>
                      <span> · {formatGold(d.price_units)} зол. / ед.</span>
                    </label>
                    {dropSelection[d.id] && (
                      <label className="activity-quantity">
                        Количество
                        <input
                          type="number"
                          min={1}
                          max={1000000}
                          required
                          value={dropSelection[d.id].quantity}
                          onChange={(e) =>
                            setDropSelection({
                              ...dropSelection,
                              [d.id]: {
                                ...dropSelection[d.id],
                                quantity: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  </div>
                ))}
                {!visibleDrops.length && <p>Предметы не найдены.</p>}
              </div>
            )}
          </section>
        )}
        <div
          className="activity-form-grid activity-evidence-columns"
          id="evidence"
        >
          {(canRoster ? ["roster"] : [])
            .concat(canTreasury ? ["loot"] : [])
            .map((value) => {
              const kind = value as "roster" | "loot";
              return (
                <section className="activity-form-section" key={kind}>
                  <h2>
                    {kind === "roster" ? "Скрины состава" : "Скрины дропа"}
                  </h2>
                  {initial?.evidence
                    .filter((v) => v.kind === kind)
                    .map((v) => (
                      <label className="activity-existing-evidence" key={v.id}>
                        <a
                          href={`/events/${existing!.id}/media?kind=${kind}&evidence=${v.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={`/events/${existing!.id}/media?kind=${kind}&evidence=${v.id}`}
                            width={160}
                            height={90}
                            alt={
                              kind === "roster"
                                ? "Скрин состава"
                                : "Скрин дропа"
                            }
                          />
                        </a>
                        <span>
                          <input
                            type="checkbox"
                            checked={removeImages.includes(v.id)}
                            onChange={(e) =>
                              setRemoveImages(
                                e.target.checked
                                  ? [...removeImages, v.id]
                                  : removeImages.filter((id) => id !== v.id),
                              )
                            }
                          />
                          Убрать этот скриншот
                        </span>
                      </label>
                    ))}
                  <EvidenceInput
                    kind={kind}
                    onBusyChange={kind === "roster" ? setRosterBusy : setLootBusy}
                    onChange={
                      kind === "roster" ? setRosterImages : setLootImages
                    }
                  />
                </section>
              );
            })}
        </div>
        {canRoster && status === "completed" && (
          <details className="activity-form-section" id="facts">
            <summary>Факты для достижений</summary>
            <p className="caption">
              Отмечайте только подтверждённые факты. Посещение само по себе не
              подтверждает убийство босса или результат PvP.
            </p>
            <div className="activity-form-grid">
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!facts.boss_defeated}
                  onChange={(e) =>
                    setFacts({ ...facts, boss_defeated: e.target.checked })
                  }
                />
                Босс побеждён
              </label>
              <label>
                Результат PvP
                <select
                  value={facts.pvp_result ?? "none"}
                  onChange={(e) =>
                    setFacts({ ...facts, pvp_result: e.target.value })
                  }
                >
                  <option value="none">Не указан</option>
                  <option value="win">Победа</option>
                  <option value="loss">Поражение</option>
                  <option value="draw">Ничья</option>
                </select>
              </label>
              {(["organizer", "raid_leader"] as const).map((key) => (
                <label key={key}>
                  {key === "organizer" ? "Организатор" : "Рейд-лидер"}
                  <select
                    value={facts[key] ?? ""}
                    onChange={(e) =>
                      setFacts({ ...facts, [key]: e.target.value || null })
                    }
                  >
                    <option value="">Не указан</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nickname}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p>Полное участие</p>
            <div className="activity-member-picker">
              {members
                .filter((m) => chosen.includes(m.id))
                .map((m) => (
                  <label key={m.id} className="activity-member-chip">
                    <input
                      type="checkbox"
                      checked={
                        facts.full_participation?.includes(m.id) ?? false
                      }
                      onChange={(e) =>
                        setFacts({
                          ...facts,
                          full_participation: e.target.checked
                            ? [...(facts.full_participation ?? []), m.id]
                            : (facts.full_participation ?? []).filter(
                                (id) => id !== m.id,
                              ),
                        })
                      }
                    />
                    {m.nickname}
                  </label>
                ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={factsConfirmed}
                onChange={(e) => setFactsConfirmed(e.target.checked)}
              />
              Подтверждаю указанные факты
            </label>
          </details>
        )}
        <label className="activity-form-section">
          Примечание
          <textarea
            rows={2}
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {initial && (
          <label>
            Причина изменения
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={2}
            />
          </label>
        )}
      </fieldset>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <div className="activity-editor-actions">
        <button
          type="submit"
          className="button primary"
          disabled={pending || rosterBusy || lootBusy}
        >
          {pending ? "Сохраняем…" : initial ? "Сохранить" : "Создать"}
        </button>
        <Link
          href={existing ? "/events/" + existing.id : "/events"}
          className="button secondary"
        >
          Отмена
        </Link>
      </div>
    </form>
  );
}
