"use client";

import { useId, useState, type RefObject } from "react";
import {
  ACTION_VARIABLES,
  BUTTON_STYLES,
  CHANNEL_TYPES,
  MESSAGE_LIMITS,
  MESSAGE_VARIABLES,
  SELECT_KINDS,
  emptyButton,
  emptyEmbed,
  emptyOption,
  emptyReply,
  emptySelect,
  rowsUsed,
  type ButtonStyleName,
  type ComponentAction,
  type MessageButton,
  type MessageError,
  type MessageSelect,
  type RoleMode,
  type SelectOption,
} from "@tier0/core";
import { MultiChannelPicker, MultiRolePicker, RolePicker, Switch } from "../form";
import { ChevronDownIcon, PlusIcon, TrashIcon } from "../Icons";
import { EmbedEditor } from "./EmbedEditor";
import { EmojiPopover } from "./ExtrasEditor";
import { useToolTarget, type InsertVariable } from "./InsertBar";
import { renderEmoji } from "./MessagePreview";

/** The variables a button's or a menu's reply can use: the usual ones, then what is known about the click. */
const CLICK_VARIABLES: readonly InsertVariable[] = [
  ...ACTION_VARIABLES.map((v) => ({ name: v.name, description: v.description })),
  ...MESSAGE_VARIABLES.filter((v) => v.name !== "sender").map((v) => ({ name: v.name, description: v.description })),
];

const errorAt = (errors: MessageError[], path: string) => errors.find((e) => e.path === path)?.message;
const errorsUnder = (errors: MessageError[], path: string) => errors.filter((e) => e.path === path || e.path.startsWith(`${path}.`) || e.path.startsWith(`${path}[`));

function summarize(action: ComponentAction): string {
  if (action.type === "reply") return action.reply.dm ? "Sends a direct message" : action.reply.ephemeral ? "Replies privately" : "Replies in the channel";
  if (action.type === "role") return action.mode === "add" ? "Gives a role" : action.mode === "remove" ? "Takes a role" : "Toggles a role";
  return "Does nothing";
}

/**
 * What happens when a button or a choice is used. A link just opens its address,
 * so only the others have one. The reply is built with the same pieces as a
 * message: text and embeds, with the toolbar offering what is known about the
 * person who clicked.
 */
