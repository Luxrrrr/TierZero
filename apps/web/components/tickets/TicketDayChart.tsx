"use client";

import { useId } from "react";
import type { TicketStatsDto } from "@tier0/core";
import { smoothPath, useCursor, type Point } from "../../app/guilds/[id]/mod/StatsCharts";
import { fullDate, gridValues, labelIndexes, niceMax, shortDate } from "../../app/guilds/[id]/mod/stats-logic";
import { dayChartSummary } from "../../lib/ticket-stats";

const VIEW_W = 1000;
const SERIES = [
  { key: "opened", label: "Opened" },
  { key: "closed", label: "Closed" },
] as const;

/**
 * Tickets opened and closed each day, as two lines on the moderation chart's
 * frame: a gap between them is a backlog building or clearing. Pointer and
 * keyboard read the same day, and a table follows for anyone not looking.
 */
export function TicketDayChart({ perDay }: { perDay: TicketStatsDto["perDay"] }) {
  const cursor = useCursor(perDay.length);
  const gradientId = useId();
  const peak = Math.max(0, ...perDay.flatMap((day) => [day.opened, day.closed]));
  const axisMax = niceMax(peak);
  const grid = gridValues(axisMax);
  const labels = labelIndexes(perDay.length, perDay.length <= 10 ? 4 : 5);
  const last = perDay.length - 1;
  const active = cursor.index !== null ? perDay[cursor.index] : undefined;
  const centre = cursor.index !== null ? ((cursor.index + 0.5) / perDay.length) * 100 : 0;
  const totals = {
    opened: perDay.reduce((sum, day) => sum + day.opened, 0),
    closed: perDay.reduce((sum, day) => sum + day.closed, 0),
  };

  const line = (key: "opened" | "closed") => {
    if (perDay.length === 0 || axisMax <= 0) return { line: "", area: "" };
    const points: Point[] = perDay.map((day, i) => [((i + 0.5) / perDay.length) * VIEW_W, 100 - (day[key] / axisMax) * 100]);
    const path = smoothPath(points, "M");
    const first = points[0]!;
    const end = points[points.length - 1]!;
    return { line: path, area: `${path} L${end[0].toFixed(2)} 100 L${first[0].toFixed(2)} 100 Z` };
  };

  const sentence = active ? `${fullDate(active.date)}: ${active.opened} opened, ${active.closed} closed.` : "";

  return (
    <div className="dc-wrap">
      <div className="dc-legend tk-legend" aria-hidden="true">
        {SERIES.map((series) => (
          <span key={series.key} className="mod-chip dc-toggle" data-series={series.key}>
            <i />
            {series.label}
            <span className="mod-chip-count">{totals[series.key].toLocaleString("en")}</span>
          </span>
        ))}
      </div>

      <div className="dc" data-dense={perDay.length > 45 ? "true" : undefined}>
        <div className="dc-y" aria-hidden="true">
          {grid.map((value) => (
            <span key={value} style={{ bottom: `${(value / axisMax) * 100}%` }}>
              {value}
            </span>
          ))}
        </div>

        <div
          className="dc-plot"
          tabIndex={0}
          role="application"
          aria-roledescription="chart"
          aria-label={`Tickets opened and closed per day. ${dayChartSummary(perDay)} Use the left and right arrow keys to read each day, Home and End to jump, Escape to clear. A table of every day follows the chart.`}
          onKeyDown={cursor.onKeyDown}
          onPointerMove={cursor.onPointerMove}
          onPointerLeave={cursor.clear}
          onBlur={cursor.clear}
        >
          {grid.slice(1).map((value) => (
            <div key={value} className="dc-grid" aria-hidden="true" style={{ bottom: `${(value / axisMax) * 100}%` }} />
          ))}
          <svg className="dc-svg" viewBox={`0 0 ${VIEW_W} 100`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={`${gradientId}-opened`} x1="0" y1="0" x2="0" y2="1" data-series="opened">
                <stop offset="0" style={{ stopColor: "var(--series)", stopOpacity: 0.3 }} />
                <stop offset="1" style={{ stopColor: "var(--series)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <g data-series="opened">
              <path className="dc-area" d={line("opened").area} fill={`url(#${gradientId}-opened)`} />
              <path className="dc-line" d={line("opened").line} />
            </g>
            <g data-series="closed">
              <path className="dc-line tk-line-dashed" d={line("closed").line} />
            </g>
          </svg>

          {active && cursor.index !== null ? (
            <div className="dc-guide" aria-hidden="true" style={{ left: `${centre}%` }}>
              {SERIES.map((series) => (
                <i key={series.key} data-series={series.key} style={{ bottom: `${(active[series.key] / axisMax) * 100}%` }} />
              ))}
            </div>
          ) : null}

          {active ? (
            <div className="dc-tip" aria-hidden="true" data-flip={centre > 55 ? "true" : undefined} style={{ left: `${centre}%` }}>
              <div className="dc-tip-title">{fullDate(active.date)}</div>
              {SERIES.map((series) => (
                <div key={series.key} className="dc-tip-line" data-series={series.key}>
                  <i />
                  <span>{series.label}</span>
                  <b>{active[series.key]}</b>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="dc-x" aria-hidden="true" data-count={labels.length}>
          {labels.map((index) => (
            <span
              key={index}
              data-edge={index === 0 ? "start" : index === last ? "end" : undefined}
              style={{ left: `${((index + 0.5) / perDay.length) * 100}%` }}
            >
              {shortDate(perDay[index]!.date)}
            </span>
          ))}
        </div>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {cursor.fromKeyboard ? sentence : ""}
      </p>

      <table className="visually-hidden">
        <caption>Tickets opened and closed per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Opened</th>
            <th scope="col">Closed</th>
          </tr>
        </thead>
        <tbody>
          {perDay.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{day.opened}</td>
              <td>{day.closed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
