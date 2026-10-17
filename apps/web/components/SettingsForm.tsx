"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { FieldDescriptor, FieldTopic, MessageAttach, MessageBody, RowDescription } from "@tier0/core";
import { describeDuration, shortDuration } from "../lib/duration";
import { conditionMet, type Condition } from "../lib/field-condition";
import {
  collapsibleRuns,
  groupsWithErrors,
  hashTarget,
  opensOnEnable,
  runIsOpen,
  toggled,
  toggleRun,
  withOpen,
} from "../lib/group-open";
import { humanize, summarizeGroup } from "../lib/row-summary";
import { getAt, groupByTopic, isChanged, listedFields, setAt, type ListedMessage } from "../lib/bot-messages";
import { defaultsFor, isGenerated, makeRowId, withFreshIds } from "../lib/row-defaults";
import { arrayItemPath, objectChildPath } from "../lib/schema-paths";
import { settingsSections } from "../lib/settings-sections";
// Imported one file at a time rather than through the barrel, which re-exports
// this module in turn.
import { ChannelPicker, MultiChannelPicker } from "./form/ChannelPicker";
import { DurationInput } from "./form/DurationInput";
import { EmojiInput } from "./form/EmojiInput";
import { Field, type FieldChrome } from "./form/Field";
import { MessageControl } from "./form/MessageControl";
import { MultiChoice } from "./form/MultiChoice";
import { SectionedSettings, type ExtraSection } from "./form/SectionedSettings";
import { AttachedComponents } from "./form/AttachedComponents";
import { MessageList } from "./form/MessageList";
import { ChevronRightIcon } from "./Icons";
import { ObjectArray, type RowsContext } from "./form/ObjectArray";
import { MultiRolePicker, RolePicker } from "./form/RolePicker";
import { Select, type SelectOption } from "./form/Select";
import { Switch } from "./form/Switch";
import { TagInput } from "./form/TagInput";
import { TemplateEditor } from "./form/TemplateEditor";
import type { EditorVariable } from "./messages/MessageEditorDialog";

interface Props {
  schema: FieldDescriptor;
  value: Record<string, unknown>;
  guildId: string;
  onChange(next: Record<string, unknown>): void;
  /** Keyed by the dotted, indexed path the bot reports a failure against. */
  errors?: Record<string, string>;
  /** Set while a save is in flight, so nothing can be edited underneath it. */
  disabled?: boolean;
  /** Substituted into message previews. */
  serverName?: string;
  /**
   * Heading for the card holding every field that is not a group of its own.
   * The quick setup shows a handful of fields out of a much larger schema,
   * where "General" reads as though something has been left out.
   */
  generalLabel?: string;
  /** The module being edited, for the row status lines and actions the bot offers. */
  moduleId?: string;
  /** Which of its lists have a status line or actions, keyed by schema path. */
  rows?: Record<string, RowDescription>;
  /** Why row actions cannot run right now; null when they can. */
  actionsLocked?: string | null;
  /** The draft has edits the bot has not been given, so its view of the rows is stale. */
  dirty?: boolean;
  /** Bumped by the page each time a save lands, so lists ask the bot again. */
  savedRevision?: number;
  /**
   * Whether groups the schema marks `collapsible` fold up. The quick setup
   * turns it off: it shows a few fields and wants all of them in view.
   */
  collapse?: boolean;
  /**
   * Whether a schema that names `section`s is split into them, with a
   * navigation beside the form. The quick setup turns it off for the same
   * reason as `collapse`.
   */
  sections?: boolean;
  /**
   * Whether the rows of a list start open. The quick setup turns it on: the
   * few settings it asks about inside a row should be on screen, not one
   * Edit button away.
   */
  openRows?: boolean;
  /** Drawn at the top of a section, keyed by its id: a status line about what that part configures, say. */
  sectionIntro?: Record<string, ReactNode>;
  /** Entries of the page's own after the schema's sections, such as the feature's commands. */
  extraSections?: ExtraSection[];
}

interface RenderContext {
  guildId: string;
  errors: Record<string, string>;
  disabled: boolean;
  serverName: string | undefined;
  rows: RowsContext | undefined;
  openRows: boolean;
  /** A top-level key whose label the card title already says, so the field keeps its own for screen readers only. */
  hiddenLabel?: string;
  /** The whole draft and the module's top-level fields, for a control that edits settings elsewhere, as an attached button does. */
  root: Record<string, unknown>;
  rootFields: Fields;
  setRoot(next: Record<string, unknown>): void;
  /**
   * Drawn in a group with `layout: "fields"`: each changed setting offers a link
   * back to its default, and a template is one line in its column.
   */
  listed?: boolean;
}

/** Where a field sits: the object beside it, so a control can read and write its siblings. */
interface Place {
  siblings: Record<string, unknown>;
  siblingFields: Fields;
  setSiblings(next: Record<string, unknown>): void;
  /** The path of that object, as errors are keyed. */
  parentPath: string;
}

