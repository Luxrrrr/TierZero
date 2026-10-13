"use client";

import type { ReactNode } from "react";
import type { FieldCondition, FieldDescriptor, MessageBody, RowDescription } from "@tier0/core";
import { describeDuration } from "../lib/duration";
import { isBlank } from "../lib/module-status";
import { humanize } from "../lib/row-summary";
import { arrayItemPath, objectChildPath } from "../lib/schema-paths";
// Imported one file at a time rather than through the barrel, which re-exports
// this module in turn.
import { ChannelPicker, MultiChannelPicker } from "./form/ChannelPicker";
import { DurationInput } from "./form/DurationInput";
import { Field, type FieldChrome } from "./form/Field";
import { MessageControl } from "./form/MessageControl";
import { ObjectArray, type RowsContext } from "./form/ObjectArray";
import { MultiRolePicker, RolePicker } from "./form/RolePicker";
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
}

interface RenderContext {
  guildId: string;
  errors: Record<string, string>;
  disabled: boolean;
  serverName: string | undefined;
  rows: RowsContext | undefined;
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
}: Props) {
  const fields = (schema.fields ?? {}) as Fields;
  const entries = Object.entries(fields);
  const ctx: RenderContext = {
    guildId,
    errors,
    disabled,
    serverName,
    rows:
      moduleId !== undefined && rows !== undefined
        ? { moduleId, descriptions: rows, locked: actionsLocked, dirty, revision: savedRevision }
        : undefined,
  };

  const loose = entries.filter(([, field]) => field.kind !== "object");
  const firstLooseKey = loose[0]?.[0];

  const cards: ReactNode[] = [];
  for (const [key, field] of entries) {
    if (field.kind !== "object") {
      // Everything that is not a group of its own shares one card, drawn where
      // the first of them appears.
      if (key !== firstLooseKey) continue;
      cards.push(
        <section className="card settings-group" id="group-general" key="group-general">
          <div className="card-header">
            <div className="card-header-text">
              <h2 className="card-title" id="group-general-title">
                {generalLabel}
              </h2>
            </div>
          </div>
          <div className="settings-group-body">
            {loose.map(([looseKey, looseField]) =>
              renderChild(looseKey, looseField, fields, value, "", ctx, onChange),
            )}
          </div>
        </section>,
      );
      continue;
    }

    cards.push(
      <Group
        key={key}
        groupKey={key}
        field={field}
        value={asRecord(value[key])}
        ctx={ctx}
        onChange={(next) => onChange({ ...value, [key]: next })}
      />,
    );
  }

  return <div className="settings-groups">{cards}</div>;
}

interface GroupProps {
  groupKey: string;
  field: FieldDescriptor;
  value: Record<string, unknown>;
  ctx: RenderContext;
  onChange(next: Record<string, unknown>): void;
}

/**
 * A top-level object is a card. When its first field is a boolean called
 * `enabled`, that switch belongs in the header rather than the body: it governs
 * everything below it, and reading it as one more setting in the list makes the
 * group look off when it is on.
 */
function Group({ groupKey, field, value, ctx, onChange }: GroupProps) {
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

  return (
    <section className="card settings-group" id={`group-${groupKey}`}>
      <div className="card-header">
        <div className="card-header-text">
          <h2 className="card-title" id={titleId}>
            {field.label ?? humanize(groupKey)}
          </h2>
          {field.help ? <p className="card-help">{field.help}</p> : null}
        </div>
        {switchField ? (
          <div className="card-header-actions">
            <span className="switch-labelled">
              <span className="switch-text">{enabled ? "On" : "Off"}</span>
              <Switch
                checked={enabled}
                disabled={ctx.disabled}
                aria-labelledby={titleId}
                onChange={(next) => onChange({ ...value, enabled: next })}
              />
            </span>
          </div>
        ) : null}
      </div>
      <div className="settings-group-body" data-off={enabled ? undefined : "true"}>
        {body.map(([key, child]) =>
          renderChild(key, child, fields, value, groupKey, ctx, onChange),
        )}
      </div>
    </section>
  );
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
  const path = objectChildPath(parentPath, key);
  const condition = field.when as FieldCondition | undefined;
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
          {Object.entries(childFields).map(([childKey, childField]) =>
            renderChild(
              childKey,
              childField,
              childFields,
              childValues,
              path,
              met ? ctx : { ...ctx, disabled: true },
              (next) => setValue(next),
            ),
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
}: ControlFieldProps) {
  const id = htmlId(path);
  const label = field.label ?? humanize(name);
  const disabled = ctx.disabled || unavailable;
  const error = ctx.errors[path];
  const optional = field.optional === true && field.essential !== true;

  const shared = {
    id,
    label,
    help: field.help as string | undefined,
    dependency,
    error,
    optional,
    disabled,
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

  return (
    <Field
      {...shared}
      hint={hintFor(field, value)}
      span={wantsWholeRow(field)}
      labelFor={!isComposite(field)}
    >
      {(chrome) => control(chrome, { name, path, field, value, ctx, onChange })}
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
          type="text"
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
          onChange={onChange}
        />
      );

    case "choice": {
      const options = (field.options ?? []) as { value: string; label: string }[];
      const current = typeof value === "string" ? value : "";
      return (
        <select
          {...common}
          className="select"
          value={current}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          {options.some((option) => option.value === current) ? null : (
            <option value="">Choose an option</option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    case "emoji":
      return (
        <input
          {...common}
          className="input emoji-input"
          type="text"
          placeholder="🙂"
          value={(value as string) ?? ""}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      );

    case "template":
      return (
        <TemplateEditor
          {...common}
          value={(value as string) ?? ""}
          max={field.max as number | undefined}
          placeholders={(field.placeholders as string[] | undefined) ?? []}
          serverName={ctx.serverName}
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
          components={field.components !== false}
          note={field.note as string | undefined}
          value={value}
          onChange={onChange}
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
        max={max}
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
    const singular = singularize(field.label ?? humanize(name));
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
        newItem={() => defaultsFor(itemFields)}
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
          initial: (input) => defaultsFor((input.fields ?? {}) as Fields),
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
    return max ? `Up to ${describeDuration(max)}` : undefined;
  }

  if (field.kind === "emoji") {
    return (
      <>
        A unicode emoji, or Discord&apos;s custom form: <code>&lt;:name:id&gt;</code>, or{" "}
        <code>&lt;a:name:id&gt;</code> for an animated one.
      </>
    );
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
  return field.kind === "string" && field.multiline === true;
}

function conditionMet(
  condition: FieldCondition | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  const actual = values[condition.field];
  if (condition.equals === undefined) return !isBlank(actual);
  return actual === condition.equals;
}

/** Explains a disabled control in terms of the setting it waits on. */
function dependencySentence(
  condition: FieldCondition | undefined,
  siblings: Fields,
): string | undefined {
  if (!condition) return undefined;
  const sibling = siblings[condition.field];
  const label = sibling?.label ?? humanize(condition.field);

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

/** A new list entry starts with whatever the schema says the defaults are. */
function defaultsFor(fields: Fields): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.kind === "array") item[key] = [];
    else if (field.kind === "object") item[key] = defaultsFor((field.fields ?? {}) as Fields);
    else if (field.default !== undefined) item[key] = field.default;
  }
  return item;
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
