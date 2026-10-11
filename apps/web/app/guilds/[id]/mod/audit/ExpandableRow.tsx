"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "../../../../../components/Icons";

/**
 * One audit entry with a detail panel that opens beneath it. The summary and
 * the detail are rendered on the server and passed in, so this only holds the
 * open or closed state.
 */
export function ExpandableRow({
  summary,
  detail,
  label,
}: {
  summary: ReactNode;
  detail: ReactNode;
  /** Names the toggle for screen readers, such as "Edited a note by Alex". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <li className="audit-entry" data-open={open ? "true" : undefined}>
      <div className="audit-entry-row">
        {summary}
        <button
          type="button"
          className="btn btn-ghost btn-sm audit-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? "Hide" : "Show"} changes: ${label}`}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide" : "Changes"}
          <ChevronDownIcon className="audit-chevron" />
        </button>
      </div>
      <div id={panelId} className="audit-detail" hidden={!open}>
        {detail}
      </div>
    </li>
  );
}
