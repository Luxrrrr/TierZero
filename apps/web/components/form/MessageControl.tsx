"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { MessageBody } from "@tier0/core";
import { MessageEditorDialog, previewContextFor, type EditorVariable } from "../messages/MessageEditorDialog";
import { MessagePreview } from "../messages/MessagePreview";
import { messageSummary } from "../../lib/message-summary";
import { isCustomized, storedMessage } from "../../lib/bot-messages";

interface Props {
  id: string;
  guildId: string;
  /** Names the dialog. */
  label: string;
  /** What the feature sends today, which is also what the setting falls back to. */
  starting: MessageBody;
  variables: EditorVariable[];
  delivery: "channel" | "dm";
  /** Who sees it, as the schema's `audience` says; "private" is a reply only its reader sees. */
  audience?: "public" | "private" | "dm";
  /** False where the message cannot carry buttons or menus. */
  components: boolean;
  note?: string;
  /** The real server's name, which the preview shows for {server} instead of a stand-in. */
  serverName?: string;
  /** What is stored: a message, text saved before this was a message, or nothing for the default. */
  value: unknown;
  /** Called with undefined to go back to the default. */
  onChange(next: MessageBody | undefined): void;
  disabled?: boolean;
  /** One line of text instead of a preview, for a list of minor messages. */
  compact?: boolean;
  /**
   * What the feature adds under the message, drawn under the preview and
   * editable there. The settings form builds it from the schema's `attach`.
   */
  attached?: ReactNode;
  "aria-describedby"?: string;
}

// Held at module level so the dialog's memoised lists keep their identity between renders.
const FEATURE_WORDING = { sender: "The bot's name" };
const DM_HIDDEN = ["channel", "channel.name"];

interface DialogProps {
  guildId: string;
  /** Names the dialog. */
  label: string;
  starting: MessageBody;
  variables: EditorVariable[];
  delivery: "channel" | "dm";
  audience?: "public" | "private" | "dm" | undefined;
  components: boolean;
  note?: string | undefined;
  /** When the bot sends it, shown under the title. */
  help?: string | undefined;
  /** What the owner has saved, or null while the default is in use. */
  customized: MessageBody | null;
  /** Called with undefined to go back to the default. */
  onChange(next: MessageBody | undefined): void;
  onClose(): void;
}

/**
 * The editor for a message a feature sends, shared by the settings form and the
 * Bot messages page so a message is edited the same way wherever it is found.
 * Saving what the default already says stores nothing, so a later change to the
 * default still reaches this server.
 */
export function SettingMessageDialog({ guildId, label, starting, variables, delivery, audience, components, note, help, customized, onChange, onClose }: DialogProps) {
  // A reply only its reader sees is declared like a direct message, to strip
  // what Discord cannot do there, but it is not one and must not say so.
  const direct = delivery === "dm" && audience !== "private";
  const restricted = delivery === "dm";
  const componentMode = !components ? "none" : restricted ? "direct" : "all";
  return (
    <MessageEditorDialog
      guildId={guildId}
      title={label}
      hint={[help, customized ? "This is the message the bot sends instead of the usual one." : "This starts from what the bot sends now."].filter(Boolean).join(" ")}
      current={customized}
      starting={starting}
      variables={variables}
      sharedWording={FEATURE_WORDING}
      hideShared={direct ? DM_HIDDEN : undefined}
      showReactions={!restricted}
      components={componentMode}
      note={note}
      footnote={
        direct
          ? "The preview fills the variables with examples. A direct message mentions nobody."
          : audience === "private"
            ? "The preview fills the variables with examples. Only the person it answers sees it."
            : "The preview fills the variables with examples. Mentions of @everyone and @here never ping from here."
      }
      ephemeral={audience === "private"}
      textLabel="Message text"
      saveLabel="Use this message"
      resetLabel="Go back to the default"
      onSave={(message) => {
        onChange(JSON.stringify(message) === JSON.stringify(starting) ? undefined : message);
        onClose();
      }}
      onReset={() => {
        onChange(undefined);
        onClose();
      }}
      onClose={onClose}
    />
  );
}

