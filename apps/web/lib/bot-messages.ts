import { parseMessage, plainReply, REPLY_COLOR, type FieldDescriptor, type MessageBody, type ResponseTemplate } from "@tier0/core";

/**
 * The logic behind the Bot messages page: finding every message a server's
 * features can send, whatever the depth it sits at in a schema, and searching
 * and filtering them. Kept free of React and of the dashboard's other modules,
 * so it can be tested with plain objects.
 */

export type Segment = string | number;

export interface MessageVariableInfo {
  name: string;
  description: string;
  sample: string;
}

/** What the page needs to know about one feature. */
export interface ModuleInput {
  id: string;
  name: string;
  /** One line on what the feature does, for its card. */
  summary?: string;
  enabled: boolean;
  alwaysOn?: boolean;
  schema: Record<string, unknown>;
  commands: {
    name: string;
    kind: "slash" | "user" | "message";
    response: ResponseTemplate | null;
    privateByDefault: boolean;
  }[];
}

/** One message an owner can reword, wherever it comes from. */
export interface BotMessageRow {
  key: string;
  kind: "setting" | "reply";
  moduleId: string;
  moduleName: string;
  /** The feature is switched off. Its messages can still be edited. */
  moduleOff: boolean;
  label: string;
  /** When the bot sends it. */
  help: string;
  /** The groups between the feature and the message, such as "Replies and errors". */
  trail: string[];
  /** The group the message is listed under: its trail, with a list entry folded into the list's name. */
  section: string;
  /** For a message inside a list, which entry it belongs to, such as the name of a role menu. */
  entry: string | null;
  /** The id of the group on the feature's settings page that holds it. */
  anchor: string;
  /** Where the message sits in the feature's settings. Empty for a command reply. */
  segments: Segment[];
  /** The command a reply belongs to. */
  command: string | null;
  starting: MessageBody;
  variables: MessageVariableInfo[];
  delivery: "channel" | "dm";
  components: boolean;
  note: string | undefined;
  /** For a command reply: whether it is shown only to the person who ran the command. */
  isPrivate: boolean;
}

type Fields = Record<string, FieldDescriptor>;

/** The section for messages that sit directly under a feature's settings. */
export const GENERAL_SECTION = "General";
export const REPLIES_SECTION = "Command replies";

