"use client";

import { useState } from "react";
import type { FieldDescriptor } from "@tier0/core";
import { ChannelPicker, RolePicker } from "./pickers";

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
          field={field}
          value={value[key]}
          guildId={guildId}
          error={errors[key]}
          onChange={(next) => onChange({ ...value, [key]: next })}
        />
      ))}
    </div>
  );
}

interface RowProps {
  name: string;
  field: FieldDescriptor;
  value: unknown;
  guildId: string;
  error?: string;
  onChange(next: unknown): void;
}

function FieldRow({ name, field, value, guildId, error, onChange }: RowProps) {
  const label = field.label ?? humanise(name);
  const id = `setting-${name}`;

  return (
    <div className="field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={id}>{label}</label>
      {field.help ? <p className="help">{field.help}</p> : null}
      <Control id={id} field={field} value={value} guildId={guildId} onChange={onChange} />
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

interface ControlProps {
  id: string;
  field: FieldDescriptor;
  value: unknown;
  guildId: string;
  onChange(next: unknown): void;
}

function Control({ id, field, value, guildId, onChange }: ControlProps) {
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
          field={field.of as FieldDescriptor}
          value={(value as unknown[]) ?? []}
          guildId={guildId}
          max={field.max as number | undefined}
          onChange={onChange}
        />
      );

    default:
      return <p className="unsupported">No control for {field.kind} yet.</p>;
  }
}

interface ArrayProps {
  field: FieldDescriptor;
  value: unknown[];
  guildId: string;
  max?: number;
  onChange(next: unknown[]): void;
}

function ArrayControl({ field, value, guildId, max, onChange }: ArrayProps) {
  const [draft, setDraft] = useState<unknown>(undefined);
  const atCapacity = max !== undefined && value.length >= max;

  return (
    <div className="array">
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <Control
              id={`item-${index}`}
              field={field}
              value={item}
              guildId={guildId}
              onChange={(next) => onChange(value.map((v, i) => (i === index ? next : v)))}
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {atCapacity ? (
        <p className="help">Maximum of {max} reached.</p>
      ) : (
        <div className="array-add">
          <Control
            id="array-draft"
            field={field}
            value={draft}
            guildId={guildId}
            onChange={setDraft}
          />
          <button
            type="button"
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

function humanise(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