type Fields = Record<string, FieldDescriptor>;

/**
 * Renders a module's settings page from its schema.
 *
 * This is the only place in the dashboard that knows what a settings control
 * looks like. A new module gets its form from here without a line of UI code of
 * its own, which is the whole reason the schema carries display metadata.
 */
export function SettingsForm({
  schema,
  value,
  guildId,
  onChange,
  errors = {},
  disabled = false,
  serverName,
  generalLabel = "General",
  moduleId,
  rows,
  actionsLocked = null,
  dirty = false,
  savedRevision = 0,
  collapse = true,
  sections = true,
  openRows = false,
  sectionIntro,
  extraSections = [],
}: Props) {
  const fields = (schema.fields ?? {}) as Fields;
  const entries = Object.entries(fields);
  const collapsibleKeys = collapse
    ? entries.filter(([, field]) => field.kind === "object" && field.collapsible === true).map(([key]) => key)
    : [];
  const keySignature = collapsibleKeys.join("|");
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groupsWithErrors(errors, collapsibleKeys)),
  );

  // A save that comes back refused must not leave the reason folded away.
  const failing = groupsWithErrors(errors, collapsibleKeys).join("|");
  useEffect(() => {
    if (failing !== "") setOpen((current) => withOpen(current, failing.split("|")));
  }, [failing]);

  // Read after mount: the server render has no URL to read it from.
  useEffect(() => {
    const keys = keySignature === "" ? [] : keySignature.split("|");
    function followHash() {
      const target = hashTarget(window.location.hash, keys);
      if (target === undefined) return;
      setOpen((current) => withOpen(current, [target]));
      requestAnimationFrame(() => document.getElementById(`group-${target}`)?.scrollIntoView({ block: "start" }));
    }
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, [keySignature]);
  const ctx: RenderContext = {
    guildId,
    errors,
    disabled,
    serverName,
    rows:
      moduleId !== undefined && rows !== undefined
        ? { moduleId, descriptions: rows, locked: actionsLocked, dirty, revision: savedRevision }
        : undefined,
    openRows,
    root: value,
    rootFields: fields,
    setRoot: onChange,
  };

  const groupCards = (
    subset: [string, FieldDescriptor][],
    loose: { id: string; title: string; hideLoneLabel: boolean },
  ): ReactNode[] => {
    const looseEntries = subset.filter(([, field]) => field.kind !== "object");
    const firstLooseKey = looseEntries[0]?.[0];
    // A part of the page that is one list and nothing else, such as a list of
    // panels, has its card named after the list rather than after the part.
    const lone = loose.hideLoneLabel && looseEntries.length === 1 ? looseEntries[0] : undefined;
    const looseTitle = lone ? (lone[1].label ?? humanize(lone[0])) : loose.title;

    const sequence: { key: string; collapsible: boolean }[] = [];
    for (const [key, field] of subset) {
      if (field.kind !== "object") {
        if (key === firstLooseKey) sequence.push({ key: loose.id, collapsible: false });
        continue;
      }
      sequence.push({ key, collapsible: collapsibleKeys.includes(key) });
    }
    const runStarts = new Map(collapsibleRuns(sequence).map((run) => [run[0], run] as const));

    const cards: ReactNode[] = [];
    for (const [key, field] of subset) {
      if (field.kind !== "object") {
        // Everything that is not a group of its own shares one card, drawn where
        // the first of them appears.
        if (key !== firstLooseKey) continue;
        cards.push(
          <section className="card settings-group" id={loose.id} key={loose.id}>
            <div className="card-header">
              <div className="card-header-text">
                <h2 className="card-title" id={`${loose.id}-title`}>
                  {looseTitle}
                </h2>
              </div>
            </div>
            <div className="settings-group-body">
              {renderFieldList(looseEntries, fields, value, "", lone ? { ...ctx, hiddenLabel: lone[0] } : ctx, onChange)}
            </div>
          </section>,
        );
        continue;
      }

      const run = runStarts.get(key);
      if (run) {
        cards.push(
          <div className="group-tools" key={`tools-${key}`}>
            <button
              type="button"
              className="link-button"
              onClick={() => setOpen((current) => toggleRun(current, run))}
            >
              {runIsOpen(open, run) ? "Collapse all" : "Expand all"}
            </button>
          </div>,
        );
      }

      cards.push(
        <Group
          key={key}
          groupKey={key}
          field={field}
          value={asRecord(value[key])}
          ctx={ctx}
          onChange={(next) => onChange({ ...value, [key]: next })}
          fold={
            collapsibleKeys.includes(key)
              ? {
                  open: open.has(key),
                  onToggle: () => setOpen((current) => toggled(current, key)),
                  onOpen: () => setOpen((current) => withOpen(current, [key])),
                }
              : undefined
          }
        />,
      );
    }
    return cards;
  };

  const parts = sections ? settingsSections(schema) : null;
  if (!parts) {
    return (
      <div className="settings-groups">
        {/* A card holding one setting is named after it: "Role menus", not "General". */}
        {groupCards(entries, { id: "group-general", title: generalLabel, hideLoneLabel: true })}
      </div>
    );
  }

  return (
    <SectionedSettings
      sections={parts}
      errors={errors}
      intro={sectionIntro}
      extra={extraSections}
      render={(section) => (
        <div className="settings-groups">
          {groupCards(
            entries.filter(([key]) => section.keys.includes(key)),
            { id: `group-general-${section.id}`, title: section.label, hideLoneLabel: true },
          )}
        </div>
      )}
    />
  );
}

