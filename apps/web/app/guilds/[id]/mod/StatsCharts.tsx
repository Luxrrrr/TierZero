"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  SERIES,
  SERIES_LABEL,
  chartSummary,
  dayTotal,
  fullDate,
  gridValues,
  hourCells,
  hourLabel,
  hourRange,
  indexFromPosition,
  labelIndexes,
  niceMax,
  peakHourText,
  plural,
  presentSeries,
  seriesTotals,
  stepIndex,
  toggled,
  tooltipFor,
  tooltipSentence,
  visibleTotal,
  pointLabel,
  pointTitle,
  type Bucket,
  type DayCounts,
  type Series,
} from "./stats-logic";

/**
 * The interactive charts. Both are plain markup sized with percentages, so
 * they follow the theme tokens and reflow without measuring anything. Pointer
 * and keyboard share one cursor index; the data table beside each chart is the
 * non-visual equivalent.
 */

export function useCursor(length: number) {
  const [index, setIndex] = useState<number | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setIndex(null);
      return;
    }
    const next = stepIndex(index, event.key, length);
    if (next === index && !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setFromKeyboard(true);
    setIndex(next);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setFromKeyboard(false);
    setIndex(indexFromPosition(event.clientX - box.left, box.width, length));
  };

  return { index, fromKeyboard, clear: () => setIndex(null), onKeyDown, onPointerMove };
}

const VIEW_W = 1000;

export type Point = [number, number];

/**
 * A smooth curve through the points that never dips below or above its
 * neighbours (monotone cubic), so a quiet day between two busy ones does not
 * draw a negative count. `start` is "M" for a fresh path and "L" to continue one.
 */
