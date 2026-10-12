"use client";

import { useId, useState, type RefObject } from "react";
import { MESSAGE_LIMITS, embedLength, isHexColor, type EmbedField, type MessageEmbed, type MessageError } from "@tier0/core";
import { Switch } from "../form";
import { useToolTarget, type InsertVariable, type ToolReach } from "./InsertBar";
import { ChevronDownIcon, PlusIcon, TrashIcon } from "../Icons";

interface Props {
  embed: MessageEmbed;
  /** Where this embed sits in what is being checked, for finding its errors. Defaults to a message's own embeds. */
  path?: string;
  /** What the Variables tool offers for the boxes in this embed. */
  variables?: readonly InsertVariable[];
  index: number;
  total: number;
  errors: MessageError[];
  /** Newly added embeds open, the rest start closed so a long message stays readable. */
  defaultOpen: boolean;
  onChange(next: MessageEmbed): void;
  onRemove(): void;
  onMove(direction: -1 | 1): void;
  onDuplicate(): void;
}

const SWATCHES = ["#e3b34a", "#5865f2", "#3ddc84", "#f87171", "#a78bfa", "#38bdf8", "#f472b6", "#9ca3af"];

/**
 * One embed of a message. Every part Discord allows is here, grouped the way
 * the embed reads from top to bottom, and each limit is shown beside the text
 * it applies to so nobody finds out at send time.
 */