interface GroupProps {
  groupKey: string;
  field: FieldDescriptor;
  value: Record<string, unknown>;
  ctx: RenderContext;
  onChange(next: Record<string, unknown>): void;
  /** Present when the group folds up; absent for a plain card. */
  fold?: { open: boolean; onToggle(): void; onOpen(): void };
}

/**
 * A top-level object is a card. When its first field is a boolean called
 * `enabled`, that switch belongs in the header rather than the body: it governs
 * everything below it, and reading it as one more setting in the list makes the
 * group look off when it is on.
 *
 * A group the schema marks collapsible keeps the same card, but its header
 * becomes the button that opens the body, with the switch beside the button
 * rather than inside it: a switch nested in a button is not valid markup, and
 * pressing it must not fold the section.
 */
function Group({ groupKey, field, value, ctx, onChange, fold }: GroupProps) {
  const fields = (field.fields ?? {}) as Fields;
  const entries = Object.entries(fields);
  const [first] = entries;
  const switchField =
    first !== undefined && first[0] === "enabled" && first[1].kind === "boolean"
      ? first[1]
      : undefined;
  const body = switchField ? entries.slice(1) : entries;

  const enabled = switchField
    ? typeof value.enabled === "boolean"
      ? value.enabled
      : switchField.default === true
    : true;
  const titleId = `group-${groupKey}-title`;
  const title = field.label ?? humanize(groupKey);
  const flush = body.length > 0 && body.every(([, child]) => isCompactMessage(child));

  const switchControl = switchField ? (
    <span className="switch-labelled">
      <span className="switch-text">{enabled ? "On" : "Off"}</span>
      <Switch
        checked={enabled}
        disabled={ctx.disabled}
        aria-labelledby={titleId}
        onChange={(next) => {
          if (fold && opensOnEnable(next, fields, value)) fold.onOpen();
          onChange({ ...value, enabled: next });
        }}
      />
    </span>
  ) : null;

  const bodyNode = (extra: { id?: string; hidden?: boolean }) => (
    <div
      className="settings-group-body"
      id={extra.id}
      hidden={extra.hidden}
      data-off={enabled ? undefined : "true"}
      data-flush={flush && field.layout === undefined ? "true" : undefined}
      data-layout={typeof field.layout === "string" ? field.layout : undefined}
    >
      {field.layout === "messages" ? (
        <MessageList
          guildId={ctx.guildId}
          groupKey={groupKey}
          group={field}
          root={ctx.root}
          rootFields={ctx.rootFields}
          errors={ctx.errors}
          disabled={ctx.disabled}
          onSet={(entry, next) => ctx.setRoot(setAt(ctx.root, entry.segments, next))}
          renderAttached={(entry) => attachedInList(entry, ctx)}
        />
      ) : field.layout === "fields" ? (
        topicFields(field, value, groupKey, ctx, onChange)
      ) : (
        renderFieldList(body, fields, value, groupKey, ctx, onChange)
      )}
    </div>
  );

  // The quick setup draws a group with only some of its settings, and carries
  // the ones its summary needs alongside.
  const summaryFields = { ...((field.summaryFields ?? {}) as Fields), ...fields };
  const effective: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(summaryFields)) effective[key] = value[key] ?? child.default;
  const summary = summarizeGroup(
    summaryFields,
    effective,
    (field.summary as string[] | undefined) ?? [],
    { duration: shortDuration },
    (key) => conditionMet(summaryFields[key]?.when as Condition | undefined, effective),
  );

  if (!fold) {
    return (
      <section className="card settings-group" id={`group-${groupKey}`}>
        <div className="card-header">
          <div className="card-header-text">
            <h2 className="card-title" id={titleId}>
              {title}
            </h2>
            {field.help ? <p className="card-help">{field.help}</p> : null}
            {summary && field.collapsible === true ? (
              <p className="card-help group-static-summary" data-off={enabled ? undefined : "true"}>
                {summary}
              </p>
            ) : null}
          </div>
          {switchControl ? <div className="card-header-actions">{switchControl}</div> : null}
        </div>
        {body.length > 0 || field.layout !== undefined ? bodyNode({}) : null}
      </section>
    );
  }
  const bodyId = `group-${groupKey}-body`;
  const helpId = field.help ? `group-${groupKey}-help` : undefined;
  const summaryId = summary ? `group-${groupKey}-summary` : undefined;

  return (
    <section
      className="card settings-group"
      id={`group-${groupKey}`}
      data-collapsible="true"
      data-open={fold.open ? "true" : "false"}
    >
      <div className="card-header group-header">
        <h2 className="group-heading">
          <button
            type="button"
            className="group-toggle"
            aria-expanded={fold.open}
            aria-controls={bodyId}
            aria-labelledby={titleId}
            aria-describedby={[helpId, summaryId].filter(Boolean).join(" ") || undefined}
            onClick={fold.onToggle}
          >
            <ChevronRightIcon className="group-chevron" />
            <span className="group-toggle-text">
              <span className="group-toggle-top">
                <span className="card-title" id={titleId}>
                  {title}
                </span>
                {field.help ? (
                  <span className="group-toggle-help" id={helpId} title={field.help}>
                    {field.help}
                  </span>
                ) : null}
              </span>
              {summary ? (
                <span className="group-toggle-summary" id={summaryId} data-off={enabled ? undefined : "true"}>
                  {summary}
                </span>
              ) : null}
            </span>
          </button>
        </h2>
        {switchControl ? <div className="card-header-actions">{switchControl}</div> : null}
      </div>
      {bodyNode({ id: bodyId, hidden: !fold.open })}
    </section>
  );
}

