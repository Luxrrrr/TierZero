/**
 * Settings schema.
 *
 * A module describes its settings with these builders. Each field carries a
 * validator and enough metadata for the dashboard to render a control for it,
 * so no module ever ships dashboard code.
 *
 * This is not zod. The dashboard needs to serialize a schema to JSON and
 * walk it, and reaching into another library's internals to do that breaks on
 * every minor release.
 */

import { normalizeOrigin, parseMessage, restrictMessage, type MessageBody, type MessageDelivery } from "./message.js";
import { plainReply } from "./response.js";

export type FieldKind =
  | "string"
  | "integer"
  | "boolean"
  | "duration"
  | "channel"
  | "role"
  | "choice"
  | "emoji"
  | "template"
  | "message"
  | "array"
  | "object";

export type ChannelType = "text" | "voice" | "category" | "forum";

/**
 * A condition on a sibling field, meaning "this setting only matters when the
 * other one says so". With neither `equals` nor `includes` the condition is met
 * whenever the sibling holds anything at all.
 */
export interface FieldCondition {
  field: string;
  equals?: unknown;
  /** The sibling is a list, and the condition is met while it contains this value. */
  includes?: unknown;
  /**
   * Dashboard-only. While the condition is not met the setting is left out of
   * the form instead of being drawn greyed out. Use it where the control would
   * only be a puzzle until its sibling is set, such as a menu's placeholder
   * while buttons are chosen. The value stays stored either way.
   */
  hide?: boolean;
}

/** One numbered part of a group drawn with `steps`. */
export interface FormStep {
  id: string;
  title: string;
  /** One plain line under the title saying what the step is for. */
  help?: string;
}

/**
 * Dashboard-only, on a list of rows that are the questions of a form: draws a
 * preview of the form as Discord shows it, under the list. Paths are read in
 * each row, except `title`, which is a text setting beside the list.
 */
export interface ListPreview {
  kind: "modal";
  /** A text setting beside the list holding the form's title. Without one the title is "Form". */
  title?: string;
  /** The row's text setting holding the question. */
  label: string;
  placeholder?: string;
  /** A choice that says `paragraph` for a long answer box. */
  style?: string;
  /** A switch that is on while the question must be answered. */
  required?: string;
}

/**
 * Dashboard-only, on a list of rows drawn with `layout: "sheet"`. Says what a
 * row's summary card shows, as paths from the row. Anything omitted is left
 * off the card.
 */
export interface RowCard {
  /** An emoji setting, drawn before the row's name. */
  emoji?: string;
  /** A choice whose options carry a `swatch`, drawn as a colour dot. */
  swatch?: string;
  /** A list of roles, drawn as chips. */
  chips?: string;
  /** Settings read out as short facts: a choice as its label, a list of rows as a count. */
  facts?: string[];
}

export interface FieldMeta {
  label?: string;
  help?: string;
  optional?: boolean;
  /**
   * Marks a setting the module cannot work without. The dashboard uses it to
   * tell a server owner that a feature is switched on but idle. Validation
   * ignores it: an essential setting is still usually `optional`, because a
   * module has to load unconfigured before anyone can configure it.
   *
   * A string names a set instead: the module needs at least one setting of the
   * set filled in, anywhere in its schema, as a welcome feature needs a
   * greeting channel or a farewell channel or a direct message, but not all
   * three. A switch counts as filled while it is on.
   */
  essential?: boolean | string;
  /**
   * Marks a setting the quick setup asks about. Essential fields are included
   * whether or not they carry this, since nothing works until they are set;
   * use it for the handful of others worth deciding before a feature is any
   * use, and leave the rest to the full settings page.
   */
  guided?: boolean;
  /** Dashboard-only. The field is still parsed and stored either way. */
  when?: FieldCondition;
  /**
   * Dashboard-only. A top-level object group that draws as an accordion section,
   * closed until opened, so a page of many similar groups can be scanned.
   * It has no effect on any other field.
   */
  collapsible?: boolean;
  /**
   * On a role field: the bot gives this role to members, so a role above the bot's
   * own cannot work. The role picker greys those out only where this is set. A role
   * chosen to exempt, limit or notify is selectable whatever its position.
   */
  assigns?: boolean;
  /**
   * Dashboard-only. Names the part of a module's settings page a top-level
   * setting belongs to, for a module with enough settings to split the page.
   * Settings that share a value are drawn together, in schema order.
   */
  section?: string;
  /**
   * Dashboard-only. On a setting inside a group that declares `steps`: the id
   * of the step it is drawn in. A setting naming none goes in the first step.
   */
  step?: string;
  /**
   * Dashboard-only. A short plain note, such as "No handlers yet", shown on a
   * row's summary card and as a marker on its tab while the setting is empty.
   * It asks for nothing: nothing is refused and the feature's status is left
   * alone, unlike `essential`.
   */
  nudge?: string;
  /**
   * Dashboard-only, on a choice. `segmented` draws the options as a row of
   * toggle buttons instead of a drop-down, for two or three short options.
   * `swatches` draws them as colour dots and needs a `swatch` on each option.
   */
  control?: "segmented" | "swatches";
  /**
   * Dashboard-only. The id of the heading this setting is listed under in a
   * group with a `layout`, one of that group's `topics`. On a nested group it is
   * what the group's own settings are listed under, unless they name another.
   * A message elsewhere in the module that names a topic of a `layout: "messages"`
   * group is listed there as well as in its own place.
   */
  topic?: string;
}

