/**
 * Turns the before and after snapshots of an audit entry into rows a person
 * can compare. Nested objects are flattened to dotted paths so a change deep
 * inside one still lines up with its counterpart.
 */

export interface DiffRow {
  /** Dotted path of the field. */
  path: string;
  label: string;
  before: unknown;
  after: unknown;
  hasBefore: boolean;
  hasAfter: boolean;
  changed: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flatten(value: unknown, prefix: string, into: Map<string, unknown>): void {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) into.set(prefix, value);
    for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, into);
    return;
  }
  into.set(prefix || "value", value);
}

/** Snapshot fields whose stored names read badly as words. */
const LABELS: Record<string, string> = {
  content: "Note",
  caseNumber: "Case",
  userId: "Member",
  moderatorId: "Moderator",
  createdAt: "Created",
  expiresAt: "Ends",
  active: "In force",
  voidedAt: "Removed at",
  voidedBy: "Removed by",
  voidReason: "Removal reason",
  role: "Role",
};

/** "targetUserId" becomes "Target user id", and a dotted path reads as a trail. */
function fieldLabel(path: string): string {
  return path
    .split(".")
    .map((part) => {
      const known = LABELS[part];
      if (known) return known;
      const words = part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(" / ");
}

export function diffSnapshots(before: unknown, after: unknown): DiffRow[] {
  const left = new Map<string, unknown>();
  const right = new Map<string, unknown>();
  if (before !== null && before !== undefined) flatten(before, "", left);
  if (after !== null && after !== undefined) flatten(after, "", right);

  const comparable = left.size > 0 && right.size > 0;
  const paths = [...left.keys()];
  for (const path of right.keys()) if (!left.has(path)) paths.push(path);

  return paths.map((path) => {
    const hasBefore = left.has(path);
    const hasAfter = right.has(path);
    const a = left.get(path);
    const b = right.get(path);
    return {
      path,
      label: fieldLabel(path),
      before: a,
      after: b,
      hasBefore,
      hasAfter,
      // With only one side recorded there is nothing to compare against, so nothing is flagged.
      changed: comparable && (hasBefore !== hasAfter || JSON.stringify(a) !== JSON.stringify(b)),
    };
  });
}

type ValueKind = "none" | "empty" | "bool" | "date" | "id" | "text";

interface ShownValue {
  kind: ValueKind;
  text: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const SNOWFLAKE = /^\d{15,25}$/;

const DATE_TIME = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** Dates are UTC and say so: the text is built on the server, whose zone is not the reader's. */
/** How a single value is written in the comparison: dates as dates, ids apart from prose, empties named. */
export function showValue(value: unknown): ShownValue {
  if (value === null || value === undefined) return { kind: "none", text: "None" };
  if (typeof value === "boolean") return { kind: "bool", text: value ? "Yes" : "No" };
  if (typeof value === "string") {
    if (value === "") return { kind: "empty", text: "Empty" };
    if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) {
      return { kind: "date", text: `${DATE_TIME.format(new Date(value))} UTC` };
    }
    if (SNOWFLAKE.test(value)) return { kind: "id", text: value };
    return { kind: "text", text: value };
  }
  if (typeof value === "number") return { kind: "text", text: String(value) };
  return { kind: "text", text: JSON.stringify(value) };
}

interface WordSegment {
  text: string;
  kind: "same" | "add" | "del";
}

const TOKEN = /\s+|[^\s]+/g;

/** Past this many token pairs the exact comparison is skipped and the text is shown as replaced. */
const MAX_CELLS = 400_000;

/**
 * A word-level comparison by longest common subsequence. Whitespace is kept
 * as tokens of its own so the result can be joined back into readable text.
 */
export function wordDiff(before: string, after: string): WordSegment[] {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];

  if (a.length * b.length > MAX_CELLS) {
    return [
      ...(before ? [{ text: before, kind: "del" as const }] : []),
      ...(after ? [{ text: after, kind: "add" as const }] : []),
    ];
  }

  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }

  const out: WordSegment[] = [];
  const push = (text: string, kind: WordSegment["kind"]) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i] as string, "same");
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      push(a[i] as string, "del");
      i++;
    } else {
      push(b[j] as string, "add");
      j++;
    }
  }
  while (i < a.length) push(a[i++] as string, "del");
  while (j < b.length) push(b[j++] as string, "add");
  return out;
}

/** Fields worth a word-level comparison: both sides are text and either is long or the field is free text. */
export function isProse(row: DiffRow): boolean {
  if (typeof row.before !== "string" || typeof row.after !== "string") return false;
  if (SNOWFLAKE.test(row.before) || SNOWFLAKE.test(row.after)) return false;
  if (ISO_DATE.test(row.before) || ISO_DATE.test(row.after)) return false;
  const free = row.path === "content" || row.path === "reason" || row.path === "voidReason";
  return free || row.before.length > 48 || row.after.length > 48 || /\n/.test(row.before + row.after);
}