/**
 * A group drawn with `layout: "fields"`: its settings as labelled inputs in two
 * columns under the group's headings, each with a link back to its default. A
 * nested group named like its heading is drawn as that heading's own fields.
 */
function topicFields(
  group: FieldDescriptor,
  values: Record<string, unknown>,
  groupKey: string,
  ctx: RenderContext,
  onChange: (next: Record<string, unknown>) => void,
): ReactNode {
  const fields = (group.fields ?? {}) as Fields;
  const listed = groupByTopic(listedFields(group), (group.topics ?? []) as FieldTopic[], group.label ?? humanize(groupKey));
  const resetting = { ...ctx, listed: true };
  return listed.map((topic) => (
    <section className="topic-fields" key={topic.id} aria-labelledby={`topic-${groupKey}-${topic.id || "other"}`}>
      <h3 className="topic-fields-title" id={`topic-${groupKey}-${topic.id || "other"}`}>
        {topic.label}
      </h3>
      {topic.help ? <p className="topic-fields-help">{topic.help}</p> : null}
      <div className="form-grid form-grid-two">
        {topic.items.map(({ key, field }) => {
          if (field.kind !== "object") return renderChild(key, field, fields, values, groupKey, resetting, onChange);
          const childFields = (field.fields ?? {}) as Fields;
          const childValues = asRecord(values[key]);
          const setChild = (next: Record<string, unknown>) => onChange({ ...values, [key]: next });
          if (field.label === topic.label) {
            return Object.entries(childFields).map(([childKey, child]) =>
              renderChild(childKey, child, childFields, childValues, objectChildPath(groupKey, key), resetting, setChild),
            );
          }
          return (
            <div className="field-span" key={key}>
              {renderChild(key, field, fields, values, groupKey, resetting, onChange)}
            </div>
          );
        })}
      </div>
    </section>
  ));
}

/** The buttons a listed message carries, read and written beside the message wherever it sits. */
function attachedInList(entry: ListedMessage, ctx: RenderContext): ReactNode {
  const attach = entry.field.attach as MessageAttach | undefined;
  if (!attach || attach.kind !== "buttons") return undefined;
  const parentSegments = entry.segments.slice(0, -1);
  const parentPath = parentSegments.join(".");
  const siblings = asRecord(getAt(ctx.root, parentSegments));
  let siblingFields: Fields = ctx.rootFields;
  for (const segment of parentSegments) siblingFields = ((siblingFields[String(segment)]?.fields ?? {}) as Fields);
  return (
    <AttachedComponents
      attach={attach}
      parentPath={parentPath}
      siblings={siblings}
      siblingFields={siblingFields}
      setSiblings={(next) => ctx.setRoot(setAt(ctx.root, parentSegments, next))}
      root={ctx.root}
      rootFields={ctx.rootFields}
      setRoot={ctx.setRoot}
      errors={ctx.errors}
      disabled={ctx.disabled}
    />
  );
}

function isCompactMessage(field: FieldDescriptor): boolean {
  return field.kind === "message" && field.compact === true;
}

/**
 * The fields of a group in order. Compact messages that sit together are drawn
 * as one divided list, so a group of several reads as a table of rows rather
 * than a stack of separate fields.
 */