/** A heading a group with a `layout` lists some of its settings under. */
export interface FieldTopic {
  id: string;
  label: string;
  /** One line under the heading. */
  help?: string;
  /**
   * The id of another topic this one is drawn inside of, closed until opened,
   * for a long run of messages few owners need, such as refusals.
   */
  within?: string;
}

/** Who sees a message, as a message list says it. */
export type MessageAudience = "public" | "private" | "dm";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

export interface FieldError {
  path: string;
  message: string;
}

export interface Field<T> {
  kind: FieldKind;
  meta: FieldMeta;
  defaultValue: T | undefined;
  parse(input: unknown, path?: string): ParseResult<T>;
  /** Plain JSON the dashboard renders a control from. */
  describe(): FieldDescriptor;
}

export interface FieldDescriptor {
  kind: FieldKind;
  label?: string;
  help?: string;
  optional?: boolean;
  default?: unknown;
  section?: string;
  /** A string the dashboard fills in itself and never shows. See `s.string({ generated })`. */
  generated?: boolean;
  [extra: string]: unknown;
}

/** Infers the settings object type from an object field. */
export type Infer<F> = F extends Field<infer T> ? T : never;

function fail(path: string, message: string): ParseResult<never> {
  return { ok: false, errors: [{ path, message }] };
}

function missing(field: Field<unknown>, path: string): ParseResult<never> {
  // A declared default is checked first: a field carrying one is never really
  // absent, so marking it optional as well should not discard it.
  if (field.defaultValue !== undefined) {
    return { ok: true, value: field.defaultValue as never };
  }
  if (field.meta.optional) return { ok: true, value: undefined as never };
  return fail(path, "is required");
}

// -- primitives ------------------------------------------------------------

interface StringOptions extends FieldMeta {
  min?: number;
  max?: number;
  multiline?: boolean;
  default?: string;
  /**
   * The value is a web address, kept as its origin: `https://bot.example.com/panel/`
   * is stored as `https://bot.example.com`. Anything that is not an http(s) address is refused.
   */
  origin?: boolean;
  /**
   * The value is a whole http(s) address, such as a feed's, kept as written
   * apart from surrounding spaces. Anything else is refused. The dashboard
   * gives it a whole row, since addresses are long.
   */
  url?: boolean;
  /**
   * A stable id for a row in a list, which other records point at. The
   * dashboard draws nothing for it and fills it with `generatedId()` when a
   * row is added, so renaming or reordering rows never breaks those links.
   * It is optional to parse: a module whose old data has no ids fills them in
   * from an `upgrade`.
   */
  generated?: boolean;
}

/** What a generated id may look like: short, and safe in a custom id or a URL. */
export const GENERATED_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** A new id for a `generated` string, eight characters as the dashboard makes them. */
export function generatedId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

