"use client";

import { useMemo, useState, type RefObject } from "react";
import { MESSAGE_LIMITS, MESSAGE_VARIABLES, emptyEmbed, type MessageButton, type MessageEmbed, type MessageError, type MessageSelect } from "@tier0/core";
import { fromCode, toCode } from "../../lib/message-code";
import { mentionTokens, unknownVariables } from "../../lib/message-variables";
import { useChannels, useRoles } from "../form";
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
  // A name the bot does not know is sent exactly as typed, braces and all, which is easy to miss in a preview.
  const unknown = useMemo(
    () => unknownVariables(value, (variables ?? MESSAGE_VARIABLES).map((variable) => variable.name)),
    [value, variables],
  );

  return (
    <div className="msg-form">
      <ToolBar guildId={guildId} variables={variables} />

      {unknown.length > 0 ? (
        <div className="msg-warning" role="status">
          <p className="msg-problems-title">
            {unknown.length === 1 ? "A variable this message does not know" : "Variables this message does not know"}
          </p>
          <ul>
            {unknown.slice(0, 6).map((name) => (
              <li key={name}>
                <code>{`{${name}}`}</code> is sent exactly as typed. Check the spelling, or pick one from Variables.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
          onFocus={target.onFocus} onKeyDown={target.onKeyDown}
          className="textarea"
          rows={5}
          placeholder="Write the message. Use the tools above for formatting, variables, times, mentions and emoji."
          value={value.content}
          onChange={(event) => onChange({ ...value, content: event.target.value })}
        />
        {errors.find((e) => e.path === "content") ? <p className="field-error">{errors.find((e) => e.path === "content")?.message}</p> : null}
        <MentionKey guildId={guildId} text={value.content} />
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

      <CodeView value={value} onChange={onChange} components={components !== "none"} reactions={showReactions} />

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

/**
 * The message as JSON, for copying out or pasting in. While the box has not been
 * typed in it follows the form, and once it has, it keeps what was typed until it
 * is applied or discarded. Only what this message can carry is shown: a reply
 * with no room for menus has none in its code, and code that brings some is not
 * applied to it.
 */
function CodeView({ value, onChange, components, reactions }: { value: MessageDraft; onChange(next: MessageDraft): void; components: boolean; reactions: boolean }) {
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const visible = useMemo<MessageDraft>(
    () => ({ ...value, buttons: components ? value.buttons : [], selects: components ? value.selects : [], reactions: reactions ? value.reactions : [] }),
    [value, components, reactions],
  );
  const generated = useMemo(() => toCode(visible), [visible]);
  const shown = typed ?? generated;

  function apply() {
    const result = fromCode(typed ?? generated, visible);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    onChange({
      ...result.value,
      buttons: components ? result.value.buttons : value.buttons,
      selects: components ? result.value.selects : value.selects,
      reactions: reactions ? result.value.reactions : value.reactions,
    });
    setTyped(null);
    setProblem(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setProblem("The browser wouldn't copy it. Select the text and copy it by hand.");
    }
  }

  return (
    <details className="card msg-card msg-code">
      <summary className="field-label">Code</summary>
      <p className="field-hint">
        The message as JSON, so you can copy it out or paste one made elsewhere. Text and embeds are written the way Discord writes them. Buttons, menus and reactions follow in the form this dashboard keeps them, with what each one does. Anything the code leaves out stays as it is.
      </p>
      <textarea
        className="textarea msg-code-box"
        rows={14}
        spellCheck={false}
        aria-label="Message as JSON"
        value={shown}
        onChange={(event) => {
          setTyped(event.target.value);
          setProblem(null);
        }}
      />
      {problem ? <p className="field-error">{problem}</p> : null}
      <div className="msg-code-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={typed === null} onClick={apply}>
          Apply
        </button>
        {typed !== null ? (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              setTyped(null);
              setProblem(null);
            }}
          >
            Discard changes
          </button>
        ) : null}
      </div>
    </details>
  );
}

/**
 * What each raw mention in the text is. The text box has to show `<#123...>`
 * as Discord stores it, so the name of the channel, role or member is listed
 * under it instead.
 */
function MentionKey({ guildId, text }: { guildId: string; text: string }) {
  const tokens = useMemo(() => mentionTokens(text), [text]);
  const { channels } = useChannels(guildId);
  const { roles } = useRoles(guildId);
  if (tokens.length === 0) return null;
  const nameOf = (kind: string, id: string) =>
    kind === "channel"
      ? `#${channels.find((channel) => channel.id === id)?.name ?? "deleted channel"}`
      : kind === "role"
        ? `@${roles.find((role) => role.id === id)?.name ?? "deleted role"}`
        : "a member";
  return (
    <ul className="msg-mention-key" aria-label="Mentions in this text">
      {tokens.slice(0, 8).map((entry) => (
        <li key={entry.token}>
          <code>{entry.token}</code> is {nameOf(entry.kind, entry.id)}
        </li>
      ))}
    </ul>
  );
}