function renderFieldList(
  entries: [string, FieldDescriptor][],
  siblings: Fields,
  values: Record<string, unknown>,
  parentPath: string,
  ctx: RenderContext,
  onChange: (next: Record<string, unknown>) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let run: ReactNode[] = [];
  const endRun = () => {
    if (run.length === 0) return;
    nodes.push(
      <div className="compact-list" key={`compact-${nodes.length}`}>
        {run}
      </div>,
    );
    run = [];
  };

  for (const [key, child] of entries) {
    const node = renderChild(key, child, siblings, values, parentPath, ctx, onChange);
    if (isCompactMessage(child)) {
      run.push(node);
    } else {
      endRun();
      nodes.push(node);
    }
  }
  endRun();
  return nodes;
}

/** One field of an object: either a nested group, or a labelled control. */
function renderChild(
  key: string,
  field: FieldDescriptor,
  siblings: Fields,
  values: Record<string, unknown>,
  parentPath: string,
  ctx: RenderContext,
  onChange: (next: Record<string, unknown>) => void,
): ReactNode {
  // A row's id is filled in when the row is added and is never anyone's to edit.
  if (isGenerated(field)) return null;
  const path = objectChildPath(parentPath, key);
  const condition = field.when as Condition | undefined;
  const met = conditionMet(condition, values);
  const dependency = met ? undefined : dependencySentence(condition, siblings);
  const setValue = (next: unknown) => onChange({ ...values, [key]: next });

  if (field.kind === "object") {
    const childFields = (field.fields ?? {}) as Fields;
    const childValues = asRecord(values[key]);
    return (
      <div className="subgroup" key={key}>
        <h3 className="subgroup-title">{field.label ?? humanize(key)}</h3>
        {field.help ? <p className="field-help">{field.help}</p> : null}
        {dependency ? <p className="field-dependency">{dependency}</p> : null}
        <div className="form-grid">
          {renderFieldList(
            Object.entries(childFields),
            childFields,
            childValues,
            path,
            met ? ctx : { ...ctx, disabled: true },
            (next) => setValue(next),
          )}
        </div>
      </div>
    );
  }

  return (
    <ControlField
      key={key}
      name={key}
      path={path}
      field={field}
      value={values[key]}
      dependency={dependency}
      unavailable={!met}
      ctx={ctx}
      onChange={setValue}
      place={{ siblings: values, siblingFields: siblings, setSiblings: onChange, parentPath }}
    />
  );
}

interface ControlFieldProps {
  name: string;
  path: string;
  field: FieldDescriptor;
  value: unknown;
  dependency: string | undefined;
  unavailable: boolean;
  ctx: RenderContext;
  onChange(next: unknown): void;
  place?: Place;
}

function ControlField({
  name,
  path,
  field,
  value,
  dependency,
  unavailable,
  ctx,
  onChange,
  place,
}: ControlFieldProps) {
  const id = htmlId(path);
  const label = field.label ?? humanize(name);
  // Wording can be settled before whatever it waits on, such as a greeting
  // before its channel is picked; the dependency line still says when it is used.
  const disabled = ctx.disabled || (unavailable && field.kind !== "message");
  const error = ctx.errors[path];
  const optional = field.optional === true && field.essential !== true;

  const shared = {
    id,
    label,
    labelHidden: ctx.hiddenLabel === path,
    help: field.help as string | undefined,
    dependency,
    error,
    optional,
    disabled,
    action:
      ctx.listed && isChanged(field, value) ? (
        <button type="button" className="link-button field-reset" disabled={disabled} onClick={() => onChange(field.default)}>
          Reset<span className="visually-hidden"> {label} to the default</span>
        </button>
      ) : undefined,
  };

  if (field.kind === "boolean") {
    return (
      <Field {...shared} layout="row">
        {(chrome) => (
          <Switch
            id={chrome.id}
            checked={value === true}
            disabled={chrome.disabled}
            aria-labelledby={chrome.labelId}
            aria-describedby={chrome.describedBy}
            onChange={onChange}
          />
        )}
      </Field>
    );
  }

  if (isCompactMessage(field)) {
    return (
      <Field {...shared} layout="compact" span>
        {(chrome) => control(chrome, { name, path, field, value, ctx, onChange, place })}
      </Field>
    );
  }

  return (
    <Field
      {...shared}
      hint={hintFor(field, value)}
      span={ctx.listed && field.kind === "template" ? false : wantsWholeRow(field)}
      labelFor={!isComposite(field)}
    >
      {(chrome) => control(chrome, { name, path, field, value, ctx, onChange, place })}
    </Field>
  );
}

interface ControlProps {
  name: string;
  path: string;
  field: FieldDescriptor;
  value: unknown;
  ctx: RenderContext;
  onChange(next: unknown): void;
  place?: Place;
}