function string(options: StringOptions = {}): Field<string> {
  const { min, max, multiline, origin, url, generated, default: def, ...rest } = options;
  const meta: FieldMeta = generated ? { ...rest, optional: true } : rest;
  return {
    kind: "string",
    meta,
    defaultValue: def,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      if (typeof input !== "string") return fail(path, "must be text");
      if (generated && !GENERATED_ID.test(input)) return fail(path, "is not a valid id");
      if (min !== undefined && input.length < min) {
        return fail(path, `must be at least ${min} characters`);
      }
      if (max !== undefined && input.length > max) {
        return fail(path, `must be at most ${max} characters`);
      }
      if (origin) {
        const normalized = normalizeOrigin(input);
        return normalized === null ? fail(path, "must be a web address starting with http:// or https://") : { ok: true, value: normalized };
      }
      if (url) {
        const trimmed = input.trim();
        return isHttpAddress(trimmed) ? { ok: true, value: trimmed } : fail(path, "must be a web address starting with http:// or https://");
      }
      return { ok: true, value: input };
    },
    describe: () => ({
      kind: "string",
      ...meta,
      default: def,
      min,
      max,
      multiline,
      ...(origin ? { origin: true } : {}),
      ...(url ? { url: true } : {}),
      ...(generated ? { generated: true } : {}),
    }),
  };
}

function isHttpAddress(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const parsed = new URL(text);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname !== "";
  } catch {
    return false;
  }
}

interface IntegerOptions extends FieldMeta {
  min?: number;
  max?: number;
  default?: number;
}

function integer(options: IntegerOptions = {}): Field<number> {
  const { min, max, default: def, ...meta } = options;
  return {
    kind: "integer",
    meta,
    defaultValue: def,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      const value = typeof input === "string" ? Number(input) : input;
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return fail(path, "must be a whole number");
      }
      if (min !== undefined && value < min) return fail(path, `must be at least ${min}`);
      if (max !== undefined && value > max) return fail(path, `must be at most ${max}`);
      return { ok: true, value };
    },
    describe: () => ({ kind: "integer", ...meta, default: def, min, max }),
  };
}

function boolean(options: FieldMeta & { default?: boolean } = {}): Field<boolean> {
  const { default: def, ...meta } = options;
  return {
    kind: "boolean",
    meta,
    defaultValue: def,
    parse(input, path = "") {
      if (input === undefined || input === null) return missing(this, path);
      if (typeof input !== "boolean") return fail(path, "must be on or off");
      return { ok: true, value: input };
    },
    describe: () => ({ kind: "boolean", ...meta, default: def }),
  };
}

const DURATION = /^(\d+)(s|m|h|d)$/;
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const UNIT_NAME: Record<string, string> = { s: "second", m: "minute", h: "hour", d: "day" };

export function durationToMs(text: string): number | null {
  const match = DURATION.exec(text.trim());
  if (!match) return null;
  const [, amount, unit] = match;
  const factor = unit === undefined ? undefined : UNIT_MS[unit];
  if (amount === undefined || factor === undefined) return null;
  return Number(amount) * factor;
}

/** "28d" as "28 days", for a validation message someone reads. */
export function spokenDuration(text: string): string {
  const match = DURATION.exec(text.trim());
  if (!match) return text;
  const [, amount, unit] = match;
  const name = unit === undefined ? undefined : UNIT_NAME[unit];
  if (amount === undefined || name === undefined) return text;
  return `${amount} ${name}${amount === "1" ? "" : "s"}`;
}

interface DurationOptions extends FieldMeta {
  default?: string;
  /** The longest allowed, written like "28d". */
  max?: string;
  /** The shortest allowed, written like "1m". Without it, zero is allowed. */
  min?: string;
}

