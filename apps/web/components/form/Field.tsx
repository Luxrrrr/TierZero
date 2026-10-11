"use client";

import type { ReactNode } from "react";
import { AlertIcon } from "../Icons";

/**
 * Everything a control needs in order to be labelled and described correctly,
 * handed to it by the wrapper that draws the label, help, hint and error.
 */
export interface FieldChrome {
  id: string;
  labelId: string;
  describedBy: string | undefined;
  disabled: boolean;
}

interface Props {
  id: string;
  label: string;
  help?: string;
  /** A quiet line under the control: a range, a character count, a ceiling. */
  hint?: ReactNode;
  /** Why the control is unavailable, built from the field it depends on. */
  dependency?: string;
  error?: string;
  optional?: boolean;
  disabled?: boolean;
  /** Booleans read better with the label on the left and the switch on the right. */
  layout?: "stacked" | "row";
  /** Makes the field take a whole row of a `.form-grid`. */
  span?: boolean;
  /**
   * False where the field holds a list or a set of rows rather than one
   * control, since a label has nothing to point at then.
   */
  labelFor?: boolean;
  children(chrome: FieldChrome): ReactNode;
}

export function Field({
  id,
  label,
  help,
  hint,
  dependency,
  error,
  optional = false,
  disabled = false,
  layout = "stacked",
  span = false,
  labelFor = true,
  children,
}: Props) {
  const labelId = `${id}-label`;
  const helpId = help ? `${id}-help` : undefined;
  const dependencyId = dependency ? `${id}-dependency` : undefined;
  // The row layout has nowhere to put a hint, so it must not claim one.
  const hintId = hint && layout === "stacked" ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [helpId, dependencyId, hintId, errorId].filter(Boolean).join(" ") || undefined;

  const chrome: FieldChrome = { id, labelId, describedBy, disabled };

  const labelContent = (
    <>
      {label}
      {optional ? <span className="field-optional">Optional</span> : null}
    </>
  );

  const labelElement = labelFor ? (
    <label className="field-label" id={labelId} htmlFor={id}>
      {labelContent}
    </label>
  ) : (
    <span className="field-label" id={labelId}>
      {labelContent}
    </span>
  );

  const errorLine = error ? (
    <p className="field-error" id={errorId} role="alert">
      <AlertIcon />
      {error}
    </p>
  ) : null;

  if (layout === "row") {
    return (
      <div className="field-row" data-disabled={disabled ? "true" : undefined}>
        <div className="field-row-text">
          {labelElement}
          {help ? (
            <p className="field-help" id={helpId}>
              {help}
            </p>
          ) : null}
          {dependency ? (
            <p className="field-dependency" id={dependencyId}>
              {dependency}
            </p>
          ) : null}
          {errorLine}
        </div>
        <div className="field-row-control">{children(chrome)}</div>
      </div>
    );
  }

  return (
    <div
      className={span ? "field field-span" : "field"}
      data-disabled={disabled ? "true" : undefined}
      data-invalid={error ? "true" : undefined}
    >
      {labelElement}
      {help ? (
        <p className="field-help" id={helpId}>
          {help}
        </p>
      ) : null}
      {dependency ? (
        <p className="field-dependency" id={dependencyId}>
          {dependency}
        </p>
      ) : null}
      {children(chrome)}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {errorLine}
    </div>
  );
}
