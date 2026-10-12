"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MESSAGE_LIMITS, type MessageError } from "@tier0/core";
import { PlusIcon, XIcon } from "../Icons";
import { EmojiGrid } from "./InsertBar";
import { renderEmoji } from "./MessagePreview";

/** A button that opens the emoji panel and hands back the one picked. */
export function EmojiPopover({ guildId, label, children, onPick }: { guildId: string; label: string; children: ReactNode; onPick(token: string): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="insert-menu" ref={ref}>
      <button type="button" className="insert-btn" aria-haspopup="true" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        {children}
      </button>
      {open ? (
        <div className="insert-panel">
          <EmojiGrid
            guildId={guildId}
            onPick={(token) => {
              onPick(token);
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Emoji the bot adds under the message once it is sent, so members can tap one to react. */
export function ReactionsEditor({
  guildId,
  reactions,
  errors,
  onChange,
}: {
  guildId: string;
  reactions: string[];
  errors: MessageError[];
  onChange(next: string[]): void;
}) {
  const L = MESSAGE_LIMITS;
  const error = errors.find((e) => e.path === "reactions" || e.path.startsWith("reactions["))?.message;

  return (
    <section className="card msg-card" aria-label="Reactions">
      <div className="field-label-row">
        <span className="field-label">Reactions</span>
        <span className="field-hint">
          {reactions.length} of {L.reactions}
        </span>
      </div>
      <p className="field-hint">The bot adds these under the message when it sends it.</p>
      <div className="reaction-list">
        {reactions.map((reaction, i) => (
          <span className="reaction-chip" key={`${reaction}-${i}`}>
            {renderEmoji(reaction)}
            <button type="button" className="icon-btn" aria-label={`Remove reaction ${reaction}`} onClick={() => onChange(reactions.filter((_, j) => j !== i))}>
              <XIcon />
            </button>
          </span>
        ))}
        {reactions.length < L.reactions ? (
          <EmojiPopover guildId={guildId} label="Add a reaction" onPick={(token) => (reactions.includes(token) ? undefined : onChange([...reactions, token]))}>
            <PlusIcon />
          </EmojiPopover>
        ) : null}
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
