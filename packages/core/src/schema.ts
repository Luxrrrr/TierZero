/**
 * Settings schema.
 *
 * A module describes its settings with these builders. Each field carries a
 * validator and enough metadata for the dashboard to render a control for it,
 * so no module ever ships dashboard code.
 *
 * Deliberately not zod: the dashboard needs to serialise a schema to JSON and
 * walk it, and reaching into another library's internals to do that breaks on
 * every minor release.
 */

export type FieldKind =
  | "string"
  | "integer"
  | "boolean"
  | "duration"
  | "channel"
  | "role"
  | "choice"
  | "array"
  | "object";

export type ChannelType = "text" | "voice" | "category" | "forum";

export interface FieldMeta {
  label?: string;
  help?: string;
  optional?: boolean;
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
  if (field.meta.optional) return { ok: true, value: undefined as never };
  if (field.defaultValue !== undefined) {
    return { ok: true, value: field.defaultValue as never };
  }
  return fail(path, "is required");
}

// -- primitives ------------------------------------------------------------

interface StringOptions extends FieldMeta {
  min?: number;
  max?: number;
  multiline?: boolean;
  default?: string;
}

function string(options: StringOptions = {}): Field<string> {
  const { min, max, multiline, default: def, ...meta } = options;
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
      return { ok: true, value: input };
    },
    describe: () => ({ kind: "string", ...meta, default: def, min, max, multiline }),
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
    return Number(match[1]) * UNIT_MS[match[2]];
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

// -- composites ------------------------------------------------------------

function array<T>(
  inner: Field<T>,
  options: FieldMeta & { min?: number; max?: number } = {},
): Field<T[]> {
  const { min, max, ...meta } = options;
  return {
    kind: "array",
    meta,
    defaultValue: [],
    parse(input, path = "") {
      if (input === undefined || input === null) return { ok: true, value: [] };
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
      return errors.length ? { ok: false, errors } : { ok: true, value };
    },
    describe: () => ({ kind: "array", ...meta, min, max, of: inner.describe() }),
  };
}

export type Shape = Record<string, Field<unknown>>;

export type ShapeValues<S extends Shape> = {
  [K in keyof S]: S[K] extends Field<infer T> ? T : never;
};

export interface ObjectField<S extends Shape> extends Field<ShapeValues<S>> {
  shape: S;
}

function object<S extends Shape>(shape: S, meta: FieldMeta = {}): ObjectField<S> {
  return {
    kind: "object",
    meta,
    shape,
    defaultValue: undefined,
    parse(input, path = "") {
      const source = (input ?? {}) as Record<string, unknown>;
      if (typeof source !== "object" || Array.isArray(source)) {
        return fail(path, "must be a set of settings");
      }
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
  array,
  object,
};