/** Stored as milliseconds, written and displayed as "30s", "15m", "7d". */
function duration(options: DurationOptions = {}): Field<number> {
  const { default: def, max, min, ...meta } = options;
  const ceiling = max ? durationToMs(max) : null;
  const floor = min ? durationToMs(min) : null;
  return {
    kind: "duration",
    meta,
    defaultValue: def ? (durationToMs(def) ?? undefined) : undefined,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      if (typeof input === "number") {
        if (!Number.isFinite(input)) return fail(path, "must be a duration");
        // Milliseconds are the stored form, so this is also what every read of
        // saved settings goes through. A value saved before a limit existed is
        // pulled inside it rather than refused, since a refusal on read leaves
        // the whole feature unconfigured.
        let value = Math.max(0, Math.round(input));
        if (floor !== null && value < floor) value = floor;
        if (ceiling !== null && value > ceiling) value = ceiling;
        return { ok: true, value };
      }
      if (typeof input !== "string") return fail(path, "must be a duration");
      const ms = durationToMs(input);
      if (ms === null) return fail(path, "must look like 30s, 15m, 2h or 7d");
      if (floor !== null && ms < floor) return fail(path, `must be at least ${spokenDuration(min ?? "")}`);
      if (ceiling !== null && ms > ceiling) return fail(path, `must be ${spokenDuration(max ?? "")} or less`);
      return { ok: true, value: ms };
    },
    describe: () => ({ kind: "duration", ...meta, default: def, max, min }),
  };
}

const SNOWFLAKE = /^\d{17,20}$/;

function snowflakeField(
  kind: "channel" | "role",
  extra: Record<string, unknown>,
  meta: FieldMeta,
): Field<string> {
  return {
    kind,
    meta,
    defaultValue: undefined,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      if (typeof input !== "string" || !SNOWFLAKE.test(input)) {
        return fail(path, `must be a valid ${kind} ID`);
      }
      return { ok: true, value: input };
    },
    describe: () => ({ kind, ...meta, ...extra }),
  };
}

/** Rendered as a channel picker populated from the guild's live channel list. */
function channel(options: FieldMeta & { types?: ChannelType[] } = {}): Field<string> {
  const { types = ["text"], ...meta } = options;
  return snowflakeField("channel", { types }, meta);
}

/**
 * Rendered as a role picker. Every role can be picked unless `assigns` is set,
 * in which case roles above the bot's own are greyed out.
 */
function role(options: FieldMeta = {}): Field<string> {
  return snowflakeField("role", {}, options);
}

interface Choice {
  value: string;
  label: string;
  /** One line under the label, for options that need more than a name. */
  description?: string;
  /** Flagged as the suggested pick. Display only; it does not select anything. */
  recommended?: boolean;
  /** A CSS colour, such as `#5865f2`, for a choice drawn with `control: "swatches"` or shown as a dot on a card. */
  swatch?: string;
}

function choice(options: FieldMeta & { options: Choice[]; default?: string }): Field<string> {
  const { options: choices, default: def, ...meta } = options;
  const allowed = new Set(choices.map((c) => c.value));
  return {
    kind: "choice",
    meta,
    defaultValue: def,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      if (typeof input !== "string" || !allowed.has(input)) {
        return fail(path, "is not one of the available options");
      }
      return { ok: true, value: input };
    },
    describe: () => ({ kind: "choice", ...meta, default: def, options: choices }),
  };
}

const CUSTOM_EMOJI = /^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/;
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

/** One emoji as a person sees it, which can be several code points joined together. */
function isSingleUnicodeEmoji(value: string): boolean {
  if (!PICTOGRAPHIC.test(value)) return false;
  if (typeof Intl.Segmenter === "function") {
    const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
    return segments.length === 1;
  }
  return [...value].length <= 8;
}

/** The message every emoji field shows when what it holds is not one. */
export const EMOJI_ERROR = "must be one emoji, or a custom emoji from this server written as <:name:id>";

/**
 * Either a unicode emoji or Discord's custom form, `<:name:id>`. Stored as
 * written so it can go straight into a reaction or a message. The dashboard
 * turns a pasted `:name:` into the custom form when the server has an emoji of
 * that name, since only it knows the server's emoji.
 */
