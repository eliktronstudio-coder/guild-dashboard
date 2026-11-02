import { barWidth } from "@/lib/dashboard";
export type ChartRow = { label: string; value: string | null; display: string };
/** The chart is decorative; the visible table provides exact, accessible values. */
export function BarChart({
  title,
  description,
  rows,
  maximum,
}: {
  title: string;
  description: string;
  rows: ChartRow[];
  maximum?: string;
}) {
  const max =
    maximum ??
    rows.reduce(
      (m, r) => (r.value !== null && BigInt(r.value) > BigInt(m) ? r.value : m),
      "0",
    );
  return (
    <section className="panel section-panel dashboard-chart">
      <h2>{title}</h2>
      <p className="caption">{description}</p>
      {rows.length === 0 ? (
        <p className="muted">Нет данных за этот период.</p>
      ) : (
        <div
          className="chart-scroll"
          tabIndex={0}
          role="region"
          aria-label={title}
        >
          <table className="chart-table">
            <thead>
              <tr>
                <th scope="col">Период</th>
                <th scope="col">Значение</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{r.label}</th>
                  <td>
                    <span className="chart-number">{r.display}</span>
                    <span className="chart-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${r.value === null ? 0 : barWidth(r.value, max)}%`,
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