export function smoothPath(points: Point[], start: "M" | "L"): string {
  const n = points.length;
  if (n === 0) return "";
  const first = points[0]!;
  let d = `${start}${first[0].toFixed(2)} ${first[1].toFixed(2)}`;
  if (n === 1) return d;

  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    slope.push((y1 - y0) / (x1 - x0));
  }
  const tangent: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    tangent.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  }
  tangent.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i]! / slope[i]!;
    const b = tangent[i + 1]! / slope[i]!;
    const h = Math.hypot(a, b);
    if (h > 3) {
      tangent[i] = (3 * a * slope[i]!) / h;
      tangent[i + 1] = (3 * b * slope[i]!) / h;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const dx = (x1 - x0) / 3;
    d += ` C${(x0 + dx).toFixed(2)} ${(y0 + tangent[i]! * dx).toFixed(2)} ${(x1 - dx).toFixed(2)} ${(y1 - tangent[i + 1]! * dx).toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return d;
}

interface Layer {
  series: "total";
  area: string;
  line: string;
  /** The day totals the curve passes through. */
  tops: number[];
}

/**
 * One smooth area for the day totals of whatever is switched on. Stacking the
 * four types turned a sparse month into overlapping hills, so the breakdown
 * lives in the tooltip and the chips decide what is counted.
 */
function buildLayers(perDay: DayCounts[], hidden: Series[], axisMax: number): Layer[] {
  const n = perDay.length;
  if (n === 0 || axisMax <= 0) return [];
  const tops = perDay.map((day) => visibleTotal(day, hidden));
  const xs = perDay.map((_, i) => ((i + 0.5) / n) * VIEW_W);
  const points: Point[] = tops.map((value, i) => [xs[i]!, 100 - (value / axisMax) * 100]);
  const line = smoothPath(points, "M");
  const last = points[points.length - 1]!;
  const first = points[0]!;
  return [{ series: "total", tops, line, area: `${line} L${last[0].toFixed(2)} 100 L${first[0].toFixed(2)} 100 Z` }];
}

/** `bucket` says whether each point is a day, a week or a month, which changes only the wording. */
export function DayChart({ perDay, bucket = "day" }: { perDay: DayCounts[]; bucket?: Bucket }) {
  const [hidden, setHidden] = useState<Series[]>([]);
  const cursor = useCursor(perDay.length);

  const present = presentSeries(perDay);
  const totals = seriesTotals(perDay);
  const peak = Math.max(0, ...perDay.map((day) => visibleTotal(day, hidden)));
  const axisMax = niceMax(peak);
  const grid = gridValues(axisMax);
  const labels = labelIndexes(perDay.length, perDay.length <= 10 ? 4 : 5);
  const last = perDay.length - 1;
  const active = cursor.index !== null ? perDay[cursor.index] : undefined;
  const tip = active ? tooltipFor(active, hidden, bucket) : null;
  const centre = cursor.index !== null ? ((cursor.index + 0.5) / perDay.length) * 100 : 0;
  const flip = centre > 55;
  const allOff = present.length > 0 && present.every((series) => hidden.includes(series));
  const gradientId = useId();
  const layers = buildLayers(perDay, hidden, axisMax);

  return (
    <div className="dc-wrap">
      <div className="dc-legend" role="group" aria-label="Show or hide action types">
        {present.map((series) => (
          <button
            key={series}
            type="button"
            className="mod-chip dc-toggle"
            data-series={series}
            aria-pressed={!hidden.includes(series)}
            onClick={() => setHidden((current) => toggled(current, series))}
          >
            <i aria-hidden="true" />
            {SERIES_LABEL[series]}
            <span className="mod-chip-count">{totals[series].toLocaleString("en")}</span>
          </button>
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
          aria-label={`Actions per ${bucket}. ${chartSummary({ perDay, bucket })} Use the left and right arrow keys to read each ${bucket}, Home and End to jump, Escape to clear. A table of every ${bucket} follows the chart.`}
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
              {layers.map((layer) => (
                <linearGradient key={layer.series} id={`${gradientId}-${layer.series}`} x1="0" y1="0" x2="0" y2="1" data-series={layer.series}>
                  <stop offset="0" style={{ stopColor: "var(--series)", stopOpacity: 0.38 }} />
                  <stop offset="1" style={{ stopColor: "var(--series)", stopOpacity: 0 }} />
                </linearGradient>
              ))}
            </defs>
            {layers.map((layer) => (
              <g key={layer.series} data-series={layer.series}>
                <path className="dc-area" d={layer.area} fill={`url(#${gradientId}-${layer.series})`} />
                <path className="dc-line" d={layer.line} />
              </g>
            ))}
          </svg>

          {active && cursor.index !== null ? (
            <div className="dc-guide" aria-hidden="true" style={{ left: `${centre}%` }}>
              {layers.map((layer) => (
                <i
                  key={layer.series}
                  data-series={layer.series}
                  style={{ bottom: `${(layer.tops[cursor.index!]! / axisMax) * 100}%` }}
                />
              ))}
            </div>
          ) : null}

          {allOff ? <p className="dc-off">Every action type is switched off.</p> : null}

          {tip && active ? (
            <div
              className="dc-tip"
              aria-hidden="true"
              data-flip={flip ? "true" : undefined}
              style={{ left: `${centre}%` }}
            >
              <div className="dc-tip-title">{bucket === "day" ? fullDate(active.date) : pointTitle(active, bucket)}</div>
              <div className="dc-tip-total">{plural(tip.total, "action")}</div>
              {tip.lines.map((line) => (
                <div key={line.series} className="dc-tip-line" data-series={line.series}>
                  <i />
                  <span>{SERIES_LABEL[line.series]}</span>
                  <b>{line.count}</b>
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
              {pointLabel(perDay[index]!, bucket)}
            </span>
          ))}
        </div>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {cursor.fromKeyboard && active ? tooltipSentence(active, hidden, bucket) : ""}
      </p>

      <table className="visually-hidden">
        <caption>Actions per {bucket}</caption>
        <thead>
          <tr>
            <th scope="col">{bucket === "day" ? "Day" : bucket === "week" ? "Week" : "Month"}</th>
            {SERIES.map((series) => (
              <th key={series} scope="col">
                {SERIES_LABEL[series]}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {perDay.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.end && day.end !== day.date ? `${day.date} to ${day.end}` : day.date}</th>
              {SERIES.map((series) => (
                <td key={series}>{day[series]}</td>
              ))}
              <td>{dayTotal(day)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `noun` names what is counted, singular, for a page that counts something other than actions. */
export function HourStrip({ byHour, noun = "action" }: { byHour: number[]; noun?: string }) {
  const cells = hourCells(byHour);
  const cursor = useCursor(24);
  const peak = peakHourText(byHour);
  const active = cursor.index !== null ? cells[cursor.index] : undefined;
  const nouns = `${noun}s`;
  const Nouns = nouns.charAt(0).toUpperCase() + nouns.slice(1);

  const readout = active
    ? `${hourRange(active.hour)}: ${plural(active.count, noun)}`
    : peak
      ? `Busiest around ${peak}.`
      : `No ${nouns} yet, so there is no busy hour.`;

  return (
    <div>
      <div
        className="hours"
        tabIndex={0}
        role="application"
        aria-roledescription="chart"
        aria-label={`${Nouns} by hour of the day, in UTC. ${peak ? `Busiest around ${peak}.` : `No ${nouns} yet.`} Use the left and right arrow keys to read each hour, Home and End to jump, Escape to clear. A table of every hour follows the chart.`}
        onKeyDown={cursor.onKeyDown}
        onPointerMove={cursor.onPointerMove}
        onPointerLeave={cursor.clear}
        onBlur={cursor.clear}
      >
        {cells.map((cell) => (
          <div
            key={cell.hour}
            className="hour"
            data-level={cell.level}
            data-active={cell.hour === cursor.index ? "true" : undefined}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="hours-axis" aria-hidden="true">
        {[0, 6, 12, 18, 23].map((hour) => (
          <span
            key={hour}
            data-edge={hour === 0 ? "start" : hour === 23 ? "end" : undefined}
            style={{ left: `${((hour + 0.5) / 24) * 100}%` }}
          >
            {hourLabel(hour)}
          </span>
        ))}
      </div>
      <div className="hours-foot">
        <p className="hours-readout">{readout}</p>
        <p className="visually-hidden" aria-live="polite">
          {cursor.fromKeyboard && active ? readout : ""}
        </p>
        <div className="hours-legend" aria-hidden="true">
          <span>Quieter</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className="hour" data-level={level} />
          ))}
          <span>Busier</span>
        </div>
      </div>
      <table className="visually-hidden">
        <caption>{Nouns} by hour of the day (UTC)</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">{Nouns}</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((cell) => (
            <tr key={cell.hour}>
              <th scope="row">{hourRange(cell.hour)}</th>
              <td>{cell.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
