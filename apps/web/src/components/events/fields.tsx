import { EVENT_KINDS } from "@/lib/events";
export function EventFields({
  event,
}: {
  event?: {
    title: string;
    kind: string;
    starts_at: string;
    description: string;
    counts_for_attendance: boolean;
  };
}) {
  return (
    <>
      <label>
        Название
        <input
          name="title"
          required
          minLength={3}
          maxLength={120}
          defaultValue={event?.title}
        />
      </label>
      <div className="field-grid">
        <label>
          Тип
          <select name="kind" defaultValue={event?.kind ?? "raid"}>
            {EVENT_KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата и время UTC
          <input
            name="startsAt"
            type="datetime-local"
            step="1"
            required
            defaultValue={event?.starts_at.slice(0, 19)}
          />
        </label>
      </div>
      <label>
        Описание
        <textarea
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={event?.description}
        />
      </label>
      <label className="check">
        <input
          name="counts"
          type="checkbox"
          defaultChecked={event?.counts_for_attendance ?? true}
        />
        <span>Учитывать событие в посещаемости после проверки отчёта</span>
      </label>
    </>
  );
}
