"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import type { FieldDescriptor, FieldTopic, MessageBody } from "@tier0/core";
import { SettingMessageDialog } from "./MessageControl";
import { Collapse } from "../Collapse";
import type { EditorVariable } from "../messages/MessageEditorDialog";
import { AlertIcon, ChevronRightIcon, SearchIcon } from "../Icons";
import { messageSummary } from "../../lib/message-summary";
import { errorSentence } from "../../lib/field-error";
import {
  currentMessage,
  filterMessages,
  groupByTopic,
  listedMessages,
  topicSize,
  type ListedMessage,
  type TopicGroup,
} from "../../lib/bot-messages";

type Fields = Record<string, FieldDescriptor>;
type Values = Record<string, unknown>;

interface Props {
  guildId: string;
  /** The top-level group drawn as this list. */
  groupKey: string;
  group: FieldDescriptor;
  /** The whole draft and the module's top-level fields: some listed messages live in other groups. */
  root: Values;
  rootFields: Fields;
  /** Replaces one message, or with undefined puts it back to the default. */
  onSet(entry: ListedMessage, next: MessageBody | undefined): void;
  errors: Record<string, string>;
  disabled: boolean;
  /** What the feature adds under a message, if anything, drawn under its row. */
  renderAttached?(entry: ListedMessage): ReactNode;
}

const AUDIENCE_LABEL = { public: "Public", private: "Only them", dm: "Direct message" } as const;
const AUDIENCE_TITLE = {
  public: "Everyone who can see the channel sees it.",
  private: "Only the person it answers sees it.",
  dm: "Sent to the person by direct message.",
} as const;

/**
 * The line that says the most: a text that is only a ping, such as `{user}`
 * above an embed, gives way to the embed's own words.
 */