function titleOf(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** `menus[0].message` is how the bot names the place; this is the same place as a list of steps. */
export function pathOf(segments: readonly Segment[]): string {
  return segments.reduce<string>(
    (path, segment) => (typeof segment === "number" ? `${path}[${segment}]` : path === "" ? segment : `${path}.${segment}`),
    "",
  );
}

/** A short name for one entry of a list, taken from the first of its text settings that is filled in. */
function entryName(entry: unknown, fields: Fields, index: number): string {
  const row = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
  for (const key of ["name", "title", "label"]) {
    const value = row[key];
    if (fields[key] !== undefined && typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return `#${index + 1}`;
}

/** Entries of a list share one section, so a server with many role menus gets one group rather than one each. */
function sectionOf(trail: readonly string[], listed: { list: string; name: string } | null): string {
  const steps = listed ? trail.map((step) => (step === `${listed.list}: ${listed.name}` ? listed.list : step)) : trail;
  return steps.length === 0 ? GENERAL_SECTION : steps.join(" › ");
}

/**
 * Every message in a feature's settings, at any depth. A list of groups yields
 * one message for each entry the server has, since each is its own wording.
 */
function settingRows(module: ModuleInput, settings: Record<string, unknown>): BotMessageRow[] {
  const rows: BotMessageRow[] = [];
  const top = (module.schema.fields ?? {}) as Fields;

  const visit = (
    field: FieldDescriptor,
    key: string,
    segments: Segment[],
    trail: string[],
    anchorKey: string,
    value: unknown,
    listed: { list: string; name: string } | null = null,
  ) => {
    if (field.kind === "message") {
      rows.push({
        key: `${module.id}/${pathOf(segments)}`,
        kind: "setting",
        moduleId: module.id,
        moduleName: module.name,
        moduleOff: !module.enabled && module.alwaysOn !== true,
        label: field.label ?? titleOf(key),
        help: field.help ?? "",
        trail,
        section: sectionOf(trail, listed),
        entry: listed?.name ?? null,
        anchor: `group-${anchorKey}`,
        segments,
        command: null,
        starting: field.starting as MessageBody,
        variables: (field.variables ?? []) as MessageVariableInfo[],
        delivery: field.delivery === "dm" ? "dm" : "channel",
        components: field.components !== false,
        note: field.note as string | undefined,
        isPrivate: false,
      });
      return;
    }
    if (field.kind === "object") {
      const children = (field.fields ?? {}) as Fields;
      const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      const next = segments.length === 0 ? trail : [...trail, field.label ?? titleOf(key)];
      for (const [childKey, child] of Object.entries(children)) visit(child, childKey, [...segments, childKey], next, anchorKey, record[childKey], listed);
      return;
    }
    if (field.kind === "array") {
      const item = (field.of ?? {}) as FieldDescriptor;
      if (item.kind !== "object" || !Array.isArray(value)) return;
      const itemFields = (item.fields ?? {}) as Fields;
      value.forEach((entry, index) => {
        const list = field.label ?? titleOf(key);
        const entryLabel = entryName(entry, itemFields, index);
        const name = `${list}: ${entryLabel}`;
        const record = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
        for (const [childKey, child] of Object.entries(itemFields)) {
          visit(child, childKey, [...segments, index, childKey], [...trail, name], anchorKey, record[childKey], { list, name: entryLabel });
        }
      });
    }
  };

  for (const [key, field] of Object.entries(top)) {
    // A message directly under the settings, or in a list, sits on the card that holds the loose fields.
    const anchorKey = field.kind === "object" ? key : "general";
    visit(field, key, [key], [], anchorKey, settings[key]);
  }
  return rows;
}

function replyRows(module: ModuleInput): BotMessageRow[] {
  return module.commands.flatMap((command) => {
    if (!command.response) return [];
    const label = command.kind === "slash" ? `/${command.name}` : command.name;
    return [
      {
        key: `${module.id}/command:${command.name}`,
        kind: "reply" as const,
        moduleId: module.id,
        moduleName: module.name,
        moduleOff: !module.enabled && module.alwaysOn !== true,
        label,
        help: `Sent when ${command.kind === "slash" ? "someone uses" : "someone uses the right-click entry"} ${label}.`,
        trail: [REPLIES_SECTION],
        section: REPLIES_SECTION,
        entry: null,
        anchor: "",
        segments: [],
        command: command.name,
        starting: command.response.starting,
        variables: command.response.placeholders,
        delivery: "channel" as const,
        components: true,
        note: command.response.note,
        isPrivate: command.privateByDefault,
      },
    ];
  });
}

/**
 * Every message the bot can send on this server: the message settings of each
 * feature, then the replies of its commands. `settings` is what each feature has
 * stored, keyed by feature id, since a list has a row for each entry in it.
 */
export function collectMessageRows(
  modules: readonly ModuleInput[],
  settings: Readonly<Record<string, Record<string, unknown>>>,
): BotMessageRow[] {
  return modules.flatMap((module) => [...settingRows(module, settings[module.id] ?? {}), ...replyRows(module)]);
}

export function getAt(source: unknown, segments: readonly Segment[]): unknown {
  let current = source;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<Segment, unknown>)[segment];
  }
  return current;
}

/**
 * A copy of `source` with the value at `segments` replaced. A value of
 * undefined removes the key, which is how a setting goes back to its default:
 * the bot fills in whatever is missing.
 */
export function setAt<T>(source: T, segments: readonly Segment[], value: unknown): T {
  const [head, ...rest] = segments;
  if (head === undefined) return value as T;
  if (Array.isArray(source)) {
    const copy: unknown[] = [...source];
    copy[Number(head)] = rest.length === 0 ? value : setAt(copy[Number(head)], rest, value);
    return copy as T;
  }
  const record = (typeof source === "object" && source !== null ? source : {}) as Record<string, unknown>;
  const next = rest.length === 0 ? value : setAt(record[String(head)], rest, value);
  const copy = { ...record };
  if (next === undefined) delete copy[String(head)];
  else copy[String(head)] = next;
  return copy as T;
}

/** What was stored, as a message; null for the default and for anything that no longer reads as one. */
export function storedMessage(value: unknown): MessageBody | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() === "" ? null : plainReply(value);
  const parsed = parseMessage(value);
  return parsed.ok ? parsed.value : null;
}

