"use client";

import { useRef, useState } from "react";
import type { FieldDescriptor } from "@tier0/core";
import { ChannelPicker, RolePicker } from "./pickers";
import { arrayItemPath, objectChildPath } from "../lib/schema-paths";
import { AlertIcon } from "./Icons";

interface Props {
  schema: FieldDescriptor;
  value: Record<string, unknown>;
  guildId: string;
  onChange(next: Record<string, unknown>): void;
  errors?: Record<string, string>;
}

/**
 * Renders a module's settings page from its schema.
 *
 * This is the only place in the dashboard that knows what a settings control
 * looks like. A new module gets its form from here without adding a line of UI
 * code, which is the whole reason the schema carries display metadata.
 */
export function SettingsForm({ schema, value, guildId, onChange, errors = {} }: Props) {
  const fields = Object.entries(schema.fields as Record<string, FieldDescriptor>);

  return (
    <div className="settings-form">
      {fields.map(([key, field]) => (
        <FieldRow
          key={key}
          name={key}
          path={key}
          field={field}
          value={value[key]}
          guildId={guildId}
          errors={errors}
          onChange={(next) => onChange({ ...value, [key]: next })}
        />
      ))}
    </div>
  );
}

interface RowProps {
  name: string;
  path: string;
  field: FieldDescriptor;
  value: unknown;
  guildId: string;
  errors: Record<string, string>;
  onChange(next: unknown): void;
}

