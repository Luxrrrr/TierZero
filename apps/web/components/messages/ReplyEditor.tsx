"use client";

import { type MessageBody, type ResponseTemplate } from "@tier0/core";
import { MessageEditorDialog } from "./MessageEditorDialog";

interface Props {
  guildId: string;
  /** The command, as the sheet names it. */
  commandName: string;
  template: ResponseTemplate;
  /** The reply the owner has saved, or null while the command still says what it always says. */
  current: MessageBody | null;
  /** Whether the reply is shown only to the person who ran the command. Private replies cannot carry reactions. */
  isPrivate: boolean;
  /** When the command sends it, shown under the title. */
  help?: string;
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

/** A command's reply, edited with the same builder as a message sent from the Messages page. */
export function ReplyEditor({ guildId, commandName, template, current, isPrivate, help, onSave, onReset, onClose }: Props) {
  return (
    <MessageEditorDialog
      guildId={guildId}
      title={`Reply for ${commandName}`}
      hint={[help, current === null ? "This starts from what the command says now." : "This is the reply members get instead of the usual one."].filter(Boolean).join(" ")}
      current={current}
      starting={template.starting}
      variables={template.placeholders}
      sharedWording={COMMAND_WORDING}
      showReactions={!isPrivate}
      note={template.note}
      footnote="The preview fills the variables with examples. Mentions of @everyone and @here never ping from a reply."
      textLabel="Reply text"
      ephemeral={isPrivate}
      saveLabel="Save reply"
      resetLabel="Go back to the command's own reply"
      onSave={onSave}
      onReset={onReset}
      onClose={onClose}
    />
  );
}
