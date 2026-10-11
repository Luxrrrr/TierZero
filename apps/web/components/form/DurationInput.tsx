"use client";

import { useState } from "react";
import {
  DURATION_UNITS,
  formatDuration,
  toMilliseconds,
  unitMilliseconds,
  type DurationUnit,
} from "../../lib/duration";

interface Props {
  id: string;
  /** Milliseconds from stored settings, or the written form from a schema default. */
  value: unknown;
  onChange(next: string | undefined): void;
  /** The ceiling the schema declares, written as "28d". */
  max?: string;
  /** Names the unit select, which has no visible label of its own. */
  label: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

/**
 * A number and a unit, rather than a box someone has to type "15m" into. The
 * value is emitted in the written form the control API accepts.
 */
export function DurationInput({
  id,
  value,
  onChange,
  max,
  label,
  disabled = false,
  "aria-describedby": describedBy,
}: Props) {
  const initial = formatDuration(value);
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);
  const [amount, setAmount] = useState(initial.amount === 0 ? "" : String(initial.amount));
  const [seen, setSeen] = useState<unknown>(value);

  const emitted = amount === "" ? undefined : `${Number(amount)}${unit}`;

  // A value that changed elsewhere, such as a discarded draft, resets both
  // boxes. What this control emitted itself does not: an empty box means the
  // whole duration is gone, and resetting on that would throw away the unit
  // somebody had just chosen.
  if (!Object.is(value, seen)) {
    setSeen(value);
    if (toMilliseconds(value) !== toMilliseconds(emitted)) {
      const parts = formatDuration(value);
      setUnit(parts.unit);
      setAmount(parts.amount === 0 ? "" : String(parts.amount));
    }
  }

  const ceiling = toMilliseconds(max);
  const maxAmount = ceiling === null ? undefined : Math.floor(ceiling / unitMilliseconds(unit));

  function update(nextAmount: string, nextUnit: DurationUnit) {
    setAmount(nextAmount);
    setUnit(nextUnit);
    onChange(nextAmount === "" ? undefined : `${Number(nextAmount)}${nextUnit}`);
  }

  return (
    <div className="input-affix">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={maxAmount}
        step={1}
        value={amount}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => update(event.target.value.replace(/\D/g, ""), unit)}
      />
      <select
        aria-label={`Unit for ${label}`}
        value={unit}
        disabled={disabled}
        onChange={(event) => update(amount, event.target.value as DurationUnit)}
      >
        {DURATION_UNITS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