function emoji(options: FieldMeta & { default?: string } = {}): Field<string> {
  const { default: def, ...meta } = options;
  return {
    kind: "emoji",
    meta,
    defaultValue: def,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      if (typeof input !== "string") return fail(path, EMOJI_ERROR);
      const value = input.trim();
      if (CUSTOM_EMOJI.test(value)) return { ok: true, value };
      if (isSingleUnicodeEmoji(value)) return { ok: true, value };
      // The rule before joined emoji were understood, kept so nothing saved
      // under it stops validating: up to four code points that are not words.
      if ([...value].length <= 4 && !/^[\w\s]+$/.test(value)) {
        return { ok: true, value };
      }
      return fail(path, EMOJI_ERROR);
    },
    describe: () => ({ kind: "emoji", ...meta, default: def }),
  };
}

interface TemplateOptions extends FieldMeta {
  max?: number;
  default?: string;
  /** Substitutions the module makes, so the dashboard can offer them. */
  placeholders?: string[];
  /** Dashboard-only. What the preview shows for each placeholder, as in `{ position: "1" }`. */
  samples?: Record<string, string>;
  /**
   * Dashboard-only. `channel` previews the text as the channel name Discord
   * would make of it, lower case with hyphens, instead of as a message.
   */
  preview?: "message" | "channel";
}

/**
 * A message body with substitutions. Separate from a plain string because the
 * dashboard needs to show which placeholders a module understands, and because
 * Discord caps a message at 2000 characters.
 */
function template(options: TemplateOptions = {}): Field<string> {
  const { max = 2000, default: def, placeholders = [], ...meta } = options;
  return {
    kind: "template",
    meta,
    defaultValue: def,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      if (typeof input !== "string") return fail(path, "must be text");
      if (input.length > max) return fail(path, `must be at most ${max} characters`);
      const unknown = [...input.matchAll(/\{(\w+)\}/g)]
        .map((match) => match[1])
        .filter((name): name is string => name !== undefined && !placeholders.includes(name));
      if (unknown.length > 0) {
        return fail(path, `does not recognize {${unknown[0]}}`);
      }
      return { ok: true, value: input };
    },
    describe: () => ({ kind: "template", ...meta, default: def, max, placeholders }),
  };
}

/** A `{name}` a module fills into one of its messages, with a stand-in the dashboard shows in the preview. */
export interface MessageVariable {
  name: string;
  description: string;
  sample: string;
}

/**
 * A setting a message preview reads or edits: a path from the object that
 * holds the message, or from the root of the module's settings when it starts
 * with `/`. Dots step into objects, as in `appearance.buttonLabel`.
 */
export type AttachRef = string;

export type AttachButtonStyle = "primary" | "secondary" | "success" | "danger";

/**
 * One button per row of a sibling list, or one menu holding them all, as a
 * ticket panel has one button per ticket type. The paths inside `label`,
 * `labelFallback`, `emoji`, `style` and `description` are read in each row.
 */
export interface MessageAttachList {
  kind: "list";
  /** The sibling list. */
  list: AttachRef;
  label: string;
  /** Read when `label` is empty, such as the type's name. */
  labelFallback?: string;
  emoji?: string;
  /** A choice holding one of the button colours. */
  style?: string;
  /** A menu option's second line. */
  description?: string;
  /** A sibling choice that makes the rows one menu while it holds `menu`. */
  mode?: { field: AttachRef; menu: string };
  /** The menu's grey text before anything is picked. */
  placeholder?: AttachRef;
  /** What one row is, for "Add a ticket type": singular and lower case. */
  noun: string;
  /**
   * Whether the preview offers a button to add a row. Off where the list is
   * edited, with its own add button, on the same screen. Defaults to on.
   */
  add?: boolean;
}

/** A button the feature always adds under the message, its text and colour kept in other settings. */
export interface MessageAttachButton {
  /** What it does, for the editor's heading. */
  name: string;
  label: AttachRef;
  style?: AttachRef;
  /** The colour when there is no `style` setting. */
  defaultStyle?: AttachButtonStyle;
  /** A switch the button is only added while it is on. */
  when?: AttachRef;
}

export interface MessageAttachButtons {
  kind: "buttons";
  buttons: MessageAttachButton[];
}

/**
 * Dashboard-only. The buttons or menu the feature itself adds under a message
 * it sends, so the preview shows what members see and each one can be edited
 * where it is drawn. Every path must name an existing setting; the schema
 * check in the bot's tests holds modules to that.
 */
