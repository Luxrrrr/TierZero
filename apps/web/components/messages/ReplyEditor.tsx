"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MESSAGE_VARIABLES, discordTimestamp, parseMessage, type MessageBody, type ResponseTemplate } from "@tier0/core";
import { MessageForm, type MessageDraft } from "./MessageForm";
import { MessagePreview } from "./MessagePreview";

interface Props {
  guildId: string;
  /** The command, as the sheet names it. */
  commandName: string;
  template: ResponseTemplate;
  /** The reply the owner has saved, or null while the command still says what it always says. */
  current: MessageBody | null;
  /** Whether the reply is shown only to the person who ran the command. Private replies cannot carry reactions. */
  isPrivate: boolean;
  onSave(message: MessageBody): void;
  onReset(): void;
  onClose(): void;
}

/** What each variable that every message has means for a command, which is not quite what it means for a sent message. */
const COMMAND_WORDING: Record<string, string> = {
  channel: "The channel the command was run in, as a link",
  "channel.name": "The name of that channel",
  sender: "The person who ran the command",
  time: "The time it was run",
  now: "The date and time it was run",
  date: "The day it was run",
};

/**
 * A command's reply, edited with the same builder as a message sent from the
 * Messages page. It starts from what the command says today, so changing one
 * word does not mean building the reply again, and nothing changes in Discord
 * until Save is pressed.
 */
export function ReplyEditor({ guildId, commandName, template, current, isPrivate, onSave, onReset, onClose }: Props) {
  const [draft, setDraft] = useState<MessageDraft>(current ?? template.starting);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = useMemo(() => parseMessage(draft), [draft]);
  const errors = parsed.ok ? [] : parsed.errors;
  const nothingYet = draft.content.trim() === "" && draft.embeds.length === 0;

  // The command's own placeholders come first, since they are what is particular to it.
  const variables = useMemo(() => {
    const own = template.placeholders.map((p) => ({ name: p.name, description: p.description }));
    const taken = new Set(own.map((p) => p.name));
    const shared = MESSAGE_VARIABLES.filter((v) => !taken.has(v.name)).map((v) => ({
      name: v.name,
      description: COMMAND_WORDING[v.name] ?? v.description,
    }));
    return [...own, ...shared];
  }, [template.placeholders]);

  const previewContext = useMemo(() => {
    const now = new Date();
    return {
      guildId,
      botName: "TierZero",
      variables: {
        server: "Your server",
        members: "2,431",
        channel: "#general",
        "channel.name": "general",
        date: discordTimestamp(now, "D"),
        time: discordTimestamp(now, "t"),
        now: discordTimestamp(now, "f"),
        sender: "You",
        bot: "TierZero",
        "server.icon": "",
        ...Object.fromEntries(template.placeholders.map((p) => [p.name, p.sample])),
      },
    };
  }, [guildId, template.placeholders]);

  const changed = JSON.stringify(draft) !== JSON.stringify(current ?? template.starting);

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="msg-dialog msg-dialog-wide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="msg-dialog-head">
          <div>
            <h2 id={titleId} className="msg-dialog-title">
              Reply for {commandName}
            </h2>
            <p className="field-hint">
              {current === null ? "This starts from what the command says now." : "This is the reply members get instead of the usual one."}
            </p>
          </div>
          <button type="button" ref={closeRef} className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="msg-dialog-body msg-reply-body">
          <MessageForm
            guildId={guildId}
            value={draft}
            onChange={setDraft}
            errors={errors}
            problems={nothingYet ? [] : errors}
            variables={variables}
            showReactions={!isPrivate}
            textLabel="Reply text"
          />
          <div className="msg-side">
            <p className="cmd-section-title">Preview</p>
            <MessagePreview message={draft} context={previewContext} ephemeral={isPrivate} />
            {template.note ? <p className="field-hint">{template.note}</p> : null}
            <p className="field-hint">The preview fills the variables with examples. Mentions of @everyone and @here never ping from a reply.</p>
          </div>
        </div>

        <div className="msg-dialog-foot msg-dialog-foot-split">
          {current !== null ? (
            <button type="button" className="link-button" onClick={onReset}>
              Go back to the command&apos;s own reply
            </button>
          ) : (
            <span />
          )}
          <span className="msg-dialog-foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!parsed.ok || (!changed && current !== null)} onClick={() => parsed.ok && onSave(parsed.value)}>
              Save reply
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
