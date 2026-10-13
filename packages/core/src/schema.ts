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
   */
  essential?: boolean;
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
}

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
}

function string(options: StringOptions = {}): Field<string> {
  const { min, max, multiline, origin, default: def, ...meta } = options;
  return {
    kind: "string",
    meta,
    defaultValue: def,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      if (typeof input !== "string") return fail(path, "must be text");
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
      return { ok: true, value: input };
    },
    describe: () => ({ kind: "string", ...meta, default: def, min, max, multiline, ...(origin ? { origin: true } : {}) }),
  };
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

/** Stored as milliseconds, written and displayed as "30s", "15m", "7d". */
function duration(options: FieldMeta & { default?: string; max?: string } = {}): Field<number> {
  const { default: def, max, ...meta } = options;
  const toMs = (text: string): number | null => {
    const match = DURATION.exec(text.trim());
    if (!match) return null;
    const [, amount, unit] = match;
    const factor = unit === undefined ? undefined : UNIT_MS[unit];
    if (amount === undefined || factor === undefined) return null;
    return Number(amount) * factor;
  };
  const ceiling = max ? toMs(max) : null;
  return {
    kind: "duration",
    meta,
    defaultValue: def ? (toMs(def) ?? undefined) : undefined,
    parse(input, path = "") {
      if (input === undefined || input === null || input === "") {
        return missing(this, path);
      }
      if (typeof input === "number") return { ok: true, value: input };
      if (typeof input !== "string") return fail(path, "must be a duration");
      const ms = toMs(input);
      if (ms === null) return fail(path, "must look like 30s, 15m, 2h or 7d");
      if (ceiling !== null && ms > ceiling) return fail(path, `must be ${max} or less`);
      return { ok: true, value: ms };
    },
    describe: () => ({ kind: "duration", ...meta, default: def, max }),
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

/** Rendered as a role picker. The dashboard filters roles above the bot's own. */
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

/**
 * Either a unicode emoji or Discord's custom form, `<:name:id>`. Stored as
 * written so it can go straight into a reaction or a message.
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
      if (typeof input !== "string") return fail(path, "must be an emoji");
      const value = input.trim();
      if (CUSTOM_EMOJI.test(value)) return { ok: true, value };
      // Unicode emoji arrive as one to four code points; anything longer is
      // text somebody typed into the wrong box.
      if ([...value].length <= 4 && !/^[\w\s]+$/.test(value)) {
        return { ok: true, value };
      }
      return fail(path, "must be an emoji, either unicode or :custom:");
    },
    describe: () => ({ kind: "emoji", ...meta, default: def }),
  };
}

interface TemplateOptions extends FieldMeta {
  max?: number;
  default?: string;
  /** Substitutions the module makes, so the dashboard can offer them. */
  placeholders?: string[];
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
}

/**
 * A message the owner can rewrite with the full message builder: text, embeds,
 * buttons, menus and reactions. A value saved while this setting was still a
 * plain `template` string is read as a message that is just that text, so
 * changing a setting's kind does not lose what owners already wrote.
 */
function message(options: MessageFieldOptions): Field<MessageBody> {
  const { variables = [], starting, delivery = "channel", components = true, note, ...meta } = options;
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
  layout?: "chips" | "rows";
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
        return fail(path, `needs at least ${min} entries`);
      }
      if (max !== undefined && input.length > max) {
        return fail(path, `allows at most ${max} entries`);
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
