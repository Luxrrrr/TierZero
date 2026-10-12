"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "../Icons";

interface Range {
  since: string;
  until: string;
}

interface Props {
  /** Calendar days as YYYY-MM-DD, or empty. */
  since: string;
  until: string;
  onChange(next: Range): void;
  "aria-label"?: string;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const parse = (value: string) => new Date(`${value}T00:00:00.000Z`);
const shift = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const monthName = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const shortDayYear = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The shortcuts people reach for, each as a range ending today. */
function presets(now: Date): { id: string; label: string; range: Range }[] {
  const today = ymd(now);
  return [
    { id: "today", label: "Today", range: { since: today, until: today } },
    { id: "yesterday", label: "Yesterday", range: { since: ymd(shift(now, -1)), until: ymd(shift(now, -1)) } },
    { id: "7d", label: "Last 7 days", range: { since: ymd(shift(now, -6)), until: "" } },
    { id: "30d", label: "Last 30 days", range: { since: ymd(shift(now, -29)), until: "" } },
    { id: "90d", label: "Last 90 days", range: { since: ymd(shift(now, -89)), until: "" } },
  ];
}

function describe(range: Range): string {
  if (!range.since && !range.until) return "Any time";
  if (range.since && range.until && range.since === range.until) return shortDayYear.format(parse(range.since));
  const from = range.since ? shortDay.format(parse(range.since)) : "Start";
  const to = range.until ? shortDayYear.format(parse(range.until)) : "now";
  return `${from} to ${to}`;
}

/**
 * A date range in one control. It shows what is chosen, and opens a calendar with shortcuts on the side.
 * Click a first day, then a last one. Clicking the same day twice picks just that day. Days are UTC, the
 * same as the logs they filter.
 */
export function DateRangePicker({ since, until, onChange, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth] = useState(() => parse(since || ymd(new Date())));
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const now = useMemo(() => new Date(), [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setAnchor(null);
    setHover(null);
  }

  function choose(range: Range) {
    onChange(range);
    close();
  }

  function pick(day: string) {
    if (anchor === null) {
      setAnchor(day);
      return;
    }
    const [from, to] = anchor <= day ? [anchor, day] : [day, anchor];
    choose({ since: from, until: to });
  }

  // While a first day is chosen, the range follows the pointer so the result is visible before the second click.
  const preview: Range = anchor !== null ? (hover && hover < anchor ? { since: hover, until: anchor } : { since: anchor, until: hover ?? anchor }) : { since, until };
  const inRange = (day: string) => Boolean(preview.since) && day >= preview.since && day <= (preview.until || "9999-12-31");

  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => shift(first, i - lead));
  const today = ymd(now);
  const set = Boolean(since || until);

  return (
    <div className="drp" ref={root}>
      <div className="drp-bar" data-set={set ? "true" : undefined}>
        <button
          type="button"
          className="drp-trigger"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={rest["aria-label"] ?? "Date range"}
          onClick={() => {
            if (open) close();
            else {
              setMonth(parse(since || ymd(new Date())));
              setOpen(true);
            }
          }}
        >
          <span className="drp-value">{describe({ since, until })}</span>
          <ChevronDownIcon className="drp-chevron" />
        </button>
        {set ? (
          <button type="button" className="drp-clear" aria-label="Clear the dates" onClick={() => choose({ since: "", until: "" })}>
            <XIcon />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="drp-popover" id={panelId} role="dialog" aria-label="Choose dates">
          <ul className="drp-presets">
            {presets(now).map((preset) => (
              <li key={preset.id}>
                <button type="button" onClick={() => choose(preset.range)} data-active={since === preset.range.since && until === preset.range.until ? "true" : undefined}>
                  {preset.label}
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => choose({ since: "", until: "" })} data-active={!set ? "true" : undefined}>
                Any time
              </button>
            </li>
          </ul>

          <div className="drp-calendar">
            <div className="drp-month">
              <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}>
                <ChevronLeftIcon />
              </button>
              <span aria-live="polite">{monthName.format(month)}</span>
              <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}>
                <ChevronRightIcon />
              </button>
            </div>
            <div className="drp-weekdays" aria-hidden="true">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="drp-grid">
              {cells.map((cell) => {
                const day = ymd(cell);
                const edge = day === preview.since || day === preview.until;
                return (
                  <button
                    key={day}
                    type="button"
                    className="drp-day"
                    data-outside={cell.getUTCMonth() !== month.getUTCMonth() ? "true" : undefined}
                    data-today={day === today ? "true" : undefined}
                    data-in-range={inRange(day) ? "true" : undefined}
                    data-edge={edge ? "true" : undefined}
                    aria-label={shortDayYear.format(cell)}
                    aria-pressed={day === since || day === until}
                    onMouseEnter={() => setHover(day)}
                    onClick={() => pick(day)}
                  >
                    {cell.getUTCDate()}
                  </button>
                );
              })}
            </div>
            <p className="drp-hint">{anchor === null ? "Click the first day, then the last." : "Now click the last day."} Days are in UTC.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