/** Whether the owner has changed this message from the wording the bot ships with. */
export function isCustomized(stored: MessageBody | null, starting: MessageBody): boolean {
  return stored !== null && JSON.stringify(stored) !== JSON.stringify(starting);
}

/** What a row shows now, and whether that differs from the default. */
export interface RowView {
  body: MessageBody;
  edited: boolean;
}

export function viewOf(
  row: BotMessageRow,
  settings: Readonly<Record<string, Record<string, unknown>>>,
  replies: Readonly<Record<string, MessageBody | null>>,
): RowView {
  const stored = row.kind === "reply" ? (row.command ? (replies[row.command] ?? null) : null) : storedMessage(getAt(settings[row.moduleId], row.segments));
  const edited = isCustomized(stored, row.starting);
  return { body: edited && stored ? stored : row.starting, edited };
}

/** All the words a message says, for searching. Variables are kept as written, since owners search for them. */
export function messageText(body: MessageBody): string {
  const parts: string[] = [body.content];
  for (const embed of body.embeds) {
    parts.push(embed.title, embed.description, embed.authorName, embed.footerText);
    for (const field of embed.fields) parts.push(field.name, field.value);
  }
  for (const button of body.buttons) parts.push(button.label);
  return parts.filter((part) => part.trim() !== "").join(" ");
}

export interface RowFilter {
  query: string;
  /** A feature id, or null for every feature. */
  moduleId: string | null;
  editedOnly: boolean;
}

/**
 * Rows that match every word of the search, in any of the label, the help, the
 * feature's name, the groups it sits under and the message's current text.
 */
