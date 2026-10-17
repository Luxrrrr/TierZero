"use client";

import { useMemo, useRef } from "react";
import { plainReply } from "@tier0/core";
import { MessagePreview } from "../messages/MessagePreview";
import { channelNamePreview, fillTemplate, sampleValues } from "../../lib/template-samples";
import { HashIcon } from "../Icons";

interface Props {
  id: string;
  /** For the names of mentioned roles and channels in the preview. */
  guildId: string;
  value: string;
  onChange(next: string): void;
  max?: number;
  placeholders: string[];
  /** What the preview shows for each placeholder, from the schema's `samples`. */
  samples?: Record<string, string>;
  /** Substituted for {server} in the preview. */
  serverName?: string;
  /** `channel` previews the text as a channel name rather than as a message. */
  preview?: "message" | "channel";
  disabled?: boolean;
  /** One line with the insert buttons under it and no preview, for a list of short texts. */
  inline?: boolean;
  "aria-describedby"?: string;
}

/**
 * A message body beside a mock-up of what Discord will show. The preview is
 * what makes placeholders explicable without a paragraph of documentation.
 */
export function TemplateEditor({
  id,
  guildId,
  value,
  onChange,
  max = 2000,
  placeholders,
  samples,
  serverName,
  preview = "message",
  disabled = false,
  inline = false,
  "aria-describedby": describedBy,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const context = useMemo(
    () => ({ guildId, botName: "TierZero", variables: sampleValues(placeholders, samples, serverName) }),
    [guildId, placeholders, samples, serverName],
  );

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

  const box = inline ? (
    <input
      id={id}
      ref={textareaRef}
      className="input"
      type="text"
      maxLength={max}
      value={value}
      disabled={disabled}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  ) : (
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
  );

  return (
    <div className={inline ? "template template-inline" : "template"}>
      <div className="template-editor">
        {box}
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

      {inline ? null : (
        <div className="template-preview">
          <p className="template-preview-label">Preview</p>
          {value && preview === "channel" ? (
            <p className="template-channel-preview">
              <HashIcon />
              <span>{channelNamePreview(fillTemplate(value, context.variables)) || "channel"}</span>
            </p>
          ) : value ? (
            // The same drawing of a Discord message as every other preview, so
            // markdown and mentions look the way members will see them.
            <MessagePreview message={plainReply(value)} context={context} />
          ) : (
            <p className="template-preview-empty">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