function control(chrome: FieldChrome, props: ControlProps): ReactNode {
  const { field, value, ctx, onChange } = props;
  const common = {
    id: chrome.id,
    disabled: chrome.disabled,
    "aria-describedby": chrome.describedBy,
  };

  switch (field.kind) {
    case "string":
      return field.multiline ? (
        <textarea
          {...common}
          className="textarea"
          rows={4}
          maxLength={field.max as number | undefined}
          value={(value as string) ?? ""}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      ) : (
        <input
          {...common}
          className="input"
          type={field.url === true ? "url" : "text"}
          inputMode={field.url === true ? "url" : undefined}
          placeholder={field.url === true ? "https://" : undefined}
          maxLength={field.max as number | undefined}
          value={(value as string) ?? ""}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      );

    case "integer":
      return (
        <input
          {...common}
          className="input input-narrow"
          type="number"
          inputMode="numeric"
          min={field.min as number | undefined}
          max={field.max as number | undefined}
          value={typeof value === "number" ? String(value) : ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
        />
      );

    case "duration":
      return (
        <DurationInput
          {...common}
          label={field.label ?? humanize(props.name)}
          value={value}
          max={field.max as string | undefined}
          min={field.min as string | undefined}
          onChange={onChange}
        />
      );

    case "choice":
      return (
        <Select
          id={common.id}
          disabled={common.disabled}
          aria-describedby={common["aria-describedby"]}
          aria-labelledby={chrome.labelId}
          options={(field.options ?? []) as SelectOption[]}
          value={typeof value === "string" ? value : undefined}
          onChange={onChange}
        />
      );

    case "emoji":
      return (
        <EmojiInput
          {...common}
          guildId={ctx.guildId}
          label={field.label ?? humanize(props.name)}
          value={typeof value === "string" ? value : undefined}
          clearable={field.optional === true}
          onChange={onChange}
        />
      );

    case "template":
      return (
        <TemplateEditor
          {...common}
          guildId={ctx.guildId}
          value={(value as string) ?? ""}
          max={field.max as number | undefined}
          placeholders={(field.placeholders as string[] | undefined) ?? []}
          samples={field.samples as Record<string, string> | undefined}
          preview={field.preview === "channel" ? "channel" : "message"}
          serverName={ctx.serverName}
          inline={ctx.listed === true}
          onChange={(next) => onChange(next || undefined)}
        />
      );

    case "message":
      return (
        <MessageControl
          {...common}
          guildId={ctx.guildId}
          label={field.label ?? humanize(props.name)}
          starting={field.starting as MessageBody}
          variables={(field.variables as EditorVariable[] | undefined) ?? []}
          delivery={field.delivery === "dm" ? "dm" : "channel"}
          audience={field.audience as "public" | "private" | "dm" | undefined}
          components={field.components !== false}
          note={field.note as string | undefined}
          compact={field.compact === true}
          serverName={ctx.serverName}
          value={value}
          onChange={onChange}
          attached={attachedFor(field, props, chrome.disabled)}
        />
      );

    case "channel":
      return (
        <ChannelPicker
          {...common}
          guildId={ctx.guildId}
          types={(field.types as string[] | undefined) ?? ["text"]}
          value={typeof value === "string" ? value : undefined}
          clearable={field.optional === true}
          hideTickets
          onChange={onChange}
        />
      );

    case "role":
      return (
        <RolePicker
          {...common}
          guildId={ctx.guildId}
          value={typeof value === "string" ? value : undefined}
          clearable={field.optional === true}
          assigns={field.assigns === true}
          onChange={onChange}
        />
      );

    case "array":
      return arrayControl(chrome, props);

    default:
      return <p className="unsupported">This setting needs a newer dashboard to edit.</p>;
  }
}

function arrayControl(chrome: FieldChrome, props: ControlProps): ReactNode {
  const { field, value, ctx, onChange, path, name } = props;
  const item = (field.of ?? { kind: "string" }) as FieldDescriptor;
  const items = Array.isArray(value) ? value : [];
  const max = field.max as number | undefined;
  const min = field.min as number | undefined;

  if (item.kind === "channel") {
    return (
      <MultiChannelPicker
        id={chrome.id}
        guildId={ctx.guildId}
        types={(item.types as string[] | undefined) ?? ["text"]}
        values={items.filter(isString)}
        max={max}
        disabled={chrome.disabled}
        aria-labelledby={chrome.labelId}
        aria-describedby={chrome.describedBy}
        onChange={onChange}
      />
    );
  }

  if (item.kind === "role") {
    return (
      <MultiRolePicker
        id={chrome.id}
        guildId={ctx.guildId}
        values={items.filter(isString)}
        assigns={item.assigns === true || field.assigns === true}
        max={max}
        disabled={chrome.disabled}
        aria-labelledby={chrome.labelId}
        aria-describedby={chrome.describedBy}
        onChange={onChange}
      />
    );
  }

  if (item.kind === "choice") {
    return (
      <MultiChoice
        id={chrome.id}
        options={(item.options ?? []) as SelectOption[]}
        values={items.filter(isString)}
        defaults={Array.isArray(field.default) ? field.default.filter(isString) : undefined}
        min={min}
        max={max}
        layout={field.layout}
        disabled={chrome.disabled}
        aria-labelledby={chrome.labelId}
        aria-describedby={chrome.describedBy}
        onChange={onChange}
      />
    );
  }

  if (item.kind === "string" || item.kind === "emoji") {
    return (
      <TagInput
        id={chrome.id}
        values={items.filter(isString)}
        max={max}
        disabled={chrome.disabled}
        aria-describedby={chrome.describedBy}
        onChange={onChange}
      />
    );
  }

  if (item.kind === "object") {
    const itemFields = (item.fields ?? {}) as Fields;
    const singular =
      typeof field.item === "string" && field.item !== ""
        ? field.item.charAt(0).toUpperCase() + field.item.slice(1)
        : singularize(field.label ?? humanize(name));
    return (
      <ObjectArray
        guildId={ctx.guildId}
        path={path}
        items={items}
        itemFields={itemFields}
        itemLabel={singular}
        min={min}
        max={max}
        disabled={chrome.disabled}
        aria-labelledby={chrome.labelId}
        rows={ctx.rows}
        openRows={ctx.openRows}
        newItem={() => defaultsFor(itemFields, makeRowId)}
        copyItem={(entry) => withFreshIds(entry, itemFields, makeRowId)}
        invalidAt={(index) => hasErrorUnder(ctx.errors, arrayItemPath(path, index))}
        onChange={onChange}
        renderRow={(entry, index) => {
          const entryPath = arrayItemPath(path, index);
          const entryValues = asRecord(entry);
          return Object.entries(itemFields).map(([childKey, childField]) =>
            renderChild(
              childKey,
              childField,
              itemFields,
              entryValues,
              entryPath,
              ctx,
              (next) => onChange(items.map((old, i) => (i === index ? next : old))),
            ),
          );
        }}
        actionInputs={{
          initial: (input) => defaultsFor((input.fields ?? {}) as Fields, makeRowId),
          render: ({ input, rowPath, actionId, value, onChange: setInput, errors, disabled }) =>
            actionInputFields(input, `${rowPath}.${actionId}`, value, setInput, errors, {
              ...ctx,
              disabled,
              rows: undefined,
            }),
        }}
      />
    );
  }

  return (
    <PrimitiveList
      chrome={chrome}
      item={item}
      items={items}
      max={max}
      ctx={ctx}
      path={path}
      onChange={onChange}
    />
  );
}

interface PrimitiveListProps {
  chrome: FieldChrome;
  item: FieldDescriptor;
  items: unknown[];
  max: number | undefined;
  ctx: RenderContext;
  path: string;
  onChange(next: unknown[]): void;
}

/** The fallback for a list of something with no picker of its own. */
function PrimitiveList({ chrome, item, items, max, ctx, path, onChange }: PrimitiveListProps) {
  const atCapacity = max !== undefined && items.length >= max;

  return (
    <div className="list" role="group" aria-labelledby={chrome.labelId}>
      {items.map((entry, index) => {
        const entryPath = arrayItemPath(path, index);
        return (
          <div className="list-item" key={index}>
            <div className="list-item-head">
              <span className="list-item-index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="list-item-summary is-placeholder">Entry {index + 1}</span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={chrome.disabled}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Remove
                <span className="visually-hidden"> entry {index + 1}</span>
              </button>
            </div>
            <div className="list-item-body">
              {control(
                { ...chrome, id: htmlId(entryPath) },
                {
                  name: String(index + 1),
                  path: entryPath,
                  field: item,
                  value: entry,
                  ctx,
                  onChange: (next) => onChange(items.map((old, i) => (i === index ? next : old))),
                },
              )}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="list-add"
        disabled={chrome.disabled || atCapacity}
        onClick={() => onChange([...items, item.default])}
      >
        {atCapacity ? `Maximum of ${max}` : "Add another"}
      </button>
    </div>
  );
}

function hintFor(field: FieldDescriptor, value: unknown): ReactNode {
  if (field.kind === "integer") {
    const min = field.min as number | undefined;
    const max = field.max as number | undefined;
    if (min !== undefined && max !== undefined) return `${min} – ${max}`;
    return undefined;
  }

  if (field.kind === "duration") {
    const max = field.max as string | undefined;
    const min = field.min as string | undefined;
    if (min && max) return `From ${describeDuration(min)} to ${describeDuration(max)}`;
    if (min) return `At least ${describeDuration(min)}`;
    return max ? `Up to ${describeDuration(max)}` : undefined;
  }

  if (field.kind === "emoji") {
    return "Pick one of this server's emoji or a standard one, or paste one. Typing :name: finds the server's emoji of that name.";
  }

  if (field.kind === "string") {
    const max = field.max as number | undefined;
    const length = typeof value === "string" ? value.length : 0;
    // Only worth the room once the limit is close enough to matter.
    if (max !== undefined && length >= max * 0.8) return `${length} / ${max}`;
    return undefined;
  }

  return undefined;
}

/**
 * A list of rows, rather than one control a label can point at. Chips and tags
 * do not count: those put their id on the button or input someone types into.
 */
function isComposite(field: FieldDescriptor): boolean {
  if (field.kind !== "array") return false;
  const item = (field.of ?? {}) as FieldDescriptor;
  return item.kind !== "channel" && item.kind !== "role" && item.kind !== "string"
    && item.kind !== "emoji";
}

function wantsWholeRow(field: FieldDescriptor): boolean {
  if (field.kind === "template" || field.kind === "message") return true;
  if (field.kind === "array") return true;
  // A web address is long; a third of a row shows thirty characters of it.
  return field.kind === "string" && (field.multiline === true || field.url === true);
}

/** The buttons or menu the schema says the feature adds under this message, editable in place. */
function attachedFor(field: FieldDescriptor, props: ControlProps, disabled: boolean): ReactNode {
  const attach = field.attach as MessageAttach | undefined;
  const { place, ctx } = props;
  if (!attach || !place) return undefined;
  const listField = attach.kind === "list" ? place.siblingFields[attach.list] : undefined;
  const rowFields = ((listField?.of as FieldDescriptor | undefined)?.fields ?? {}) as Fields;
  return (
    <AttachedComponents
      attach={attach}
      parentPath={place.parentPath}
      siblings={place.siblings}
      siblingFields={place.siblingFields}
      setSiblings={place.setSiblings}
      root={ctx.root}
      rootFields={ctx.rootFields}
      setRoot={ctx.setRoot}
      errors={ctx.errors}
      disabled={disabled}
      newItem={listField ? () => defaultsFor(rowFields, makeRowId) : undefined}
    />
  );
}

/** Explains a disabled control in terms of the setting it waits on. */
function dependencySentence(
  condition: Condition | undefined,
  siblings: Fields,
): string | undefined {
  if (!condition) return undefined;
  const sibling = siblings[condition.field];
  const label = sibling?.label ?? humanize(condition.field);

  if (condition.includes !== undefined) {
    const of = (sibling?.of ?? {}) as FieldDescriptor;
    const options = (of.options ?? []) as { value: string; label: string }[];
    const chosen = options.find((option) => option.value === condition.includes);
    return `Only used when ${label} includes ${chosen?.label ?? String(condition.includes)}.`;
  }

  if (condition.equals === undefined) return `Only used when ${label} is set.`;
  if (sibling?.kind === "boolean") {
    return `Only used when ${label} is ${condition.equals === true ? "on" : "off"}.`;
  }
  if (sibling?.kind === "choice") {
    const options = (sibling.options ?? []) as { value: string; label: string }[];
    const chosen = options.find((option) => option.value === condition.equals);
    return `Only used when ${label} is set to ${chosen?.label ?? String(condition.equals)}.`;
  }
  return `Only used when ${label} is ${String(condition.equals)}.`;
}

/**
 * An action's inputs are drawn by the same code as any other field. Their
 * errors come back keyed by field name, so they are moved under this panel's
 * own path to keep their ids apart from the settings behind it.
 */
function actionInputFields(
  input: FieldDescriptor,
  parentPath: string,
  value: Record<string, unknown>,
  onChange: (next: Record<string, unknown>) => void,
  errors: Record<string, string>,
  ctx: RenderContext,
): ReactNode {
  const fields = (input.fields ?? {}) as Fields;
  const scoped: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    scoped[objectChildPath(parentPath, key)] = message;
  }
  const panelCtx = { ...ctx, errors: scoped };
  return (
    <div className="form-grid">
      {Object.entries(fields).map(([key, field]) =>
        renderChild(key, field, fields, value, parentPath, panelCtx, (next) => onChange(next)),
      )}
    </div>
  );
}

function hasErrorUnder(errors: Record<string, string>, prefix: string): boolean {
  return Object.keys(errors).some((key) => key === prefix || key.startsWith(`${prefix}.`));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** "Role menus" becomes "Role menu", so the add button reads as one of them. */
function singularize(label: string): string {
  if (label.endsWith("ies")) return `${label.slice(0, -3)}y`;
  if (label.endsWith("ses") || label.endsWith("xes")) return label.slice(0, -2);
  if (label.endsWith("s") && !label.endsWith("ss")) return label.slice(0, -1);
  return label;
}

/** A path like `rewards[2].role` turned into a value safe as an HTML id. */
function htmlId(path: string): string {
  return `setting-${path.replace(/[[\].]/g, "-")}`;
}