export type MessageAttach = MessageAttachList | MessageAttachButtons;

export interface MessageFieldOptions extends FieldMeta {
  /** What is particular to this message. The variables every message has are always on offer too. */
  variables?: MessageVariable[];
  /**
   * What the feature sends today. It is the default value, so the dashboard
   * shows the real wording and "go back to the default" has something to go
   * back to.
   */
  starting: MessageBody;
  /** Where it goes. A direct message cannot carry reactions or role, channel, user and mentionable menus. */
  delivery?: MessageDelivery;
  /** Set to false where the message cannot carry buttons or menus at all. */
  components?: boolean;
  /** A caveat shown in the editor, for when this covers more than one situation. */
  note?: string;
  /**
   * Dashboard-only. Draws the setting as one line (label, a short text summary
   * and the edit button) instead of a preview of the message. For a group of
   * minor messages; a message that is the point of its page keeps the preview.
   */
  compact?: boolean;
  /** What the feature adds under the message. See `MessageAttach`. */
  attach?: MessageAttach;
  /**
   * Dashboard-only. Who sees it: everyone in the channel, only the person it
   * answers, or the person it is sent to by direct message. Shown beside the
   * message in a message list.
   */
  audience?: MessageAudience;
}

/**
 * A message the owner can rewrite with the full message builder: text, embeds,
 * buttons, menus and reactions. A value saved while this setting was still a
 * plain `template` string is read as a message that is just that text, so
 * changing a setting's kind does not lose what owners already wrote.
 */
function message(options: MessageFieldOptions): Field<MessageBody> {
  const { variables = [], starting, delivery = "channel", components = true, note, attach, audience, ...meta } = options;
  const fit = (body: MessageBody) => restrictMessage(body, delivery, components);
  const defaultValue = fit(starting);
  return {
    kind: "message",
    meta,
    defaultValue,
    parse(input, path = "") {
      if (input === undefined || input === null) return missing(this, path);
      let raw: unknown = input;
      if (typeof input === "string") {
        if (input.trim() === "") return missing(this, path);
        raw = plainReply(input);
      }
      const parsed = parseMessage(raw);
      if (!parsed.ok) {
        // One error per field: the dashboard shows it under the control, and
        // the editor already pointed at the exact piece while it was typed.
        return fail(path, parsed.errors[0]?.message ?? "is not a valid message");
      }
      return { ok: true, value: fit(parsed.value) };
    },
    describe: () => ({
      kind: "message",
      ...meta,
      default: defaultValue,
      variables,
      starting: defaultValue,
      delivery,
      components,
      note,
      ...(attach ? { attach } : {}),
      ...(audience ? { audience } : {}),
    }),
  };
}

// -- composites ------------------------------------------------------------

interface ArrayOptions<T> extends FieldMeta {
  min?: number;
  max?: number;
  /** Refuse a list that holds the same value twice. Together with a choice this is a multi-select. */
  unique?: boolean;
  /** What an absent list becomes. Without one it is empty. */
  default?: T[];
  /**
   * Dashboard-only, for a list of choices. `chips` draws the options as a
   * wrapping row of toggles with their descriptions underneath; `rows` draws
   * one tall row per option with its description beside it. Without this, four
   * options or fewer are chips and more are rows.
   */
  layout?: "chips" | "rows" | "sheet";
  /**
   * Dashboard-only. What one entry of a list of rows is called, singular and
   * lower case, as in "Add a game". Without it the list's label is guessed at.
   */
  item?: string;
  /** Dashboard-only, with `layout: "sheet"`: what each row's card shows. */
  card?: RowCard;
  /** Dashboard-only: a preview of the list as a form, under it. */
  formPreview?: ListPreview;
}

