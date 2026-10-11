"use client";

import { Fragment, useRef, type ReactNode } from "react";

interface Props {
  id: string;
  value: string;
  onChange(next: string): void;
  max?: number;
  placeholders: string[];
  /** Substituted for {server} in the preview. */
  serverName?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * A message body beside a mock-up of what Discord will show. The preview is
 * what makes placeholders explicable without a paragraph of documentation.
 */
export function TemplateEditor({
  id,
  value,
  onChange,
  max = 2000,
  placeholders,
  serverName,
  disabled = false,
  "aria-describedby": describedBy,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insert(name: string) {
    const token = `{${name}}`;
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(value + token);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    const cursor = start + token.length;
    // The textarea only holds the new text after the next render, so the caret
    // can only be placed once that has happened.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="template">
      <div className="template-editor">
        <textarea
          id={id}
          ref={textareaRef}
          className="textarea"
          rows={4}
          maxLength={max}
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="template-toolbar">
          {placeholders.length > 0 ? (
            <>
              <span className="template-toolbar-label">Insert</span>
              {placeholders.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="placeholder-chip"
                  disabled={disabled}
                  onClick={() => insert(name)}
                >
                  {`{${name}}`}
                </button>
              ))}
            </>
          ) : null}
          <span className={value.length > max ? "template-count is-over" : "template-count"}>
            {value.length} / {max}
          </span>
        </div>
      </div>

      <div className="template-preview">
        <p className="template-preview-label">Preview</p>
        <div className="dm">
          <div className="dm-avatar" aria-hidden="true">
            0
          </div>
          <div className="dm-content">
            <div className="dm-head">
              <span className="dm-author">TierZero</span>
              <span className="dm-tag">App</span>
              <span className="dm-time">Today at 9:41 AM</span>
            </div>
            {value ? (
              <div className="dm-body">{render(value, serverName)}</div>
            ) : (
              <div className="dm-body is-empty">Nothing to preview yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sample values, so the preview reads like a real message rather than a form. */
function render(value: string, serverName: string | undefined): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of value.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    const name = match[1];
    if (index > cursor) parts.push(value.slice(cursor, index));
    cursor = index + match[0].length;
    key += 1;

    switch (name) {
      case "user":
        parts.push(
          <span className="dm-mention" key={key}>
            @Alex
          </span>,
        );
        break;
      case "username":
        parts.push(<Fragment key={key}>Alex</Fragment>);
        break;
      case "server":
        parts.push(<Fragment key={key}>{serverName ?? "your server"}</Fragment>);
        break;
      case "memberCount":
        parts.push(<Fragment key={key}>1,024</Fragment>);
        break;
      case "level":
        parts.push(<Fragment key={key}>5</Fragment>);
        break;
      default:
        parts.push(
          <span className="dm-unknown" key={key}>
            {match[0]}
          </span>,
        );
        break;
    }
  }

  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}
