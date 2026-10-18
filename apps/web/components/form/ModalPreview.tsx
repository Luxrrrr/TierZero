"use client";

import { useId, useState } from "react";
import type { ListPreview } from "@tier0/core";
import { Collapse } from "../Collapse";
import { ChevronDownIcon, EyeIcon } from "../Icons";

interface Props {
  preview: ListPreview;
  /** The rows of the list the preview is of. */
  items: unknown[];
  /** The text setting beside the list that titles the form, when the schema names one. */
  title: string | undefined;
}

function at(row: unknown, path: string | undefined): unknown {
  if (path === undefined || typeof row !== "object" || row === null) return undefined;
  return path.split(".").reduce<unknown>((value, key) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined), row);
}

/**
 * A list of questions shown as the form Discord opens: a title, then a box for
 * each question, long or short as the question says, starred when it must be
 * answered. A button opens it, so it takes no room until it is wanted. It only
 * reads the rows; the list above it is what edits them.
 */
export function ModalPreview({ preview, items, title }: Props) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="modal-preview">
      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
        <EyeIcon />
        {open ? "Hide the preview" : "Preview the form"}
        <ChevronDownIcon className="modal-preview-chevron" />
      </button>
      <Collapse open={open} keep>
        <div className="modal-preview-body" id={bodyId}>
          <p className="modal-preview-label">What members see before the ticket opens</p>
          <div className="modal-preview-card" aria-hidden={!open}>
            <p className="modal-preview-title">{title && title.trim() !== "" ? title : "Form"}</p>
            {items.length === 0 ? <p className="modal-preview-empty">No questions, so the ticket opens straight away.</p> : null}
            {items.map((row, index) => {
              const label = at(row, preview.label);
              const placeholder = at(row, preview.placeholder);
              const long = preview.style !== undefined && at(row, preview.style) === "paragraph";
              const required = preview.required === undefined ? false : at(row, preview.required) !== false;
              return (
                <div className="modal-preview-field" key={index}>
                  <p className="modal-preview-question">
                    {typeof label === "string" && label !== "" ? label : `Question ${index + 1}`}
                    {required ? <span className="modal-preview-star"> *</span> : null}
                  </p>
                  <div className="modal-preview-input" data-long={long ? "true" : undefined}>
                    {typeof placeholder === "string" ? placeholder : ""}
                  </div>
                </div>
              );
            })}
            <div className="modal-preview-foot">
              <span className="modal-preview-submit">Submit</span>
            </div>
          </div>
        </div>
      </Collapse>
    </div>
  );
}
