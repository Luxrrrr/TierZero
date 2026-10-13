"use client";

import { useState, type RefObject } from "react";
import { MESSAGE_LIMITS, emptyEmbed, type MessageButton, type MessageEmbed, type MessageError, type MessageSelect } from "@tier0/core";
import { PlusIcon } from "../Icons";
import { EmbedEditor } from "./EmbedEditor";
import { ButtonsEditor, SelectsEditor } from "./ComponentsEditor";
import { ReactionsEditor } from "./ExtrasEditor";
import { ToolBar, ToolsProvider, useToolTarget, type InsertVariable } from "./InsertBar";

export interface MessageDraft {
  content: string;
  embeds: MessageEmbed[];
  buttons: MessageButton[];
  selects: MessageSelect[];
  reactions: string[];
}

interface Props {
  guildId: string;
  value: MessageDraft;
  onChange(next: MessageDraft): void;
  errors: MessageError[];
  /** What the Variables tool offers. Left out, it offers the ones every message has. */
  variables?: readonly InsertVariable[];
  /** Replies only the person who ran a command sees cannot carry reactions, so a command hides the card. */
  showReactions?: boolean;
  /**
   * Which buttons and menus the message can carry. A direct message takes every
   * button but only text menus, and some places take no components at all.
   */
  components?: "all" | "direct" | "none";
  /** The text a problem is shown under, when it is not the first thing the person typed. */
  problems?: MessageError[];
  /** Shown above the text box. Defaults to "Message text". */
  textLabel?: string;
}

/**
 * Everything a message is made of, as one form: the text, the embeds, the link
 * buttons and the reactions. The Messages page and a command's reply editor
 * share it, so a reply can be built with every tool a sent message has.
 */
export function MessageForm(props: Props) {
  return (
    <ToolsProvider>
      <MessageFormBody {...props} />
    </ToolsProvider>
  );
}

function MessageFormBody({ guildId, value, onChange, errors, variables, showReactions = true, components = "all", problems, textLabel = "Message text" }: Props) {
  const [addedEmbed, setAddedEmbed] = useState<number | null>(null);
  const target = useToolTarget(value.content, (content) => onChange({ ...value, content }), textLabel, "full");
  const shown = problems ?? errors;

  return (
    <div className="msg-form">
      <ToolBar guildId={guildId} variables={variables} />

      <div className="card msg-card">
        <div className="field-label-row">
          <label className="field-label" htmlFor="msg-content">
            {textLabel}
          </label>
          <span className="field-hint" data-over={value.content.length > MESSAGE_LIMITS.content ? "true" : undefined}>
            {value.content.length} / {MESSAGE_LIMITS.content}
          </span>
        </div>
        <textarea
          id="msg-content"
          ref={target.ref as RefObject<HTMLTextAreaElement>}
          onFocus={target.onFocus}
          className="textarea"
          rows={5}
          placeholder="Write the message. Use the tools above for formatting, variables, times, mentions and emoji."
          value={value.content}
          onChange={(event) => onChange({ ...value, content: event.target.value })}
        />
        {errors.find((e) => e.path === "content") ? <p className="field-error">{errors.find((e) => e.path === "content")?.message}</p> : null}
      </div>

      {value.embeds.map((embed, index) => (
        <EmbedEditor
          key={index}
          embed={embed}
          index={index}
          total={value.embeds.length}
          errors={errors}
          defaultOpen={index === addedEmbed || value.embeds.length === 1}
          onChange={(next) => onChange({ ...value, embeds: value.embeds.map((e, i) => (i === index ? next : e)) })}
          onRemove={() => onChange({ ...value, embeds: value.embeds.filter((_, i) => i !== index) })}
          onMove={(direction) => {
            const to = index + direction;
            if (to < 0 || to >= value.embeds.length) return;
            const embeds = [...value.embeds];
            const moved = embeds[index];
            const swapped = embeds[to];
            if (!moved || !swapped) return;
            embeds[index] = swapped;
            embeds[to] = moved;
            onChange({ ...value, embeds });
          }}
          onDuplicate={() => {
            if (value.embeds.length >= MESSAGE_LIMITS.embeds) return;
            const embeds = [...value.embeds];
            embeds.splice(index + 1, 0, structuredClone(embed));
            onChange({ ...value, embeds });
            setAddedEmbed(index + 1);
          }}
        />
      ))}

      {value.embeds.length < MESSAGE_LIMITS.embeds ? (
        <button
          type="button"
          className="btn btn-secondary msg-add-embed"
          onClick={() => {
            onChange({ ...value, embeds: [...value.embeds, emptyEmbed()] });
            setAddedEmbed(value.embeds.length);
          }}
        >
          <PlusIcon /> Add an embed
        </button>
      ) : (
        <p className="field-hint">A message can have at most {MESSAGE_LIMITS.embeds} embeds.</p>
      )}

      {components !== "none" ? (
        <ButtonsEditor guildId={guildId} buttons={value.buttons} selectCount={value.selects.length} errors={errors} onChange={(buttons) => onChange({ ...value, buttons })} />
      ) : null}
      {components !== "none" ? (
        <SelectsEditor guildId={guildId} selects={value.selects} buttonCount={value.buttons.length} errors={errors} textOnly={components === "direct"} onChange={(selects) => onChange({ ...value, selects })} />
      ) : null}
      {showReactions ? (
        <ReactionsEditor guildId={guildId} reactions={value.reactions} errors={errors} onChange={(reactions) => onChange({ ...value, reactions })} />
      ) : null}

      {shown.length > 0 ? (
        <div className="msg-problems" role="alert">
          <p className="msg-problems-title">
            {shown.length === 1 ? "One thing to fix before this can be saved or sent" : `${shown.length} things to fix before this can be saved or sent`}
          </p>
          <ul>
            {shown.slice(0, 6).map((error, i) => (
              <li key={i}>{error.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
