"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { XIcon } from "../Icons";

interface Props {
  id: string;
  values: string[];
  onChange(next: string[]): void;
  placeholder?: string;
  max?: number;
  disabled?: boolean;
  "aria-describedby"?: string;
}

/**
 * Words, domains and invite codes: short strings somebody adds several of at a
 * time. Enter or a comma commits one, and pasting a list adds all of them.
 */
export function TagInput({
  id,
  values,
  onChange,
  placeholder = "Type and press Enter",
  max,
  disabled = false,
  "aria-describedby": describedBy,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  const atCapacity = max !== undefined && values.length >= max;

  function add(candidates: string[]) {
    const additions: string[] = [];
    for (const candidate of candidates) {
      const tag = candidate.trim();
      if (!tag) continue;
      if (values.includes(tag) || additions.includes(tag)) continue;
      if (max !== undefined && values.length + additions.length >= max) break;
      additions.push(tag);
    }
    if (additions.length > 0) onChange([...values, ...additions]);
  }

  function commitDraft() {
    if (draft.trim()) add([draft]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === "Backspace" && draft === "" && values.length > 0) {
      event.preventDefault();
      onChange(values.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!/[,\n]/.test(text)) return;
    event.preventDefault();
    add(text.split(/[,\n]/));
    setDraft("");
  }

  return (
    <div
      className="tag-input"
      onClick={() => {
        if (!disabled) inputRef.current?.focus();
      }}
    >
      {values.map((tag) => (
        <span className="chip chip-mono" key={tag}>
          <span className="chip-text">{tag}</span>
          <button
            type="button"
            className="chip-remove"
            aria-label={`Remove ${tag}`}
            disabled={disabled}
            onClick={() => onChange(values.filter((value) => value !== tag))}
          >
            <XIcon />
          </button>
        </span>
      ))}
      <input
        id={id}
        ref={inputRef}
        type="text"
        value={draft}
        placeholder={atCapacity ? `Maximum of ${max}` : placeholder}
        disabled={disabled || atCapacity}
        aria-describedby={describedBy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={commitDraft}
      />
    </div>
  );
}
