"use client";

import type { ReactNode } from "react";
import { AlertIcon } from "../Icons";
import { errorSentence } from "../../lib/field-error";

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
  /** The card around the field already shows this label, so it is kept for screen readers only. */
  labelHidden?: boolean;
  help?: string;
  /** A quiet line under the control: a range, a character count, a ceiling. */
  hint?: ReactNode;
  /** Why the control is unavailable, built from the field it depends on. */
  dependency?: string;
  error?: string;
  optional?: boolean;
  disabled?: boolean;
  /**
   * Booleans read better with the label on the left and the switch on the right.
   * `compact` is the same with a wide control that takes the rest of the row,
   * for a list of single-line settings.
   */
  layout?: "stacked" | "row" | "compact";
  /** Makes the field take a whole row of a `.form-grid`. */
  span?: boolean;
  /** A small control beside the label, such as a link back to the default. */
  action?: ReactNode;
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
  labelHidden = false,
  help,
  hint,
  dependency,
  error,
  optional = false,
  disabled = false,
  layout = "stacked",
  span = false,
  labelFor = true,
  action,
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

  const labelClass = labelHidden ? "field-label visually-hidden" : "field-label";
  const bareLabel = labelFor ? (
    <label className={labelClass} id={labelId} htmlFor={id}>
      {labelContent}
    </label>
  ) : (
    <span className={labelClass} id={labelId}>
      {labelContent}
    </span>
  );
  const labelElement = action ? (
    <div className="field-label-row">
      {bareLabel}
      {action}
    </div>
  ) : (
    bareLabel
  );

  const errorLine = error ? (
    <p className="field-error" id={errorId} role="alert">
      <AlertIcon />
      {errorSentence(error)}
    </p>
  ) : null;

  if (layout === "row" || layout === "compact") {
    return (
      <div
        className={[layout === "compact" ? "field-row field-row-compact" : "field-row", span ? "field-span" : ""].filter(Boolean).join(" ")}
        data-disabled={disabled ? "true" : undefined}
        // Marked like a stacked field, so a refused switch or message is the
        // one the page scrolls to and focuses.
        data-invalid={error ? "true" : undefined}
      >
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