/** A field's own label, help and error, wrapped around whatever control renders it. */
function FieldRow({ name, path, field, value, guildId, errors, onChange }: RowProps) {
  const label = field.label ?? humanise(name);
  const id = htmlId(path);
  const error = errors[path];

  return (
    <div className="field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={id}>{label}</label>
      {field.help ? <p className="help">{field.help}</p> : null}
      <Control
        id={id}
        path={path}
        field={field}
        value={value}
        guildId={guildId}
        errors={errors}
        onChange={onChange}
      />
      {error ? (
        <p className="error" role="alert">
          <AlertIcon />
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface ControlProps {
  id: string;
  path: string;
  field: FieldDescriptor;
  value: unknown;
  guildId: string;
  errors: Record<string, string>;
  onChange(next: unknown): void;
}

function Control({ id, path, field, value, guildId, errors, onChange }: ControlProps) {
  switch (field.kind) {
    case "string":
      return field.multiline ? (
        <textarea
          id={id}
          rows={4}
          value={(value as string) ?? ""}
          maxLength={field.max as number | undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={(value as string) ?? ""}
          maxLength={field.max as number | undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "integer":
      return (
        <input
          id={id}
          type="number"
          value={(value as number) ?? ""}
          min={field.min as number | undefined}
          max={field.max as number | undefined}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );

    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );

    case "duration":
      return (
        <input
          id={id}
          type="text"
          placeholder="30s, 15m, 2h, 7d"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "choice":
      return (
        <select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          {(field.options as { value: string; label: string }[]).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case "emoji":
      return (
        <div className="emoji-field">
          <input
            id={id}
            type="text"
            className="emoji-input"
            placeholder="🙂 or <:name:id>"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
          <p className="hint">
            A unicode emoji, or Discord&apos;s custom form: <code>&lt;:name:id&gt;</code> or{" "}
            <code>&lt;a:name:id&gt;</code> for an animated one.
          </p>
        </div>
      );

    case "template":
      return (
        <TemplateControl
          id={id}
          max={field.max as number | undefined}
          placeholders={(field.placeholders as string[] | undefined) ?? []}
          value={(value as string) ?? ""}
          onChange={onChange}
        />
      );

    case "channel":
      return (
        <ChannelPicker
          id={id}
          guildId={guildId}
          types={field.types as string[]}
          value={value as string | undefined}
          onChange={onChange}
        />
      );

    case "role":
      return (
        <RolePicker
          id={id}
          guildId={guildId}
          value={value as string | undefined}
          onChange={onChange}
        />
      );

    case "array":
      return (
        <ArrayControl
          path={path}
          field={field.of as FieldDescriptor}
          value={(value as unknown[]) ?? []}
          guildId={guildId}
          errors={errors}
          max={field.max as number | undefined}
          onChange={onChange}
        />
      );

    case "object":
      return (
        <ObjectControl
          path={path}
          field={field}
          value={(value as Record<string, unknown>) ?? {}}
          guildId={guildId}
          errors={errors}
          onChange={onChange}
        />
      );

    default:
      return <p className="unsupported">No control for {field.kind} yet.</p>;
  }
}

interface ObjectProps {
  path: string;
  field: FieldDescriptor;
  value: Record<string, unknown>;
  guildId: string;
  errors: Record<string, string>;
  onChange(next: Record<string, unknown>): void;
}

/** A nested object renders as its own labelled child fields, at any depth. */
function ObjectControl({ path, field, value, guildId, errors, onChange }: ObjectProps) {
  const fields = Object.entries(field.fields as Record<string, FieldDescriptor>);

  return (
    <fieldset className="object-fields">
      {fields.map(([key, childField]) => (
        <FieldRow
          key={key}
          name={key}
          path={objectChildPath(path, key)}
          field={childField}
          value={value[key]}
          guildId={guildId}
          errors={errors}
          onChange={(next) => onChange({ ...value, [key]: next })}
        />
      ))}
    </fieldset>
  );
}

interface ArrayProps {
  path: string;
  field: FieldDescriptor;
  value: unknown[];
  guildId: string;
  errors: Record<string, string>;
  max?: number;
  onChange(next: unknown[]): void;
}

function ArrayControl({ path, field, value, guildId, errors, max, onChange }: ArrayProps) {
  const [draft, setDraft] = useState<unknown>(undefined);
  const atCapacity = max !== undefined && value.length >= max;

  return (
    <div className="array">
      {value.length > 0 ? (
        <ul className="array-rows">
          {value.map((item, index) => {
            const itemPath = arrayItemPath(path, index);
            return (
              <li key={index} className="array-row">
                <span className="array-row-index" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="array-row-body">
                  <Control
                    id={htmlId(itemPath)}
                    path={itemPath}
                    field={field}
                    value={item}
                    guildId={guildId}
                    errors={errors}
                    onChange={(next) => onChange(value.map((v, i) => (i === index ? next : v)))}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm array-row-remove"
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  Remove
                  <span className="visually-hidden"> row {index + 1}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {atCapacity ? (
        <p className="array-limit">Maximum of {max} reached.</p>
      ) : (
        <div className="array-add">
          <Control
            id={htmlId(`${path}[new]`)}
            path={`${path}[new]`}
            field={field}
            value={draft}
            guildId={guildId}
            errors={{}}
            onChange={setDraft}
          />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={draft === undefined || draft === ""}
            onClick={() => {
              onChange([...value, draft]);
              setDraft(undefined);
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

interface TemplateProps {
  id: string;
  max?: number;
  placeholders: string[];
  value: string;
  onChange(next: string): void;
}

/** A message body with the placeholders its module accepts, insertable at the cursor. */
function TemplateControl({ id, max = 2000, placeholders, value, onChange }: TemplateProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const remaining = max - value.length;

  function insertPlaceholder(name: string) {
    const token = `{${name}}`;
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(value + token);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    const cursor = start + token.length;
    // The textarea's value updates on the next render, so the cursor can only
    // be moved once that render has happened.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="template-field">
      <textarea
        id={id}
        ref={textareaRef}
        rows={4}
        maxLength={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={remaining < 0 ? "char-count is-low" : "char-count"}>
        {remaining} characters remaining
      </p>
      {placeholders.length > 0 ? (
        <div className="placeholders">
          <span className="placeholders-label">Insert:</span>
          {placeholders.map((name) => (
            <button key={name} type="button" onClick={() => insertPlaceholder(name)}>
              {`{${name}}`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function humanise(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** A path like `rewards[2].role` turned into a value safe as an HTML id. */
function htmlId(path: string): string {
  return `setting-${path.replace(/[[\].]/g, "-")}`;
}