function wordingOf(body: MessageBody): string {
  const embed = body.embeds[0];
  for (const candidate of [body.content, embed?.title, embed?.description]) {
    if (typeof candidate === "string" && /[A-Za-z]/.test(candidate.replace(/\{[\w.]+\}|<[@#&!]*\d+>/g, ""))) return messageSummary(candidate);
  }
  return messageSummary(body);
}

/** The message's first line, with each `{variable}` drawn as a chip so the wording reads at a glance. */
function Wording({ text }: { text: string }) {
  const parts = text.split(/(\{[\w.]+\})/g).filter((part) => part !== "");
  return (
    <>
      {parts.map((part, index) =>
        /^\{[\w.]+\}$/.test(part) ? (
          <span className="msl-var" key={index}>
            {part.slice(1, -1)}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Every message a feature sends, as one list of rows under plain headings,
 * searchable, each opening the message editor. The settings form draws a
 * group with `layout: "messages"` with it, so a feature with dozens of
 * messages needs no page of its own.
 */
export function MessageList({ guildId, groupKey, group, root, rootFields, onSet, errors, disabled, renderAttached }: Props) {
  const [query, setQuery] = useState("");
  const [customisedOnly, setCustomisedOnly] = useState(false);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const searchId = useId();

  const entries = useMemo(() => listedMessages(groupKey, rootFields, root), [groupKey, rootFields, root]);
  const topics = (group.topics ?? []) as FieldTopic[];
  const shown = filterMessages(entries, root, query, customisedOnly);
  const groups = groupByTopic(shown, topics, group.label ?? "Other");
  const customisedCount = entries.filter((entry) => currentMessage(entry, root).customised).length;
  const filtering = query.trim() !== "" || customisedOnly;
  const editingEntry = entries.find((entry) => entry.path === editing);

  const isCustomised = (entry: ListedMessage) => currentMessage(entry, root).customised;
  const hasError = (group: TopicGroup<ListedMessage>): boolean =>
    group.items.some((entry) => errors[entry.path] !== undefined) || group.children.some(hasError);

  const row = (entry: ListedMessage) => {
    const { body, customised } = currentMessage(entry, root);
    const summary = wordingOf(body);
    const error = errors[entry.path];
    const attached = renderAttached?.(entry);
    return (
      <li className="msl-item" key={entry.path} data-customised={customised ? "true" : undefined} data-invalid={error ? "true" : undefined}>
        <div className="msl-row">
          <div className="msl-what">
            <div className="msl-title-line">
              <span className="msl-title">{entry.label}</span>
              {entry.audience ? (
                <span className="msl-audience" title={AUDIENCE_TITLE[entry.audience]}>
                  {AUDIENCE_LABEL[entry.audience]}
                </span>
              ) : null}
            </div>
            {entry.help ? <p className="msl-when">{entry.help}</p> : null}
          </div>
          <p className="msl-wording" title={summary} data-default={customised ? undefined : "true"}>
            <Wording text={summary} />
          </p>
          <div className="msl-actions">
            <span className={customised ? "msl-badge msl-badge-custom" : "msl-badge"}>{customised ? "Customised" : "Default"}</span>
            <button
              type="button"
              className="link-button msl-reset"
              disabled={disabled || !customised}
              aria-hidden={customised ? undefined : "true"}
              tabIndex={customised ? undefined : -1}
              onClick={() => onSet(entry, undefined)}
            >
              Reset<span className="visually-hidden"> {entry.label} to the default</span>
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => setEditing(entry.path)}>
              Edit<span className="visually-hidden"> {entry.label}</span>
            </button>
          </div>
        </div>
        {entry.unused ? <p className="msl-unused">{entry.unused}</p> : null}
        {attached ? <div className="msl-attached">{attached}</div> : null}
        {error ? (
          <p className="field-error msl-error" role="alert">
            <AlertIcon />
            {errorSentence(error)}
          </p>
        ) : null}
      </li>
    );
  };

  const subgroup = (child: TopicGroup<ListedMessage>) => {
    const open = filtering || hasError(child) || (toggled[child.id] ?? false);
    const listId = `msl-${groupKey}-${child.id}`;
    const changed = topicSize(child, isCustomised);
    return (
      <div className="msl-sub" key={child.id} data-open={open ? "true" : "false"}>
        <h4 className="msl-sub-heading">
          <button
            type="button"
            className="msl-sub-toggle"
            aria-expanded={open}
            aria-controls={listId}
            disabled={filtering}
            onClick={() => setToggled((state) => ({ ...state, [child.id]: !open }))}
          >
            <ChevronRightIcon className="msl-chevron" />
            <span className="msl-sub-title">{child.label}</span>
            <span className="msl-count">{topicSize(child)}</span>
            {changed > 0 ? <span className="msl-changed">{changed} customised</span> : null}
          </button>
        </h4>
        <Collapse open={open} keep>
          <ul className="msl-rows" id={listId}>
            {child.items.map(row)}
          </ul>
        </Collapse>
      </div>
    );
  };

  return (
    <div className="msl">
      <div className="msl-toolbar">
        <div className="search">
          <SearchIcon />
          <label className="visually-hidden" htmlFor={searchId}>
            Search messages
          </label>
          <input
            id={searchId}
            type="search"
            className="input"
            value={query}
            placeholder="Search messages"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button type="button" className="cmd-chip" aria-pressed={customisedOnly} onClick={() => setCustomisedOnly(!customisedOnly)}>
          Customised only
          <span className="cmd-chip-count">{customisedCount}</span>
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="msl-empty">
          <p>{customisedOnly && query.trim() === "" ? "No message has been customised yet." : "No message matches that."}</p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setQuery("");
              setCustomisedOnly(false);
            }}
          >
            Show every message
          </button>
        </div>
      ) : (
        groups.map((topic) => (
          <section className="msl-topic" key={topic.id} aria-labelledby={`msl-${groupKey}-${topic.id || "other"}-title`}>
            <div className="msl-topic-head">
              <h3 className="msl-topic-title" id={`msl-${groupKey}-${topic.id || "other"}-title`}>
                {topic.label}
              </h3>
              {topic.help ? <p className="msl-topic-help">{topic.help}</p> : null}
            </div>
            {topic.items.length > 0 ? <ul className="msl-rows">{topic.items.map(row)}</ul> : null}
            {topic.children.length > 0 ? <div className="msl-subs">{topic.children.map(subgroup)}</div> : null}
          </section>
        ))
      )}

      {editingEntry ? (
        <SettingMessageDialog
          guildId={guildId}
          label={editingEntry.label}
          help={editingEntry.help || undefined}
          starting={editingEntry.field.starting as MessageBody}
          variables={(editingEntry.field.variables as EditorVariable[] | undefined) ?? []}
          delivery={editingEntry.field.delivery === "dm" ? "dm" : "channel"}
          audience={editingEntry.field.audience as "public" | "private" | "dm" | undefined}
          components={editingEntry.field.components !== false}
          note={editingEntry.field.note as string | undefined}
          customized={(() => {
            const current = currentMessage(editingEntry, root);
            return current.customised ? current.body : null;
          })()}
          onChange={(next) => onSet(editingEntry, next)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