export function filterRows(rows: readonly BotMessageRow[], views: ReadonlyMap<string, RowView>, filter: RowFilter): BotMessageRow[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter((word) => word !== "");
  return rows.filter((row) => {
    const view = views.get(row.key);
    if (!view) return false;
    if (filter.moduleId !== null && row.moduleId !== filter.moduleId) return false;
    if (filter.editedOnly && !view.edited) return false;
    if (words.length === 0) return true;
    const haystack = [row.label, row.help, row.moduleName, ...row.trail, messageText(view.body)].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** How many messages each feature has. */
export function countByModule(rows: readonly BotMessageRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.moduleId, (counts.get(row.moduleId) ?? 0) + 1);
  return counts;
}

/** What a message is for, read from the colour of the embed the bot sends by default. */
export type MessageKind = "error" | "success" | "warning" | "info";

export const KIND_LABEL: Record<MessageKind, string> = {
  error: "Error",
  success: "Confirmation",
  warning: "Warning",
  info: "Notice",
};

/** Null for a message with no embed or one coloured by hand, which gets a neutral dot. */
export function kindOf(starting: MessageBody): MessageKind | null {
  const colour = starting.embeds[0]?.color?.toLowerCase();
  if (!colour) return null;
  for (const kind of Object.keys(REPLY_COLOR) as MessageKind[]) if (REPLY_COLOR[kind].toLowerCase() === colour) return kind;
  return null;
}

/**
 * Features in the order owners reach for them: what moderators and members see
 * most comes first. A feature not listed follows, by name.
 */
export const FEATURE_ORDER = ["moderation", "automod", "tickets", "welcome", "roles", "leveling", "feeds", "utility", "auditlog", "serverlog", "system"];

function featureRank(id: string): number {
  const index = FEATURE_ORDER.indexOf(id);
  return index === -1 ? FEATURE_ORDER.length : index;
}

export interface FeatureSummary {
  id: string;
  name: string;
  summary: string;
  off: boolean;
  total: number;
  edited: number;
}

/** One entry per feature that has a message, in the order owners reach for them. `views` decides what counts as edited. */
export function featureSummaries(rows: readonly BotMessageRow[], views: ReadonlyMap<string, RowView>, modules: readonly ModuleInput[]): FeatureSummary[] {
  const found = new Map<string, FeatureSummary>();
  for (const module of modules) {
    found.set(module.id, {
      id: module.id,
      name: module.name,
      summary: module.summary ?? "",
      off: !module.enabled && module.alwaysOn !== true,
      total: 0,
      edited: 0,
    });
  }
  for (const row of rows) {
    const entry = found.get(row.moduleId);
    if (!entry) continue;
    entry.total += 1;
    if (views.get(row.key)?.edited) entry.edited += 1;
  }
  return [...found.values()]
    .filter((entry) => entry.total > 0)
    .sort((a, b) => featureRank(a.id) - featureRank(b.id) || a.name.localeCompare(b.name));
}

export interface Section {
  title: string;
  rows: BotMessageRow[];
  edited: number;
}

/** A feature's messages under their group, in the order the groups first appear. */
export function groupBySection(rows: readonly BotMessageRow[], views: ReadonlyMap<string, RowView>): Section[] {
  const sections = new Map<string, Section>();
  for (const row of rows) {
    const section = sections.get(row.section) ?? { title: row.section, rows: [], edited: 0 };
    section.rows.push(row);
    if (views.get(row.key)?.edited) section.edited += 1;
    sections.set(row.section, section);
  }
  return dropSharedPrefix([...sections.values()]);
}

/**
 * When every nested group of a feature sits under the same parent, such as
 * "Replies and errors", repeating it on each title is noise. It is taken off
 * once there are two or more such groups, and left alone otherwise.
 */
function dropSharedPrefix(sections: Section[]): Section[] {
  const nested = sections.filter((section) => section.title.includes(" › "));
  const first = nested[0]?.title.split(" › ")[0];
  if (nested.length < 2 || first === undefined) return sections;
  if (!nested.every((section) => section.title.split(" › ")[0] === first)) return sections;
  return sections.map((section) => (section.title.includes(" › ") ? { ...section, title: section.title.split(" › ").slice(1).join(" › ") } : section));
}

/** Past this many messages a feature's sections start closed, so the page opens on a short list. */
export const OPEN_LIMIT = 12;

export function sectionsStartOpen(messageCount: number): boolean {
  return messageCount <= OPEN_LIMIT;
}

/**
 * Whether a section is open. What the owner toggled wins, except that while only
 * edited messages are shown every section is open: what is left is what was asked for.
 */
export function isSectionOpen(toggled: boolean | undefined, startOpen: boolean, editedOnly: boolean): boolean {
  return editedOnly ? true : (toggled ?? startOpen);
}

/**
 * The messages owners most often want to change, so the first thing on the page
 * is a way straight to them. Chosen as the ones members see first or that carry
 * the server's tone: the greeting, what automod and moderation say, the ticket
 * panel, level-ups. The path is where the message sits in the feature's settings.
 */
export const MOST_CHANGED: readonly { moduleId: string; path: string; label: string }[] = [
  { moduleId: "welcome", path: "join.message", label: "Welcome greeting" },
  { moduleId: "automod", path: "noticeMessage", label: "Automod notice" },
  { moduleId: "moderation", path: "modLogMessage", label: "Mod log post" },
  { moduleId: "tickets", path: "panel.message", label: "Ticket panel" },
  { moduleId: "leveling", path: "announce.message", label: "Level-up announcement" },
  { moduleId: "moderation", path: "dmMessage", label: "Punishment DM" },
];

export interface MostChangedItem {
  label: string;
  row: BotMessageRow;
}

/** The entries that exist and are worth showing: a message of a feature that is off and untouched is left out. */
export function resolveMostChanged(rows: readonly BotMessageRow[], views: ReadonlyMap<string, RowView>, editedOnly = false): MostChangedItem[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const items: MostChangedItem[] = [];
  for (const entry of MOST_CHANGED) {
    const row = byKey.get(`${entry.moduleId}/${entry.path}`);
    if (!row) continue;
    const edited = views.get(row.key)?.edited === true;
    if (row.moduleOff && !edited) continue;
    if (editedOnly && !edited) continue;
    items.push({ label: entry.label, row });
  }
  return items.slice(0, 6);
}

/** The feature named in the address, if it is one the page has; anything else shows the cards. */
export function parseFeatureParam(value: string | string[] | null | undefined, known: readonly string[]): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first !== undefined && first !== null && known.includes(first) ? first : null;
}

/** The query string for a view: a feature, or nothing for the cards. */
export function featureSearch(featureId: string | null): string {
  return featureId === null ? "" : `?feature=${encodeURIComponent(featureId)}`;
}