function ActionEditor({
  guildId,
  action,
  onChange,
  errors,
  path,
  allowRole,
  label,
}: {
  guildId: string;
  action: ComponentAction;
  onChange(next: ComponentAction): void;
  errors: MessageError[];
  path: string;
  allowRole: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const own = errorsUnder(errors, path);
  const shown = open || own.length > 0;

  const types: { id: ComponentAction["type"]; label: string }[] = [
    { id: "none", label: "Nothing" },
    { id: "reply", label: "Reply" },
    ...(allowRole ? [{ id: "role" as const, label: "Give or take a role" }] : []),
  ];

  return (
    <div className="action-editor">
      <button type="button" className="action-toggle" aria-expanded={shown} aria-controls={`${id}-body`} onClick={() => setOpen(!shown)}>
        <span>When used</span>
        <span className="action-summary" data-set={action.type !== "none" ? "true" : undefined}>
          {summarize(action)}
        </span>
        <ChevronDownIcon className="action-chevron" />
      </button>

      {shown ? (
        <div className="action-body" id={`${id}-body`}>
          <div className="choice-group action-types" role="radiogroup" aria-label={`${label}: when used`}>
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                role="radio"
                aria-checked={action.type === type.id}
                className="choice"
                onClick={() => {
                  if (action.type === type.id) return;
                  if (type.id === "none") onChange({ type: "none" });
                  else if (type.id === "reply") onChange({ type: "reply", reply: { ...emptyReply(), content: "" } });
                  else onChange({ type: "role", mode: "toggle", roleId: "", confirmation: "" });
                }}
              >
                <span className="choice-label">{type.label}</span>
              </button>
            ))}
          </div>

          {action.type === "reply" ? (
            <ReplyFields reply={action.reply} errors={errors} path={`${path}.reply`} label={label} onChange={(reply) => onChange({ type: "reply", reply })} />
          ) : null}

          {action.type === "role" ? (
            <RoleFields guildId={guildId} action={action} errors={errors} path={path} label={label} onChange={onChange} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReplyFields({
  reply,
  errors,
  path,
  label,
  onChange,
}: {
  reply: Extract<ComponentAction, { type: "reply" }>["reply"];
  errors: MessageError[];
  path: string;
  label: string;
  onChange(next: Extract<ComponentAction, { type: "reply" }>["reply"]): void;
}) {
  const target = useToolTarget(reply.content, (content) => onChange({ ...reply, content }), `${label}: reply text`, "full", CLICK_VARIABLES);
  return (
    <div className="action-fields">
      <div className="field">
        <div className="field-label-row">
          <label className="field-label">Reply text</label>
          <span className="field-hint">{reply.content.length} / {MESSAGE_LIMITS.content}</span>
        </div>
        <textarea
          ref={target.ref as RefObject<HTMLTextAreaElement>}
          onFocus={target.onFocus} onKeyDown={target.onKeyDown}
          className="textarea"
          rows={3}
          placeholder="What to say. {user} is whoever used it."
          value={reply.content}
          onChange={(event) => onChange({ ...reply, content: event.target.value })}
        />
        {errorAt(errors, `${path}.content`) ? <p className="field-error">{errorAt(errors, `${path}.content`)}</p> : null}
      </div>

      {reply.embeds.map((embed, i) => (
        <EmbedEditor
          key={i}
          embed={embed}
          index={i}
          total={reply.embeds.length}
          path={`${path}.embeds[${i}]`}
          variables={CLICK_VARIABLES}
          errors={errors}
          defaultOpen={reply.embeds.length === 1}
          onChange={(next) => onChange({ ...reply, embeds: reply.embeds.map((e, j) => (j === i ? next : e)) })}
          onRemove={() => onChange({ ...reply, embeds: reply.embeds.filter((_, j) => j !== i) })}
          onMove={(direction) => {
            const to = i + direction;
            if (to < 0 || to >= reply.embeds.length) return;
            const embeds = [...reply.embeds];
            const a = embeds[i];
            const b = embeds[to];
            if (!a || !b) return;
            embeds[i] = b;
            embeds[to] = a;
            onChange({ ...reply, embeds });
          }}
          onDuplicate={() => {
            if (reply.embeds.length >= MESSAGE_LIMITS.replyEmbeds) return;
            const embeds = [...reply.embeds];
            embeds.splice(i + 1, 0, structuredClone(embed));
            onChange({ ...reply, embeds });
          }}
        />
      ))}
      {reply.embeds.length < MESSAGE_LIMITS.replyEmbeds ? (
        <button type="button" className="btn btn-ghost btn-sm embed-add" onClick={() => onChange({ ...reply, embeds: [...reply.embeds, emptyEmbed()] })}>
          <PlusIcon /> Add an embed
        </button>
      ) : null}
      {errorAt(errors, path) ? <p className="field-error">{errorAt(errors, path)}</p> : null}

      <label className="embed-inline">
        <Switch checked={reply.dm} onChange={(next) => onChange({ ...reply, dm: next })} aria-label="Send it as a direct message" />
        <span>Send it as a direct message</span>
      </label>
      {reply.dm ? (
        <p className="field-hint">The person is told it was sent. If they have direct messages from server members turned off, they are told that instead.</p>
      ) : (
        <label className="embed-inline">
          <Switch checked={reply.ephemeral} onChange={(next) => onChange({ ...reply, ephemeral: next })} aria-label="Only the person who used it sees the reply" />
          <span>Only the person who used it sees the reply</span>
        </label>
      )}
    </div>
  );
}

const ROLE_MODES: { id: RoleMode; label: string; hint: string }[] = [
  { id: "toggle", label: "Toggle", hint: "Gives it, or takes it back if they have it" },
  { id: "add", label: "Give", hint: "Always gives it" },
  { id: "remove", label: "Take", hint: "Always takes it" },
];

function RoleFields({
  guildId,
  action,
  errors,
  path,
  label,
  onChange,
}: {
  guildId: string;
  action: Extract<ComponentAction, { type: "role" }>;
  errors: MessageError[];
  path: string;
  label: string;
  onChange(next: ComponentAction): void;
}) {
  const id = useId();
  const confirm = useToolTarget(action.confirmation, (confirmation) => onChange({ ...action, confirmation }), `${label}: confirmation`, "inline", CLICK_VARIABLES);
  return (
    <div className="action-fields">
      <div className="choice-group action-types" role="radiogroup" aria-label="What to do with the role">
        {ROLE_MODES.map((mode) => (
          <button key={mode.id} type="button" role="radio" aria-checked={action.mode === mode.id} className="choice" onClick={() => onChange({ ...action, mode: mode.id })}>
            <span className="choice-label">{mode.label}</span>
            <span className="choice-hint">{mode.hint}</span>
          </button>
        ))}
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-role`}>
          Role
        </label>
        <RolePicker id={`${id}-role`} guildId={guildId} assigns value={action.roleId || undefined} onChange={(roleId) => onChange({ ...action, roleId: roleId ?? "" })} />
        {errorAt(errors, `${path}.roleId`) ? <p className="field-error">{errorAt(errors, `${path}.roleId`)}</p> : null}
        <p className="field-hint">The bot can only give roles below its own highest role.</p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-confirm`}>
          What it says back, privately
        </label>
        <input
          id={`${id}-confirm`}
          ref={confirm.ref as RefObject<HTMLInputElement>}
          onFocus={confirm.onFocus} onKeyDown={confirm.onKeyDown}
          className="input"
          placeholder="Leave empty for the usual message"
          maxLength={MESSAGE_LIMITS.confirmation}
          value={action.confirmation}
          onChange={(event) => onChange({ ...action, confirmation: event.target.value })}
        />
        {errorAt(errors, `${path}.confirmation`) ? <p className="field-error">{errorAt(errors, `${path}.confirmation`)}</p> : null}
      </div>
    </div>
  );
}

/** A text box in a component that takes the toolbar's tools and nothing fancier. */
function TextBox({ value, onChange, label, placeholder, max }: { value: string; onChange(next: string): void; label: string; placeholder: string; max?: number }) {
  const target = useToolTarget(value, onChange, label, "inline");
  return (
    <input
      ref={target.ref as RefObject<HTMLInputElement>}
      onFocus={target.onFocus} onKeyDown={target.onKeyDown}
      className="input"
      aria-label={label}
      placeholder={placeholder}
      maxLength={max}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function UrlBox({ value, onChange, label }: { value: string; onChange(next: string): void; label: string }) {
  const target = useToolTarget(value, onChange, label, "none");
  return (
    <input
      ref={target.ref as RefObject<HTMLInputElement>}
      onFocus={target.onFocus} onKeyDown={target.onKeyDown}
      className="input"
      aria-label={label}
      placeholder="https://"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function RowsNote({ buttons, selects }: { buttons: number; selects: number }) {
  const used = rowsUsed(Array.from({ length: buttons }), Array.from({ length: selects }));
  return (
    <span className="field-hint" data-over={used > MESSAGE_LIMITS.rows ? "true" : undefined}>
      {used} of {MESSAGE_LIMITS.rows} rows used
    </span>
  );
}

const STYLE_CLASS: Record<ButtonStyleName, string> = {
  primary: "is-primary",
  secondary: "is-secondary",
  success: "is-success",
  danger: "is-danger",
  link: "is-link",
};

export function ButtonsEditor({
  guildId,
  buttons,
  selectCount,
  errors,
  onChange,
}: {
  guildId: string;
  buttons: MessageButton[];
  selectCount: number;
  errors: MessageError[];
  onChange(next: MessageButton[]): void;
}) {
  const L = MESSAGE_LIMITS;
  const set = (i: number, patch: Partial<MessageButton>) => onChange(buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <section className="card msg-card" aria-label="Buttons">
      <div className="field-label-row">
        <span className="field-label">Buttons</span>
        <span className="field-hint">
          {buttons.length} of {L.buttons} · <RowsNote buttons={buttons.length} selects={selectCount} />
        </span>
      </div>
      <p className="field-hint">
        Blue, grey, green and red buttons do something when pressed. A link button opens a web address. Five fit on a row.
      </p>
      {errorAt(errors, "buttons") ? <p className="field-error">{errorAt(errors, "buttons")}</p> : null}

      {buttons.map((button, i) => {
        const at = `buttons[${i}]`;
        return (
          <div className="component-card" key={i}>
            <div className="component-head">
              <EmojiPopover guildId={guildId} label={`Emoji for button ${i + 1}`} onPick={(token) => set(i, { emoji: token })}>
                {button.emoji ? renderEmoji(button.emoji) : <PlusIcon />}
              </EmojiPopover>
              <div className="component-label">
                <TextBox label={`Button ${i + 1} label`} placeholder="Label" max={L.buttonLabel} value={button.label} onChange={(label) => set(i, { label })} />
              </div>
              <div className="style-seg" role="radiogroup" aria-label={`Button ${i + 1} color`}>
                {BUTTON_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    role="radio"
                    aria-checked={button.style === style.id}
                    aria-label={style.id === "link" ? "Link" : `${style.label} button`}
                    title={style.label}
                    className={`style-chip ${STYLE_CLASS[style.id]}`}
                    onClick={() =>
                      set(i, {
                        style: style.id,
                        // A link opens an address and has no action. Anything else loses the address.
                        ...(style.id === "link" ? { action: { type: "none" as const } } : { url: "" }),
                      })
                    }
                  >
                    {style.id === "link" ? "Link" : ""}
                  </button>
                ))}
              </div>
              <label className="embed-inline" title="A greyed out button can't be pressed">
                <Switch checked={button.disabled} onChange={(next) => set(i, { disabled: next })} aria-label={`Button ${i + 1} greyed out`} />
                <span>Greyed out</span>
              </label>
              <button type="button" className="icon-btn" aria-label={`Remove button ${i + 1}`} onClick={() => onChange(buttons.filter((_, j) => j !== i))}>
                <TrashIcon />
              </button>
            </div>

            {errorAt(errors, at) ? <p className="field-error">{errorAt(errors, at)}</p> : null}
            {errorAt(errors, `${at}.label`) ? <p className="field-error">{errorAt(errors, `${at}.label`)}</p> : null}
            {errorAt(errors, `${at}.emoji`) ? <p className="field-error">{errorAt(errors, `${at}.emoji`)}</p> : null}

            {button.style === "link" ? (
              <div className="component-url">
                <UrlBox label={`Button ${i + 1} link`} value={button.url} onChange={(url) => set(i, { url })} />
                {errorAt(errors, `${at}.url`) ? <p className="field-error">{errorAt(errors, `${at}.url`)}</p> : null}
              </div>
            ) : (
              <ActionEditor guildId={guildId} label={`Button ${i + 1}`} action={button.action} errors={errors} path={`${at}.action`} allowRole onChange={(action) => set(i, { action })} />
            )}
          </div>
        );
      })}

      {buttons.length < L.buttons ? (
        <button type="button" className="btn btn-ghost btn-sm embed-add" onClick={() => onChange([...buttons, emptyButton()])}>
          <PlusIcon /> Add a button
        </button>
      ) : null}
    </section>
  );
}

export function SelectsEditor({
  guildId,
  selects,
  buttonCount,
  errors,
  textOnly = false,
  onChange,
}: {
  guildId: string;
  selects: MessageSelect[];
  buttonCount: number;
  errors: MessageError[];
  /** For a direct message, where only a menu of typed options is filled in. */
  textOnly?: boolean;
  onChange(next: MessageSelect[]): void;
}) {
  const L = MESSAGE_LIMITS;
  const [picking, setPicking] = useState(false);
  const set = (i: number, patch: Partial<MessageSelect>) => onChange(selects.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <section className="card msg-card" aria-label="Menus">
      <div className="field-label-row">
        <span className="field-label">Menus</span>
        <span className="field-hint">
          {selects.length} of {L.selects} · <RowsNote buttons={buttonCount} selects={selects.length} />
        </span>
      </div>
      <p className="field-hint">
        A dropdown people pick from. Each takes a row of its own, under the buttons.
        {textOnly ? " Menus of roles, channels or people are not available in a direct message." : ""}
      </p>
      {errorAt(errors, "selects") ? <p className="field-error">{errorAt(errors, "selects")}</p> : null}

      {selects.map((select, i) => (
        <SelectCard key={i} guildId={guildId} select={select} index={i} errors={errors} onChange={(patch) => set(i, patch)} onRemove={() => onChange(selects.filter((_, j) => j !== i))} />
      ))}

      {selects.length < L.selects ? (
        picking ? (
          <div className="select-kinds" role="group" aria-label="What the menu lets people pick">
            {SELECT_KINDS.filter((kind) => !textOnly || kind.id === "string").map((kind) => (
              <button
                key={kind.id}
                type="button"
                className="choice"
                onClick={() => {
                  onChange([...selects, emptySelect(kind.id)]);
                  setPicking(false);
                }}
              >
                <span className="choice-label">{kind.label}</span>
                <span className="choice-hint">{kind.hint}</span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm embed-add" onClick={() => setPicking(true)}>
            <PlusIcon /> Add a menu
          </button>
        )
      ) : null}
    </section>
  );
}

function SelectCard({
  guildId,
  select,
  index,
  errors,
  onChange,
  onRemove,
}: {
  guildId: string;
  select: MessageSelect;
  index: number;
  errors: MessageError[];
  onChange(patch: Partial<MessageSelect>): void;
  onRemove(): void;
}) {
  const L = MESSAGE_LIMITS;
  const limitId = useId();
  const at = `selects[${index}]`;
  const kind = SELECT_KINDS.find((k) => k.id === select.kind);
  const maxAllowed =
    select.kind === "string"
      ? Math.min(L.selectValues, Math.max(1, select.options.length))
      : select.limitTo.length > 0
        ? Math.min(L.selectValues, select.limitTo.length)
        : L.selectValues;
  const limited = select.limitTo.length > 0;
  const setOption = (j: number, patch: Partial<SelectOption>) => onChange({ options: select.options.map((o, k) => (k === j ? { ...o, ...patch } : o)) });

  return (
    <div className="component-card">
      <div className="component-head">
        <strong className="component-kind">{kind?.label ?? "Menu"}</strong>
        <span className="component-spacer" />
        <label className="embed-inline" title="A greyed out menu can't be used">
          <Switch checked={select.disabled} onChange={(next) => onChange({ disabled: next })} aria-label={`Menu ${index + 1} greyed out`} />
          <span>Greyed out</span>
        </label>
        <button type="button" className="icon-btn" aria-label={`Remove menu ${index + 1}`} onClick={onRemove}>
          <TrashIcon />
        </button>
      </div>

      <div className="field">
        <label className="field-label">Placeholder</label>
        <TextBox label={`Menu ${index + 1} placeholder`} placeholder="Shown until something is picked" max={L.selectPlaceholder} value={select.placeholder} onChange={(placeholder) => onChange({ placeholder })} />
        {errorAt(errors, `${at}.placeholder`) ? <p className="field-error">{errorAt(errors, `${at}.placeholder`)}</p> : null}
      </div>

      <div className="embed-grid">
        <div className="field">
          <label className="field-label">Least to pick</label>
          <input type="number" className="input" min={0} max={select.maxValues} value={select.minValues} onChange={(event) => onChange({ minValues: Number(event.target.value) })} />
          {errorAt(errors, `${at}.minValues`) ? <p className="field-error">{errorAt(errors, `${at}.minValues`)}</p> : null}
        </div>
        <div className="field">
          <label className="field-label">Most to pick</label>
          <input type="number" className="input" min={1} max={maxAllowed} value={select.maxValues} onChange={(event) => onChange({ maxValues: Number(event.target.value) })} />
          {errorAt(errors, `${at}.maxValues`) ? <p className="field-error">{errorAt(errors, `${at}.maxValues`)}</p> : null}
        </div>
      </div>

      {select.kind === "channel" && !limited ? (
        <div className="field">
          <span className="field-label">Which channels can be picked</span>
          <div className="channel-types">
            {CHANNEL_TYPES.map((type) => {
              const on = select.channelTypes.includes(type.id);
              return (
                <button
                  key={type.id}
                  type="button"
                  className="chip-button"
                  aria-pressed={on}
                  data-on={on ? "true" : undefined}
                  onClick={() => onChange({ channelTypes: on ? select.channelTypes.filter((t) => t !== type.id) : [...select.channelTypes, type.id] })}
                >
                  {type.label}
                </button>
              );
            })}
          </div>
          <p className="field-hint">With none chosen, any channel can be picked. Or choose particular channels below.</p>
        </div>
      ) : null}

      {select.kind === "channel" || select.kind === "role" ? (
        <div className="field">
          <span className="field-label" id={`${limitId}-label`}>
            {select.kind === "channel" ? "Only these channels" : "Only these roles"}
          </span>
          {select.kind === "channel" ? (
            <MultiChannelPicker
              id={`${limitId}-picker`}
              guildId={guildId}
              types={["text", "voice", "category", "announcement", "forum"]}
              values={select.limitTo}
              max={L.selectOptions}
              emptyLabel="Any channel"
              addLabel="Add a channel"
              aria-labelledby={`${limitId}-label`}
              onChange={(limitTo) => onChange({ limitTo })}
            />
          ) : (
            <MultiRolePicker
              id={`${limitId}-picker`}
              guildId={guildId}
              values={select.limitTo}
              max={L.selectOptions}
              emptyLabel="Any role"
              addLabel="Add a role"
              aria-labelledby={`${limitId}-label`}
              onChange={(limitTo) => onChange({ limitTo })}
            />
          )}
          <p className="field-hint">
            {limited
              ? `People see a list of just these. Up to ${L.selectOptions} can be offered.`
              : `Leave it empty to offer ${select.kind === "channel" ? "every channel of the kinds above" : "every role"}.`}
          </p>
          {errorAt(errors, `${at}.limitTo`) ? <p className="field-error">{errorAt(errors, `${at}.limitTo`)}</p> : null}
        </div>
      ) : null}

      {select.kind === "string" ? (
        <div className="field">
          <div className="field-label-row">
            <span className="field-label">Choices</span>
            <span className="field-hint">
              {select.options.length} of {L.selectOptions}
            </span>
          </div>
          {errorAt(errors, `${at}.options`) ? <p className="field-error">{errorAt(errors, `${at}.options`)}</p> : null}
          {select.options.map((option, j) => {
            const oat = `${at}.options[${j}]`;
            return (
              <div className="option-card" key={j}>
                <div className="component-head">
                  <EmojiPopover guildId={guildId} label={`Emoji for choice ${j + 1}`} onPick={(token) => setOption(j, { emoji: token })}>
                    {option.emoji ? renderEmoji(option.emoji) : <PlusIcon />}
                  </EmojiPopover>
                  <div className="component-label">
                    <TextBox label={`Choice ${j + 1} label`} placeholder="Label" max={L.selectLabel} value={option.label} onChange={(label) => setOption(j, { label })} />
                  </div>
                  <label className="embed-inline" title="Already picked when the message appears">
                    <Switch checked={option.default} onChange={(next) => setOption(j, { default: next })} aria-label={`Choice ${j + 1} starts picked`} />
                    <span>Picked</span>
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove choice ${j + 1}`}
                    onClick={() => onChange({ options: select.options.filter((_, k) => k !== j) })}
                  >
                    <TrashIcon />
                  </button>
                </div>
                {errorAt(errors, `${oat}.label`) ? <p className="field-error">{errorAt(errors, `${oat}.label`)}</p> : null}
                {errorAt(errors, `${oat}.emoji`) ? <p className="field-error">{errorAt(errors, `${oat}.emoji`)}</p> : null}
                <TextBox label={`Choice ${j + 1} description`} placeholder="A line under the label, if you want one" max={L.selectDescription} value={option.description} onChange={(description) => setOption(j, { description })} />
                <ActionEditor guildId={guildId} label={`Choice ${j + 1}`} action={option.action} errors={errors} path={`${oat}.action`} allowRole onChange={(action) => setOption(j, { action })} />
              </div>
            );
          })}
          {select.options.length < L.selectOptions ? (
            <button type="button" className="btn btn-ghost btn-sm embed-add" onClick={() => onChange({ options: [...select.options, emptyOption(select.options.length)] })}>
              <PlusIcon /> Add a choice
            </button>
          ) : null}
        </div>
      ) : (
        <ActionEditor guildId={guildId} label={`Menu ${index + 1}`} action={select.action} errors={errors} path={`${at}.action`} allowRole={false} onChange={(action) => onChange({ action })} />
      )}
    </div>
  );
}
