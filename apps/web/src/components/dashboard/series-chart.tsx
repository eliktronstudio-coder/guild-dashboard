"use client";
import { useState } from "react";
import { barWidth } from "@/lib/dashboard";
export type SeriesPoint = {
  label: string;
  values: string[];
  display: string[];
};
export function SeriesChart({
  title,
  description,
  points,
  series,
}: {
  title: string;
  description: string;
  points: SeriesPoint[];
  series: { label: string; color: string }[];
}) {
  const [hidden, setHidden] = useState<number[]>([]),
    [selected, setSelected] = useState<number | null>(null);
  const maximum = points
    .reduce(
      (max, p) =>
        p.values.reduce(
          (n, value) => (BigInt(value) > n ? BigInt(value) : n),
          max,
        ),
      0n,
    )
    .toString();
  const point = selected === null ? null : points[selected];
  return (
    <section className="panel section-panel series-chart">
      <h2>{title}</h2>
      <p className="caption">{description}</p>
      <div className="series-legend">
        {series.map((item, i) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={!hidden.includes(i)}
            onClick={() =>
              setHidden((previous) =>
                previous.includes(i)
                  ? previous.filter((v) => v !== i)
                  : [...previous, i],
              )
            }
          >
            <span style={{ background: item.color }} />
            {item.label}
          </button>
        ))}
      </div>
      {points.length ? (
        <>
          <svg
            viewBox="0 0 600 200"
            role="img"
            aria-label={title}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setSelected(
                Math.max(
                  0,
                  Math.min(
                    points.length - 1,
                    Math.round(
                      ((event.clientX - bounds.left) / bounds.width) *
                        (points.length - 1),
                    ),
                  ),
                ),
              );
            }}
            onPointerLeave={() => setSelected(null)}
          >
            <title>{title}</title>
            {[0, 1, 2, 3].map((n) => (
              <line
                key={n}
                x1="0"
                x2="600"
                y1={10 + n * 55}
                y2={10 + n * 55}
                stroke="var(--line)"
                strokeDasharray="4 4"
              />
            ))}
            {series.map((item, i) =>
              hidden.includes(i) ? null : (
                <polyline
                  key={item.label}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                  points={points
                    .map(
                      (p, n) =>
                        `${points.length === 1 ? 300 : (n / (points.length - 1)) * 600},${180 - barWidth(p.values[i] ?? "0", maximum) * 1.65}`,
                    )
                    .join(" ")}
                />
              ),
            )}
            {points.length === 1 &&
              series.map((item, i) =>
                hidden.includes(i) ? null : (
                  <circle
                    key={item.label}
                    cx="300"
                    cy={
                      180 - barWidth(points[0].values[i] ?? "0", maximum) * 1.65
                    }
                    r="4"
                    fill={item.color}
                  />
                ),
              )}
            {selected !== null && (
              <line
                x1={
                  points.length === 1
                    ? 300
                    : (selected / (points.length - 1)) * 600
                }
                x2={
                  points.length === 1
                    ? 300
                    : (selected / (points.length - 1)) * 600
                }
                y1="0"
                y2="190"
                stroke="var(--muted)"
              />
            )}
          </svg>
          <p className="chart-tooltip" aria-live="polite">
            {point ? (
              <>
                {point.label} ·{" "}
                {series
                  .filter((_, i) => !hidden.includes(i))
                  .map(
                    (item) =>
                      `${item.label}: ${point.display[series.indexOf(item)]}`,
                  )
                  .join(" · ")}
              </>
            ) : (
              <>
                {points[0].label} — {points.at(-1)?.label}
              </>
            )}
          </p>
          <details>
            <summary>Табличные данные</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Период</th>
                    {series.map((item) => (
                      <th key={item.label}>{item.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {points.map((p, n) => (
                    <tr key={n}>
                      <th>{p.label}</th>
                      {p.display.map((value, i) => (
                        <td key={i}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="muted">Нет данных за выбранный период.</p>
      )}
    </section>
  );
}
