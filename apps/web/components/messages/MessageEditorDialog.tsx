"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { MESSAGE_VARIABLES, discordTimestamp, parseMessage, type MessageBody } from "@tier0/core";
import { useUnsavedGuard } from "../../lib/unsaved-guard";
import { MessageForm, type MessageDraft } from "./MessageForm";
import { MessagePreview } from "./MessagePreview";

/** A `{name}` particular to the message being edited, with the stand-in the preview shows for it. */
export interface EditorVariable {
  name: string;
  description: string;
  sample: string;
}

interface Props {
  guildId: string;
  title: string;
  /** Says where the message starts from, which depends on whether the owner has saved one. */
  hint: string;
  /** What the owner has saved, or null while the feature still sends what it always has. */
  current: MessageBody | null;
  /** What the feature sends today, where the editor begins. */
  starting: MessageBody;
  /** Offered before the variables every message has. */
  variables: EditorVariable[];
  /** Replaces the wording of a shared variable where it means something else here, keyed by name. */
  sharedWording?: Record<string, string>;
  /** Shared variables that mean nothing here, such as the channel of a direct message. */
  hideShared?: string[];
  showReactions: boolean;
  components?: "all" | "direct" | "none";
  /** A caveat about which message this covers, shown beside the preview. */
  note?: string;
  /** Closing line under the preview. */
  footnote?: string;
  textLabel: string;
  /** Draws the preview as a message only the reader can see. */
  ephemeral?: boolean;
  saveLabel: string;
  resetLabel: string;
  onSave(message: MessageBody): void;
  onReset(): void;
  onClose(): void;
}

/** What the preview shows in place of each variable: the samples a message declares, over stand-ins for the shared ones. */
export function previewContextFor(guildId: string, own: readonly EditorVariable[]) {
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
      ...Object.fromEntries(own.map((variable) => [variable.name, variable.sample])),
    },
  };
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The message builder in a dialog, with a live preview beside it. A command's
 * reply and a message a feature sends are both edited here, so every place the
 * bot says something offers the same tools. It starts from what the bot says
 * now, so changing one word does not mean building the message again, and
 * nothing is kept until the save button is pressed.
 */
export function MessageEditorDialog({
  guildId,
  title,
  hint,
  current,
  starting,
  variables: own,
  sharedWording,
  hideShared,
  showReactions,
  components = "all",
  note,
  footnote = "The preview fills the variables with examples.",
  textLabel,
  ephemeral = false,
  saveLabel,
  resetLabel,
  onSave,
  onReset,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<MessageDraft>(current ?? starting);
  const [asking, setAsking] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Put focus back where it was, so closing the dialog does not drop a keyboard user at the top of the page.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const changed = JSON.stringify(draft) !== JSON.stringify(current ?? starting);

  // An accidental way out, Escape or a click beside the dialog, asks before it throws edits away.
  // The close and Cancel buttons are deliberate and close at once.
  const closeRequest = useRef<() => void>(() => undefined);
  closeRequest.current = () => {
    if (changed) setAsking((was) => !was);
    else onClose();
  };

  // The page's own navigation asks too, because the edits live only in this dialog.
  const guard = useUnsavedGuard({ dirty: changed });

  // Focus that ended up outside the dialog, after a click on the backdrop edge for instance, still closes it.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && !dialogRef.current?.contains(document.activeElement)) closeRequest.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const parsed = useMemo(() => parseMessage(draft), [draft]);
  const errors = parsed.ok ? [] : parsed.errors;
  const nothingYet = draft.content.trim() === "" && draft.embeds.length === 0;

  // What is particular to this message comes first, since it is what the owner is most likely to want.
  const variables = useMemo(() => {
    const specific = own.map((variable) => ({ name: variable.name, description: variable.description }));
    const taken = new Set([...specific.map((variable) => variable.name), ...(hideShared ?? [])]);
    const shared = MESSAGE_VARIABLES.filter((variable) => !taken.has(variable.name)).map((variable) => ({
      name: variable.name,
      description: sharedWording?.[variable.name] ?? variable.description,
    }));
    return [...specific, ...shared];
  }, [own, sharedWording, hideShared]);

  const previewContext = useMemo(() => previewContextFor(guildId, own), [guildId, own]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !event.defaultPrevented) {
      // Whatever this dialog sits inside, a sheet or an open row, must not close with it.
      event.stopPropagation();
      closeRequest.current();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((node) => node.offsetParent !== null);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    event.stopPropagation();
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Drawn on the page itself so a sheet or a list row it was opened from cannot clip or reposition it.
  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={() => closeRequest.current()} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="msg-dialog msg-dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="msg-dialog-head">
          <div>
            <h2 id={titleId} className="msg-dialog-title">
              {title}
            </h2>
            <p className="field-hint">{hint}</p>
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
            showReactions={showReactions}
            components={components}
            textLabel={textLabel}
          />
          <div className="msg-side">
            <p className="cmd-section-title">Preview</p>
            <MessagePreview message={draft} context={previewContext} ephemeral={ephemeral} />
            {note ? <p className="field-hint">{note}</p> : null}
            <p className="field-hint">{footnote}</p>
          </div>
        </div>

        {asking ? (
          <div className="msg-discard-ask" role="alert">
            <span>You have changes that are not saved. Close without saving them?</span>
            <span className="msg-dialog-foot-actions">
              <button type="button" className="btn btn-ghost" autoFocus onClick={() => setAsking(false)}>
                Keep editing
              </button>
              <button type="button" className="btn btn-danger" onClick={onClose}>
                Discard changes
              </button>
            </span>
          </div>
        ) : null}

        <div className="msg-dialog-foot msg-dialog-foot-split">
          {current !== null ? (
            <button type="button" className="link-button" onClick={onReset}>
              {resetLabel}
            </button>
          ) : (
            <span />
          )}
          <span className="msg-dialog-foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!parsed.ok || (!changed && current !== null)} onClick={() => parsed.ok && onSave(parsed.value)}>
              {saveLabel}
            </button>
          </span>
        </div>
      </div>
      {guard.host}
    </div>,
    document.body,
  );
}