export function EmbedEditor({ path, variables, embed, index, total, errors, defaultOpen, onChange, onRemove, onMove, onDuplicate }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const base = useId();
  const L = MESSAGE_LIMITS;
  const at = path ?? `embeds[${index}]`;
  const errorAt = (path: string) => errors.find((e) => e.path === `${at}.${path}`)?.message;
  const set = <K extends keyof MessageEmbed>(key: K, value: MessageEmbed[K]) => onChange({ ...embed, [key]: value });

  function setField(i: number, patch: Partial<EmbedField>) {
    set("fields", embed.fields.map((field, j) => (j === i ? { ...field, ...patch } : field)));
  }

  const used = embedLength(embed);
  const heading = embed.title.trim() || embed.description.trim().slice(0, 40) || "Untitled embed";

  return (
    <section className="embed-card" data-open={open ? "true" : undefined} aria-label={`Embed ${index + 1}`}>
      <div className="embed-head">
        <button type="button" className="embed-toggle" aria-expanded={open} aria-controls={`${base}-body`} onClick={() => setOpen(!open)}>
          <span className="embed-swatch" style={{ background: isHexColor(embed.color) ? embed.color : "var(--border-strong)" }} aria-hidden="true" />
          <span className="embed-heading">
            <span className="embed-kicker">Embed {index + 1}</span>
            <span className="embed-name">{heading}</span>
          </span>
          <ChevronDownIcon className="embed-chevron" />
        </button>
        <div className="embed-tools">
          <button type="button" className="icon-btn" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="icon-btn" aria-label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="icon-btn" aria-label="Duplicate embed" onClick={onDuplicate}>
            <PlusIcon />
          </button>
          <button type="button" className="icon-btn" aria-label="Remove embed" onClick={onRemove}>
            <TrashIcon />
          </button>
        </div>
      </div>

      {open ? (
        <div className="embed-body" id={`${base}-body`}>
          {errorAt("") ? <p className="field-error">{errorAt("")}</p> : null}

          <div className="field">
            <span className="field-label">Color</span>
            <div className="embed-colors">
              <input
                type="color"
                className="embed-color-input"
                aria-label="Pick a color"
                value={isHexColor(embed.color) ? embed.color : "#1e1f22"}
                onChange={(event) => set("color", event.target.value)}
              />
              <input
                className="input embed-hex"
                aria-label="Color as hex"
                placeholder="#e3b34a"
                maxLength={7}
                value={embed.color}
                onChange={(event) => set("color", event.target.value)}
              />
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className="embed-swatch-btn"
                  style={{ background: swatch }}
                  aria-label={`Use ${swatch}`}
                  data-active={embed.color.toLowerCase() === swatch ? "true" : undefined}
                  onClick={() => set("color", swatch)}
                />
              ))}
              {embed.color !== "" ? (
                <button type="button" className="link-button" onClick={() => set("color", "")}>
                  Clear
                </button>
              ) : null}
            </div>
            {errorAt("color") ? <p className="field-error">{errorAt("color")}</p> : null}
          </div>

          <div className="embed-grid">
            <Text variables={variables} label="Author name" reach="inline" value={embed.authorName} max={L.authorName} error={errorAt("authorName")} onChange={(v) => set("authorName", v)} />
            <Text variables={variables} label="Author icon" reach="variables" placeholder="https://" value={embed.authorIconUrl} error={errorAt("authorIconUrl")} onChange={(v) => set("authorIconUrl", v)} />
          </div>
          <Text variables={variables} label="Author link" reach="none" placeholder="https://" value={embed.authorUrl} error={errorAt("authorUrl")} onChange={(v) => set("authorUrl", v)} />

          <Text variables={variables} label="Title" reach="inline" value={embed.title} max={L.title} error={errorAt("title")} onChange={(v) => set("title", v)} />
          <Text variables={variables} label="Title link" reach="none" placeholder="https://" value={embed.url} error={errorAt("url")} onChange={(v) => set("url", v)} />
          <Text variables={variables} label="Description" reach="full" multiline value={embed.description} max={L.description} error={errorAt("description")} onChange={(v) => set("description", v)} />

          <div className="field">
            <div className="field-label-row">
              <span className="field-label">Fields</span>
              <span className="field-hint">
                {embed.fields.length} of {L.fields}
              </span>
            </div>
            {embed.fields.map((field, i) => (
              <div className="embed-field" key={i}>
                <div className="embed-field-inputs">
                  <FieldName variables={variables} label={`Field ${i + 1} name`} value={field.name} onChange={(name) => setField(i, { name })} />
                  <FieldValue
                    variables={variables}
                    label={`Field ${i + 1} value`}
                    value={field.value}
                    onChange={(value) => setField(i, { value })}
                  />
                  {errorAt(`fields[${i}].name`) ? <p className="field-error">{errorAt(`fields[${i}].name`)}</p> : null}
                  {errorAt(`fields[${i}].value`) ? <p className="field-error">{errorAt(`fields[${i}].value`)}</p> : null}
                </div>
                <div className="embed-field-side">
                  <label className="embed-inline">
                    <Switch checked={field.inline} onChange={(next) => setField(i, { inline: next })} aria-label={`Field ${i + 1} beside the next`} />
                    <span>Inline</span>
                  </label>
                  <button type="button" className="icon-btn" aria-label={`Remove field ${i + 1}`} onClick={() => set("fields", embed.fields.filter((_, j) => j !== i))}>
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
            {embed.fields.length < L.fields ? (
              <button type="button" className="btn btn-ghost btn-sm embed-add" onClick={() => set("fields", [...embed.fields, { name: "", value: "", inline: false }])}>
                <PlusIcon /> Add a field
              </button>
            ) : null}
          </div>

          <div className="embed-grid">
            <Text variables={variables} label="Image" reach="variables" placeholder="https://" value={embed.imageUrl} error={errorAt("imageUrl")} onChange={(v) => set("imageUrl", v)} />
            <Text variables={variables} label="Thumbnail" reach="variables" placeholder="https://" value={embed.thumbnailUrl} error={errorAt("thumbnailUrl")} onChange={(v) => set("thumbnailUrl", v)} />
          </div>

          <div className="embed-grid">
            <Text variables={variables} label="Footer" reach="inline" value={embed.footerText} max={L.footerText} error={errorAt("footerText")} onChange={(v) => set("footerText", v)} />
            <Text variables={variables} label="Footer icon" reach="variables" placeholder="https://" value={embed.footerIconUrl} error={errorAt("footerIconUrl")} onChange={(v) => set("footerIconUrl", v)} />
          </div>

          <div className="field">
            <span className="field-label">Time in the footer</span>
            <div className="choice-group embed-stamp" role="radiogroup" aria-label="Time in the footer">
              {[
                { id: "", label: "None" },
                { id: "now", label: "When it is sent" },
                { id: "custom", label: "A chosen time" },
              ].map((option) => {
                const current = embed.timestamp === "" ? "" : embed.timestamp === "now" ? "now" : "custom";
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={current === option.id}
                    className="choice"
                    onClick={() => set("timestamp", option.id === "custom" ? new Date(Date.now() + 3600_000).toISOString() : option.id)}
                  >
                    <span className="choice-label">{option.label}</span>
                  </button>
                );
              })}
            </div>
            {embed.timestamp !== "" && embed.timestamp !== "now" ? (
              <input
                type="datetime-local"
                className="input embed-datetime"
                aria-label="Chosen time"
                value={isoToLocal(embed.timestamp)}
                onChange={(event) => {
                  const date = new Date(event.target.value);
                  if (!Number.isNaN(date.getTime())) set("timestamp", date.toISOString());
                }}
              />
            ) : null}
            {errorAt("timestamp") ? <p className="field-error">{errorAt("timestamp")}</p> : null}
          </div>

          <p className="field-hint">{used.toLocaleString()} characters in this embed. All embeds together can hold {L.embedTotal.toLocaleString()}.</p>
        </div>
      ) : null}
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
  multiline = false,
  max,
  placeholder,
  error,
  reach,
  variables,
}: {
  label: string;
  value: string;
  onChange(next: string): void;
  /** What the toolbar may add to this box, which follows what Discord draws there. */
  reach: ToolReach;
  variables?: readonly InsertVariable[];
  multiline?: boolean;
  max?: number;
  placeholder?: string;
  error?: string;
}) {
  const id = useId();
  const target = useToolTarget(value, onChange, label, reach, variables);
  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {max !== undefined ? (
          <span className="field-hint" data-over={value.length > max ? "true" : undefined}>
            {value.length} / {max}
          </span>
        ) : null}
      </div>
      {multiline ? (
        <textarea id={id} ref={target.ref as RefObject<HTMLTextAreaElement>} onFocus={target.onFocus} className="textarea" rows={4} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input id={id} ref={target.ref as RefObject<HTMLInputElement>} onFocus={target.onFocus} className="input" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

function FieldName({ variables, label, value, onChange }: { variables?: readonly InsertVariable[]; label: string; value: string; onChange(next: string): void }) {
  const target = useToolTarget(value, onChange, label, "inline", variables);
  return (
    <input
      ref={target.ref as RefObject<HTMLInputElement>}
      onFocus={target.onFocus}
      className="input"
      aria-label={label}
      placeholder="Name"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function FieldValue({ variables, label, value, onChange }: { variables?: readonly InsertVariable[]; label: string; value: string; onChange(next: string): void }) {
  const target = useToolTarget(value, onChange, label, "full", variables);
  return (
    <textarea
      ref={target.ref as RefObject<HTMLTextAreaElement>}
      onFocus={target.onFocus}
      className="textarea"
      aria-label={label}
      placeholder="Value"
      rows={2}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** An ISO time as the text a datetime-local box wants, in the viewer's own timezone. */
function isoToLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
