import Link from "next/link";
export function EventCalendar({
  month,
  events,
}: {
  month: string;
  events: { id: string; title: string; starts_at: string; status: string }[];
}) {
  const first = new Date(month + "-01T00:00:00Z"),
    offset = (first.getUTCDay() + 6) % 7,
    days = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
  return (
    <div className="calendar-scroll">
      <div
        className="event-calendar"
        role="list"
        aria-label={`Календарь ${month}, UTC`}
      >
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <div key={d} className="caption calendar-weekday">
            {d}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`empty${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <div key={date} role="listitem" className="calendar-day">
              <time dateTime={date}>{i + 1}</time>
              {events
                .filter((e) => e.starts_at.slice(0, 10) === date)
                .map((e) => (
                  <Link
                    className={
                      e.status === "cancelled" ? "calendar-cancelled" : ""
                    }
                    key={e.id}
                    href={`/events/${e.id}`}
                  >
                    <span>{e.starts_at.slice(11, 16)}</span> {e.title}
                  </Link>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
