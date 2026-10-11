"use client";

interface Props {
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
  /** A save is in flight. The switch stays operable; only the animation stops. */
  pending?: boolean;
  size?: "md" | "lg";
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

/**
 * A button with role=switch rather than a styled checkbox, so it carries a real
 * accessible name and answers to Enter as well as Space.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  pending = false,
  size = "md",
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      className={size === "lg" ? "switch switch-lg" : "switch"}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-busy={pending || undefined}
      data-pending={pending ? "true" : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}
