"use client";

import { useState } from "react";
import {
  DURATION_UNITS,
  describeDuration,
  formatDuration,
  toMilliseconds,
  unitMilliseconds,
  type DurationUnit,
} from "../../lib/duration";
import { Select } from "./Select";

interface Props {
  id: string;
  /** Milliseconds from stored settings, or the written form from a schema default. */
  value: unknown;
  onChange(next: string | undefined): void;
  /** The ceiling the schema declares, written as "28d". */
  max?: string;
  /** The floor the schema declares, written as "1m". */
  min?: string;
  /**
   * Set when the saved value was below the minimum and reads as the minimum.
   * The note shows while the box still holds that minimum.
   */
  raised?: boolean;
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
  min,
  raised = false,
  label,
  disabled = false,
  "aria-describedby": describedBy,
}: Props) {
  const initial = formatDuration(value);
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);
  const [amount, setAmount] = useState(amountText(value));
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
      setAmount(amountText(value));
    }
  }

  const ceiling = toMilliseconds(max);
  const maxAmount = ceiling === null ? undefined : Math.floor(ceiling / unitMilliseconds(unit));
  const floor = toMilliseconds(min);
  const minAmount = floor === null ? 0 : Math.max(0, Math.ceil(floor / unitMilliseconds(unit)));

  function update(nextAmount: string, nextUnit: DurationUnit) {
    setAmount(nextAmount);
    setUnit(nextUnit);
    onChange(nextAmount === "" ? undefined : `${Number(nextAmount)}${nextUnit}`);
  }

  const showRaised = raised && floor !== null && toMilliseconds(emitted) === floor;

  return (
    <>
      <div className="input-affix">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={minAmount}
          max={maxAmount}
          step={1}
          value={amount}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => update(event.target.value.replace(/\D/g, ""), unit)}
        />
        <Select
          className="select-unit"
          aria-label={`Unit for ${label}`}
          options={DURATION_UNITS.map((option) => ({ value: option.value, label: option.label }))}
          value={unit}
          disabled={disabled}
          onChange={(next) => update(amount, next as DurationUnit)}
        />
      </div>
      {showRaised ? (
        <p className="field-hint">Raised to the minimum of {describeDuration(min)}.</p>
      ) : null}
    </>
  );
}

/**
 * The number shown in the box. Zero is a value someone chose, so it shows as
 * 0; only a duration that is not set at all leaves the box empty.
 */
function amountText(value: unknown): string {
  const ms = toMilliseconds(value);
  if (ms === null) return "";
  return String(formatDuration(value).amount);
}