function entries(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

function array<T>(inner: Field<T>, options: ArrayOptions<T> = {}): Field<T[]> {
  const { min, max, unique = false, default: def, ...meta } = options;
  return {
    kind: "array",
    meta,
    defaultValue: def ?? [],
    parse(input, path = "") {
      if (input === undefined || input === null) return { ok: true, value: [...(def ?? [])] };
      if (!Array.isArray(input)) return fail(path, "must be a list");
      if (min !== undefined && input.length < min) {
        return fail(path, `needs at least ${entries(min)}`);
      }
      if (max !== undefined && input.length > max) {
        return fail(path, `allows at most ${entries(max)}`);
      }
      const value: T[] = [];
      const errors: FieldError[] = [];
      input.forEach((item, index) => {
        const result = inner.parse(item, `${path}[${index}]`);
        if (result.ok) value.push(result.value);
        else errors.push(...result.errors);
      });
      if (unique && errors.length === 0) {
        const seen = new Set<string>();
        value.forEach((item, index) => {
          const key = JSON.stringify(item);
          if (seen.has(key)) errors.push({ path: `${path}[${index}]`, message: "is listed more than once" });
          seen.add(key);
        });
      }
      return errors.length ? { ok: false, errors } : { ok: true, value };
    },
    describe: () => ({
      kind: "array",
      ...meta,
      min,
      max,
      ...(unique ? { unique: true } : {}),
      ...(def !== undefined ? { default: def } : {}),
      of: inner.describe(),
    }),
  };
}

export type Shape = Record<string, Field<unknown>>;

export type ShapeValues<S extends Shape> = {
  [K in keyof S]: S[K] extends Field<infer T> ? T : never;
};

export interface ObjectField<S extends Shape> extends Field<ShapeValues<S>> {
  shape: S;
}

interface ObjectOptions extends FieldMeta {
  /**
   * Dashboard-only. Keys of this group's own fields whose current values are
   * shown on the header of a collapsed `collapsible` group, in this order. A
   * field whose `when` condition is not met is left out.
   */
  summary?: string[];
  /**
   * Rewrites what was stored before it is read, for a group whose settings were
   * reshaped. Settings are validated on read and unknown keys are dropped, so
   * without this an owner's old wording would silently fall back to the default.
   * It runs on every read, so it must leave an already-current value alone.
   */
  upgrade?: (stored: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Dashboard-only, for a top-level group. `messages` draws every message in it
   * as one searchable list of rows, each opening the message editor, under
   * headings from `topics`. `fields` draws its settings as labelled inputs in
   * two columns under those headings, each with a link back to its default.
   * Settings name their heading with `topic`.
   */
  layout?: "messages" | "fields";
  /** The headings of a `layout` group, in the order they are drawn. */
  topics?: FieldTopic[];
  /**
   * Dashboard-only. Draws the group's settings as numbered steps, each with a
   * title and a line saying what it is for, in this order. Settings name their
   * step with `step`. Only a row of a list is drawn this way.
   */
  steps?: FormStep[];
  /**
   * Dashboard-only. For a group inside a `layout: "sheet"` row whose settings
   * are spread over several tabs with `section`: the heading the group carries
   * in each tab, by tab id. A tab not listed uses the group's own label.
   */
  tabLabels?: Record<string, string>;
}

function object<S extends Shape>(shape: S, options: ObjectOptions = {}): ObjectField<S> {
  const { upgrade, ...meta } = options;
  return {
    kind: "object",
    meta,
    shape,
    defaultValue: undefined,
    parse(input, path = "") {
      let source = (input ?? {}) as Record<string, unknown>;
      if (typeof source !== "object" || Array.isArray(source)) {
        return fail(path, "must be a set of settings");
      }
      if (upgrade) source = upgrade(source);
      const value: Record<string, unknown> = {};
      const errors: FieldError[] = [];
      for (const [key, field] of Object.entries(shape)) {
        const child = path ? `${path}.${key}` : key;
        const result = field.parse(source[key], child);
        if (result.ok) {
          if (result.value !== undefined) value[key] = result.value;
        } else {
          errors.push(...result.errors);
        }
      }
      return errors.length
        ? { ok: false, errors }
        : { ok: true, value: value as ShapeValues<S> };
    },
    describe: () => ({
      kind: "object",
      ...meta,
      fields: Object.fromEntries(
        Object.entries(shape).map(([key, field]) => [key, field.describe()]),
      ),
    }),
  };
}

export const s = {
  string,
  integer,
  boolean,
  duration,
  channel,
  role,
  choice,
  emoji,
  template,
  message,
  array,
  object,
};