/**
 * A message a feature sends, shown as a small preview with a button that opens
 * the message editor. The edit lands in the settings form like any other
 * control, and is only kept when the form is saved.
 */
export function MessageControl({
  id,
  guildId,
  label,
  starting,
  variables,
  delivery,
  audience,
  components,
  note,
  serverName,
  value,
  onChange,
  disabled = false,
  compact = false,
  attached,
  "aria-describedby": describedBy,
}: Props) {
  const [open, setOpen] = useState(false);
  const stored = useMemo(() => storedMessage(value), [value]);
  const customized = isCustomized(stored, starting);
  const shown = stored ?? starting;
  // The real server's name beats the stand-in a module declared for {server},
  // which was written for whichever server its author had in mind.
  const ownVariables = useMemo(() => withServerName(variables, serverName), [variables, serverName]);
  const context = useMemo(() => {
    const base = previewContextFor(guildId, ownVariables);
    return serverName ? { ...base, variables: { ...base.variables, server: serverName } } : base;
  }, [guildId, ownVariables, serverName]);

  const dialog = open ? (
    <SettingMessageDialog
      guildId={guildId}
      label={label}
      starting={starting}
      variables={ownVariables}
      delivery={delivery}
      audience={audience}
      components={components}
      note={note}
      customized={customized ? stored : null}
      onChange={onChange}
      onClose={() => setOpen(false)}
    />
  ) : null;

  if (compact) {
    const summary = messageSummary(shown);
    return (
      <div className="message-compact">
        <div className="message-compact-main">
          <p className="message-compact-text" title={summary} data-default={customized ? undefined : "true"}>
            {summary}
          </p>
          {attached ? <div className="message-compact-attached">{attached}</div> : null}
        </div>
        <div className="message-compact-actions">
          <button
            id={id}
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled}
            aria-describedby={describedBy}
            onClick={() => setOpen(true)}
          >
            Edit message
            <span className="visually-hidden"> {label}</span>
          </button>
          {customized ? (
            <button type="button" className="link-button" disabled={disabled} onClick={() => onChange(undefined)}>
              Go back to the default
            </button>
          ) : null}
        </div>
        {dialog}
      </div>
    );
  }

  const preview = (
    // A picture of the message, not a control: its links and buttons must not take focus.
    <div
      className="message-control-preview"
      ref={(node) => {
        if (!node) return;
        node.inert = true;
        node.dataset.clipped = node.scrollHeight > node.clientHeight + 1 ? "true" : "false";
      }}
      // A sample image that cannot load, such as an example address in a
      // default, would otherwise sit there as a broken-image box.
      onErrorCapture={(event) => {
        if (event.target instanceof HTMLImageElement) event.target.dataset.broken = "true";
      }}
    >
      <MessagePreview message={shown} context={context} />
    </div>
  );

  return (
    <div className="message-control">
      {attached ? (
        <div className="message-control-frame">
          {preview}
          <div className="message-control-attached">{attached}</div>
        </div>
      ) : (
        preview
      )}
      <div className="message-control-actions">
        <button
          id={id}
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled}
          aria-describedby={describedBy}
          onClick={() => setOpen(true)}
        >
          Edit message
          <span className="visually-hidden"> {label}</span>
        </button>
        {customized ? (
          <button type="button" className="link-button" disabled={disabled} onClick={() => onChange(undefined)}>
            Go back to the default
            <span className="visually-hidden"> for {label}</span>
          </button>
        ) : (
          <span className="field-hint">Using the default message.</span>
        )}
      </div>
      {dialog}
    </div>
  );
}

function withServerName(variables: EditorVariable[], serverName: string | undefined): EditorVariable[] {
  if (!serverName || !variables.some((variable) => variable.name === "server")) return variables;
  return variables.map((variable) => (variable.name === "server" ? { ...variable, sample: serverName } : variable));
}
