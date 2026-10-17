/**
 * What the ticket workspace shares between the bot, which owns the data, and
 * the dashboard, which draws it: who may do what, the shape of every reply, and
 * the parsing both sides must agree on. Nothing here imports discord.js or
 * touches a database.
 */

import type { UserRef } from "./mod.js";

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === "string" && (TICKET_PRIORITIES as readonly string[]).includes(value);
}

export const TICKET_STATUSES = ["open", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type TicketMode = "channel" | "thread";

export const TICKET_EVENT_KINDS = [
  "opened",
  "claimed",
  "unclaimed",
  "priority",
  "transferred",
  "member_added",
  "member_removed",
  "rename",
  "close_requested",
  "closed",
  "reopened",
  "rated",
  "reminder",
  "opener_left",
] as const;
export type TicketEventKind = (typeof TICKET_EVENT_KINDS)[number];

export function isTicketEventKind(value: unknown): value is TicketEventKind {
  return typeof value === "string" && (TICKET_EVENT_KINDS as readonly string[]).includes(value);
}

/** What `TicketEvent.detail` holds for each kind. Every field is optional on read, since an old row may lack it. */
export interface TicketEventDetails {
  opened: { typeName?: string };
  claimed: Record<string, never>;
  unclaimed: Record<string, never>;
  priority: { from?: TicketPriority; to?: TicketPriority };
  transferred: { fromTypeId?: string; fromTypeName?: string; toTypeId?: string; toTypeName?: string };
  member_added: { userId?: string; name?: string };
  member_removed: { userId?: string; name?: string };
  rename: { from?: string; to?: string };
  close_requested: { reason?: string | null };
  closed: { reason?: string | null };
  reopened: Record<string, never>;
  rated: { rating?: number; comment?: string | null };
  reminder: Record<string, never>;
  /** `closed` when the setting closed the ticket because of it. */
  opener_left: { closed?: boolean };
}

/** Kinds of `TicketAudit` row. */
export type TicketAuditKind = "transcript.delete" | "tickets.bulk";

/** Discord's own cap on a message, which a dashboard reply is held to. */
export const TICKET_REPLY_MAX = 2000;
/** Replies one person may send from the dashboard in a minute. */
export const TICKET_REPLY_RATE_PER_MINUTE = 20;
/** Files one dashboard reply may carry. Discord allows ten on a message. */
export const TICKET_REPLY_FILES_MAX = 10;
/**
 * Bytes all the files of one dashboard reply may add up to. Discord takes 10 MiB
 * on a message in any server, boosted or not; this stays under it so the
 * request around the files fits too.
 */
export const TICKET_REPLY_FILES_BYTES_MAX = 8 * 1024 * 1024;
export const TICKET_NOTE_MAX = 2000;
export const TICKET_CLOSE_REASON_MAX = 500;
/** A channel name staff type for `/ticket rename` or the dashboard. */
export const TICKET_RENAME_MAX = 90;
export const TICKET_PAGE_SIZE = 25;
export const TICKET_STATS_PERIODS = [7, 30, 90] as const;
export type TicketStatsPeriod = (typeof TICKET_STATS_PERIODS)[number];

/**
 * The panel and type that a server configured before types existed is read
 * as, and that tickets opened back then are stored under.
 */
export const LEGACY_PANEL_ID = "default";
export const LEGACY_TYPE_ID = "support";

// -- access -----------------------------------------------------------------

export type TicketAccessLevel = "manager" | "admin" | "handler";

/** A signed-in dashboard user, or a member in Discord, as the bot sees them in one server. */
export interface TicketViewer {
  userId: string;
  /** Has Manage Server in that server, or is the instance owner. */
  isManager: boolean;
  /**
   * Has Manage Channels. They work every type's tickets like an admin role,
   * in Discord and in the dashboard, but changing the settings still takes
   * Manage Server.
   */
  worksEveryType?: boolean;
  /** Their roles in that server right now. */
  roleIds: readonly string[];
}

/** The part of a server's ticket settings that decides access. */
export interface TicketAccessSettings {
  adminRoleIds: readonly string[];
  types: readonly { id: string; handlerRoleIds: readonly string[]; claim?: boolean }[];
  /** A claimed ticket can only be answered by whoever claimed it, among handlers. */
  claimLock?: boolean;
  /** Closed tickets whose channel was kept may be reopened. */
  reopen?: boolean;
}

export interface TicketAccess {
  level: TicketAccessLevel | null;
  userId: string;
  /** Every type for a manager or an admin role, the types whose handler roles they hold otherwise. */
  handledTypeIds: string[];
  claimLock: boolean;
  reopen: boolean;
  /** Types with claiming switched off. */
  unclaimableTypeIds: string[];
}

/**
 * Where a viewer stands in a server's ticket workspace. The member who opened
 * a ticket is not a dashboard user by this rule: they work it in Discord.
 */
export function ticketAccess(viewer: TicketViewer, settings: TicketAccessSettings): TicketAccess {
  const roles = new Set(viewer.roleIds);
  const allTypes = settings.types.map((type) => type.id);
  const base = {
    userId: viewer.userId,
    claimLock: settings.claimLock === true,
    reopen: settings.reopen !== false,
    unclaimableTypeIds: settings.types.filter((type) => type.claim === false).map((type) => type.id),
  };
  if (viewer.isManager) return { ...base, level: "manager", handledTypeIds: allTypes };
  if (viewer.worksEveryType === true || settings.adminRoleIds.some((id) => roles.has(id))) {
    return { ...base, level: "admin", handledTypeIds: allTypes };
  }
  const handled = settings.types.filter((type) => type.handlerRoleIds.some((id) => roles.has(id))).map((type) => type.id);
  if (handled.length > 0) return { ...base, level: "handler", handledTypeIds: handled };
  return { ...base, level: null, handledTypeIds: [] };
}

export const TICKET_PERMISSIONS = [
  "view",
  "reply",
  "claim",
  "unclaim",
  "priority",
  "note",
  "members",
  "transfer",
  "close",
  "reopen",
  "deleteTranscript",
  "stats",
  "settings",
  "rename",
  "requestClose",
] as const;
export type TicketPermission = (typeof TICKET_PERMISSIONS)[number];

/** The part of a ticket that decides what may be done to it. */
export interface TicketAccessTarget {
  /** Null for a ticket opened before types existed, read as LEGACY_TYPE_ID. */
  typeId: string | null;
  status: string;
  /** Closed with its channel kept. */
  archived?: boolean;
  claimedById?: string | null;
}

const WHILE_OPEN = new Set<TicketPermission>(["reply", "claim", "unclaim", "priority", "members", "transfer", "close", "rename", "requestClose"]);

/**
 * Whether a viewer may do something. Without a ticket it answers for the
 * workspace as a whole: whether they may open it at all, see stats, change
 * settings. With one it also checks the ticket's type and state, so the
 * dashboard can disable what the bot would refuse.
 *
 * Among handlers a claim is respected: they cannot take over or drop someone
 * else's claim, and with the claim lock on they cannot answer it either.
 * Admin roles and managers can.
 */
export function canTicket(access: TicketAccess, permission: TicketPermission, ticket?: TicketAccessTarget): boolean {
  const { level } = access;
  if (level === null) return false;
  if (permission === "settings") return level === "manager";
  if (!ticket) {
    if (permission === "deleteTranscript") return level === "manager";
    return permission === "view" || permission === "stats";
  }

  const typeId = ticket.typeId ?? LEGACY_TYPE_ID;
  if (level === "handler" && !access.handledTypeIds.includes(typeId)) return false;
  if (permission === "deleteTranscript") return level === "manager" && ticket.status === "closed";
  if (permission === "view" || permission === "stats" || permission === "note") return true;

  if (WHILE_OPEN.has(permission) && ticket.status !== "open") return false;
  const claimedBy = ticket.claimedById ?? null;
  const claimedByOther = claimedBy !== null && claimedBy !== access.userId;

  switch (permission) {
    case "reply":
      return !(level === "handler" && access.claimLock && claimedByOther);
    case "claim":
      if (access.unclaimableTypeIds.includes(typeId)) return false;
      return claimedBy === null || (claimedByOther && level !== "handler");
    case "unclaim":
      return claimedBy !== null && (!claimedByOther || level !== "handler");
    case "reopen":
      return ticket.status === "closed" && ticket.archived === true && access.reopen;
    default:
      return true;
  }
}

/** Every permission a viewer holds, on one ticket or on the workspace, for a reply the dashboard draws its buttons from. */
export function ticketPermissions(access: TicketAccess, ticket?: TicketAccessTarget): TicketPermission[] {
  return TICKET_PERMISSIONS.filter((permission) => canTicket(access, permission, ticket));
}

// -- links ------------------------------------------------------------------

/** Where a ticket opens in the dashboard, relative to its origin. */
export function ticketDashboardPath(guildId: string, ticketId: number): string {
  return `/guilds/${guildId}/tickets/${ticketId}`;
}

/** The full address, or an empty string when the dashboard's address is not known, so a link button drops out. */
export function ticketDashboardUrl(base: string, guildId: string, ticketId: number): string {
  return base === "" ? "" : `${base}${ticketDashboardPath(guildId, ticketId)}`;
}

// -- stored JSON ------------------------------------------------------------

export interface TicketAnswer {
  label: string;
  value: string;
}

export interface TicketAttachmentDto {
  name: string;
  url: string;
  contentType: string | null;
  size: number;
}

/**
 * An embed as it was posted. Rows stored before full embeds were kept hold
 * only the title and the description; they read with everything else empty.
 */
export interface TicketEmbedDto {
  /** Discord's embed type: `rich` for a bot's embed, `image`, `gifv`, `video`, `link` or `article` for a link preview. */
  type: string;
  title: string;
  description: string;
  url: string | null;
  /** The colour of the bar on the left, as Discord gives it: a number, or null for none. */
  color: number | null;
  author: { name: string; url: string | null; iconUrl: string | null } | null;
  /** The site a link preview came from. */
  provider: { name: string; url: string | null } | null;
  fields: { name: string; value: string; inline: boolean }[];
  thumbnailUrl: string | null;
  imageUrl: string | null;
  footer: { text: string; iconUrl: string | null } | null;
  /** ISO 8601, shown after the footer. */
  timestamp: string | null;
}

/** A custom emoji has an id; a unicode one is only its character, in `name`. */
export interface TicketEmojiDto {
  id: string | null;
  name: string;
  animated: boolean;
}

/** A button or a select menu on a bot's message, kept to be drawn, never to be pressed. */
export type TicketComponentDto =
  | {
      kind: "button";
      /** Discord's button style: 1 primary, 2 secondary, 3 success, 4 danger, 5 link, 6 premium. */
      style: number;
      label: string;
      emoji: TicketEmojiDto | null;
      url: string | null;
      disabled: boolean;
    }
  | { kind: "select"; placeholder: string; disabled: boolean };

export interface TicketComponentRowDto {
  components: TicketComponentDto[];
}

export interface TicketStickerDto {
  id: string;
  name: string;
  /** Discord's sticker format: 1 PNG, 2 APNG, 3 Lottie, 4 GIF. */
  format: number;
}

export interface TicketReactionDto {
  emoji: TicketEmojiDto;
  count: number;
}

/** A name a mention reads as, and the colour it is drawn in for a role or a member's top role. */
export interface TicketMentionName {
  name: string;
  color?: string | null;
}

/** The names behind the ids mentioned in a message, as they were when it was stored. */
export interface TicketMentionsDto {
  users: Record<string, TicketMentionName>;
  roles: Record<string, TicketMentionName>;
  channels: Record<string, TicketMentionName>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readList(stored: string | null | undefined): unknown[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Reads `Ticket.answers`. A damaged value reads as no answers rather than failing the ticket. */
export function readTicketAnswers(stored: string | null | undefined): TicketAnswer[] {
  return readList(stored)
    .filter(isRecord)
    .map((entry) => ({ label: text(entry.label), value: text(entry.value) }))
    .filter((entry) => entry.label !== "" || entry.value !== "");
}

/** Reads `TicketMessage.attachments`. */
export function readTicketAttachments(stored: string | null | undefined): TicketAttachmentDto[] {
  return readList(stored)
    .filter(isRecord)
    .filter((entry) => typeof entry.url === "string" && entry.url !== "")
    .map((entry) => ({
      name: text(entry.name) || "file",
      url: text(entry.url),
      contentType: typeof entry.contentType === "string" ? entry.contentType : null,
      size: typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : 0,
    }));
}

const SNOWFLAKE_ID = /^\d{17,20}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** An address that may be linked or loaded: http or https only. Anything else reads as none. */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const hexColor = (value: unknown): string | null => (typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : null);
const snowflake = (value: unknown): string | null => (typeof value === "string" && SNOWFLAKE_ID.test(value) ? value : null);
const short = (value: unknown, max: number): string => text(value).slice(0, max);

function readEmbed(entry: Record<string, unknown>): TicketEmbedDto {
  const author =
    isRecord(entry.author) && text(entry.author.name) !== ""
      ? { name: short(entry.author.name, 256), url: webUrl(entry.author.url), iconUrl: webUrl(entry.author.iconUrl) }
      : null;
  const provider =
    isRecord(entry.provider) && text(entry.provider.name) !== "" ? { name: short(entry.provider.name, 256), url: webUrl(entry.provider.url) } : null;
  const footer =
    isRecord(entry.footer) && text(entry.footer.text) !== "" ? { text: short(entry.footer.text, 2048), iconUrl: webUrl(entry.footer.iconUrl) } : null;
  const color =
    typeof entry.color === "number" && Number.isInteger(entry.color) && entry.color >= 0 && entry.color <= 0xffffff ? entry.color : null;
  const timestamp =
    typeof entry.timestamp === "string" && !Number.isNaN(Date.parse(entry.timestamp)) ? new Date(entry.timestamp).toISOString() : null;
  return {
    type: typeof entry.type === "string" && /^[a-z_]{1,20}$/.test(entry.type) ? entry.type : "rich",
    title: short(entry.title, 256),
    description: short(entry.description, 4096),
    url: webUrl(entry.url),
    color,
    author,
    provider,
    fields: (Array.isArray(entry.fields) ? entry.fields : [])
      .filter(isRecord)
      .slice(0, 25)
      .map((field) => ({ name: short(field.name, 256), value: short(field.value, 1024), inline: field.inline === true }))
      .filter((field) => field.name !== "" || field.value !== ""),
    thumbnailUrl: webUrl(entry.thumbnailUrl),
    imageUrl: webUrl(entry.imageUrl),
    footer,
    timestamp,
  };
}

const hasContent = (embed: TicketEmbedDto) =>
  embed.title !== "" ||
  embed.description !== "" ||
  embed.fields.length > 0 ||
  embed.author !== null ||
  embed.footer !== null ||
  embed.imageUrl !== null ||
  embed.thumbnailUrl !== null;

/** Reads `TicketMessage.embeds`, old rows of a title and a description included. */
export function readTicketEmbeds(stored: string | null | undefined): TicketEmbedDto[] {
  return readList(stored).filter(isRecord).slice(0, 10).map(readEmbed).filter(hasContent);
}

function readEmoji(value: unknown): TicketEmojiDto | null {
  if (!isRecord(value)) return null;
  const id = snowflake(value.id);
  const name = short(value.name, 64);
  if (id === null && name === "") return null;
  return { id, name, animated: value.animated === true };
}

/** Reads `TicketMessage.components`: rows of buttons and select menus. Anything else Discord adds is left out. */
export function readTicketComponents(stored: string | null | undefined): TicketComponentRowDto[] {
  const rows: TicketComponentRowDto[] = [];
  for (const row of readList(stored).filter(isRecord).slice(0, 5)) {
    const components: TicketComponentDto[] = [];
    for (const item of (Array.isArray(row.components) ? row.components : []).filter(isRecord).slice(0, 5)) {
      if (item.kind === "button") {
        const style = typeof item.style === "number" && Number.isInteger(item.style) && item.style >= 1 && item.style <= 6 ? item.style : 2;
        components.push({
          kind: "button",
          style,
          label: short(item.label, 80),
          emoji: readEmoji(item.emoji),
          url: webUrl(item.url),
          disabled: item.disabled === true,
        });
      } else if (item.kind === "select") {
        components.push({ kind: "select", placeholder: short(item.placeholder, 150), disabled: item.disabled === true });
      }
    }
    if (components.length > 0) rows.push({ components });
  }
  return rows;
}

/** Reads `TicketMessage.stickers`. */
export function readTicketStickers(stored: string | null | undefined): TicketStickerDto[] {
  return readList(stored)
    .filter(isRecord)
    .slice(0, 3)
    .map((entry) => ({ id: snowflake(entry.id) ?? "", name: short(entry.name, 64), format: typeof entry.format === "number" ? entry.format : 0 }))
    .filter((entry) => entry.id !== "" || entry.name !== "");
}

/** Reads `TicketMessage.reactions`. */
export function readTicketReactions(stored: string | null | undefined): TicketReactionDto[] {
  const out: TicketReactionDto[] = [];
  for (const entry of readList(stored).filter(isRecord).slice(0, 40)) {
    const emoji = readEmoji(entry.emoji);
    const count = typeof entry.count === "number" && Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 0;
    if (emoji && count > 0) out.push({ emoji, count });
  }
  return out;
}

function readNames(value: unknown, max: number): Record<string, TicketMentionName> {
  const out: Record<string, TicketMentionName> = {};
  if (!isRecord(value)) return out;
  let count = 0;
  for (const [id, entry] of Object.entries(value)) {
    if (count >= max) break;
    if (!SNOWFLAKE_ID.test(id) || !isRecord(entry) || text(entry.name) === "") continue;
    out[id] = { name: short(entry.name, 100), color: hexColor(entry.color) };
    count++;
  }
  return out;
}

/** Reads `TicketMessage.mentions`. */
export function readTicketMentions(stored: string | null | undefined): TicketMentionsDto {
  let parsed: unknown = null;
  if (stored) {
    try {
      parsed = JSON.parse(stored);
    } catch {
      parsed = null;
    }
  }
  const value = isRecord(parsed) ? parsed : {};
  return { users: readNames(value.users, 100), roles: readNames(value.roles, 100), channels: readNames(value.channels, 100) };
}

/** The columns of a `TicketMessage` row a reply is made from. The later columns are optional so a row from before them still reads. */
export interface TicketMessageRow {
  id: number;
  messageId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  authorIsStaff: boolean;
  authorColor?: string | null;
  authorBot?: boolean;
  replyToId?: string | null;
  content: string;
  attachments: string;
  embeds: string;
  components?: string;
  stickers?: string;
  reactions?: string;
  mentions?: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  edits: number;
  source: string;
}

/** A stored message as the dashboard and the transcript files read it. */
export function ticketMessageFromRow(row: TicketMessageRow): TicketMessageDto {
  return {
    id: row.id,
    messageId: row.messageId,
    author: {
      userId: row.authorId,
      name: row.authorName,
      avatarUrl: webUrl(row.authorAvatar),
      isStaff: row.authorIsStaff,
      bot: row.authorBot === true,
      color: hexColor(row.authorColor),
    },
    content: row.content,
    attachments: readTicketAttachments(row.attachments),
    embeds: readTicketEmbeds(row.embeds),
    replyTo: snowflake(row.replyToId),
    components: readTicketComponents(row.components),
    stickers: readTicketStickers(row.stickers),
    reactions: readTicketReactions(row.reactions),
    mentions: readTicketMentions(row.mentions),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    edits: row.edits,
    source: row.source === "dashboard" ? "dashboard" : "discord",
  };
}

/** Reads `TicketEvent.detail` or `TicketAudit.detail`. Anything that is not an object reads as empty. */
export function readTicketDetail(stored: string | null | undefined): Record<string, unknown> {
  if (!stored) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// -- reads ------------------------------------------------------------------

/** Someone who acted, as their name was when they did. */
export interface TicketActorRef {
  userId: string;
  name: string;
}

export interface TicketSummaryDto {
  /** The internal id, used in addresses and requests. Show `number` to people. */
  id: number;
  /** The number people see, counted per server. Missing from an older bot; show `id` then. */
  number?: number;
  channelId: string;
  /** The channel's name as last seen, without the #. */
  channelName: string;
  status: TicketStatus;
  /** Closed with the channel kept and locked. */
  archived: boolean;
  mode: TicketMode;
  panelId: string | null;
  typeId: string | null;
  /** As it was when the ticket opened or was last transferred, so it reads after the type is removed. */
  typeName: string;
  /** What the member typed as the subject, or the first answer to the form, or null. */
  subject: string | null;
  opener: UserRef;
  claimedBy: UserRef | null;
  priority: TicketPriority;
  openedAt: string;
  closedAt: string | null;
  lastActivityAt: string;
  messageCount: number;
  /** The opener sent the latest message, so it is waiting on staff. */
  awaitingStaff: boolean;
  rating: number | null;
}

/** Why someone can see a ticket's channel. */
export type TicketMemberAccess = "opener" | "handler" | "observer" | "added";

export interface TicketMemberDto {
  user: UserRef;
  access: TicketMemberAccess;
}

export interface TicketEventDto {
  id: number;
  kind: TicketEventKind;
  actor: TicketActorRef | null;
  /** One of `TicketEventDetails[kind]`. */
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface TicketNoteDto {
  id: number;
  author: TicketActorRef;
  body: string;
  createdAt: string;
}

export interface TicketMessageDto {
  id: number;
  messageId: string;
  author: {
    userId: string;
    name: string;
    avatarUrl: string | null;
    isStaff: boolean;
    /** A bot or a webhook, which Discord tags APP. Missing from an older bot. */
    bot?: boolean;
    /** The colour of their top coloured role, as `#rrggbb`, or null for none. */
    color?: string | null;
  };
  content: string;
  attachments: TicketAttachmentDto[];
  embeds: TicketEmbedDto[];
  /** The Discord id of the message this one replies to. */
  replyTo?: string | null;
  components?: TicketComponentRowDto[];
  stickers?: TicketStickerDto[];
  reactions?: TicketReactionDto[];
  mentions?: TicketMentionsDto;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** How many times it was edited. */
  edits: number;
  source: "discord" | "dashboard";
}

/** `GET tickets/:id/messages?after=<messageId>`, oldest first. */
export interface TicketMessagesPage {
  items: TicketMessageDto[];
  /** The last message id returned, to pass as `after` next time, or null when nothing came back. */
  cursor: string | null;
  /** More messages exist after this page. */
  hasMore: boolean;
  /** The stored messages were deleted, by retention or by a manager. */
  pruned: boolean;
  /** Which of the two removed them, and when. Null when nothing was removed. Missing from an older bot. */
  removal?: TicketTranscriptRemoval | null;
  /**
   * Messages from before the cursor that were edited or deleted since the
   * `updatedSince` the request named, so a poll sees changes as well as new
   * messages. Empty when the request named none.
   */
  changed: TicketMessageDto[];
  /** The moment this page was read, to pass as `updatedSince` next time. ISO 8601. */
  updatedSince: string;
}

/**
 * Why a ticket's stored messages are gone: a manager deleted the transcript
 * (who and when are kept), or the retention period under Transcripts ran out.
 */
export type TicketTranscriptRemoval =
  | { kind: "deleted"; at: string; by: TicketActorRef | null }
  | { kind: "pruned"; at: string | null };

/** What a ticket's transcript holds, for the view to say why it is empty and which downloads make sense. */
export interface TicketTranscriptState {
  /** Stored messages left. */
  messages: number;
  removal: TicketTranscriptRemoval | null;
}

/** The poll cursor for changes, or null when absent or not a date. A malformed one is refused rather than read as "everything". */
export function readUpdatedSince(value: string | null | undefined): { ok: true; value: Date | null } | { ok: false } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const at = Date.parse(value);
  return Number.isNaN(at) ? { ok: false } : { ok: true, value: new Date(at) };
}

export interface TicketDetailDto extends TicketSummaryDto {
  answers: TicketAnswer[];
  closeReason: string | null;
  closedBy: TicketActorRef | null;
  firstResponseAt: string | null;
  ratingComment: string | null;
  ratedAt: string | null;
  reopenedCount: number;
  closeRequestedAt: string | null;
  /** Oldest first. */
  events: TicketEventDto[];
  /** Newest first. */
  notes: TicketNoteDto[];
  members: TicketMemberDto[];
  /** The channel still exists in Discord. */
  channelExists: boolean;
  /** A link that opens the channel in Discord, or null when it is gone. */
  discordUrl: string | null;
  openerJoinedAt: string | null;
  /** The opener's other tickets in this server, open or closed. */
  openerTicketCount: number;
  /** The opener has a record in moderation, so their profile is worth linking to. */
  openerHasModRecord: boolean;
  /** What the viewer may do on this ticket. */
  permissions: TicketPermission[];
  /** When the opener left the server while the ticket was open, or null. Missing from an older bot. */
  openerLeftAt?: string | null;
  /** For a thread ticket, the channel it sits under. Missing from an older bot. */
  parentChannelId?: string | null;
  /** That channel's name as Discord has it now, without the #, or null when it is not known. */
  parentChannelName?: string | null;
  /** What the transcript holds. Missing from an older bot. */
  transcript?: TicketTranscriptState;
}

export interface TicketTypeOption {
  id: string;
  name: string;
  emoji: string | null;
  panelId: string;
  /** The viewer handles this type, so its tickets show in their inbox. */
  handled: boolean;
  /** Closing one of these tickets needs a reason. Missing from an older bot, which reads as no. */
  requireReason?: boolean;
  /**
   * What stops a ticket of this type opening, or moving to it, right now: the
   * first blocking health code about the type, or null when nothing does.
   * Missing from an older bot.
   */
  problem?: TicketHealthCode | null;
}

export interface TicketPanelOption {
  id: string;
  name: string;
  channelId: string | null;
  types: TicketTypeOption[];
}

export type TicketHealthCode =
  | "missingManageChannels"
  | "missingManageThreads"
  | "missingManageWebhooks"
  | "noPanels"
  | "noPanelsPosted"
  | "panelChannelMissing"
  | "panelNotPosted"
  | "panelLegacy"
  | "categoryNotSet"
  | "categoryMissing"
  | "categoryFull"
  | "typeNoHandlers"
  /** The posted message was deleted in Discord. */
  | "panelMessageMissing"
  /** The panel's settings changed since it was posted, so the message in Discord is out of date. */
  | "panelChanged"
  /** The panel is still up in a channel it was moved away from. `channelId` is where it is now; posting moves it. */
  | "panelMoved"
  /** A type's emoji is a custom one this server does not have, so Discord refuses to post the panel. */
  | "typeEmojiMissing";

export interface TicketHealthIssue {
  code: TicketHealthCode;
  /** Stops members opening tickets, as opposed to a feature that works less well. */
  blocking: boolean;
  /**
   * One of the steps of setting tickets up for the first time (a panel, a
   * channel, posting it, handlers), which a first-run guide covers. Counting
   * or hiding issues by this flag keeps every place that shows them in step.
   * Missing from an older bot.
   */
  firstRun?: boolean;
  panelId?: string;
  typeId?: string;
  channelId?: string;
}

/** What `ticketHealthSummary` makes of the issues, for a headline that says how much is wrong. */
export interface TicketHealthSummary {
  /**
   * `allBlocked`: no type can open a ticket. `someBlocked`: some types can and
   * some cannot. `warnings`: tickets open but something works less well.
   */
  state: "ok" | "warnings" | "someBlocked" | "allBlocked";
  /** Issues with `blocking`, then the rest. The same numbers wherever the issues are counted. */
  blocking: number;
  warnings: number;
  /** As above, leaving out the first-run issues, for a page that shows those as steps instead. */
  blockingAfterFirstRun: number;
  warningsAfterFirstRun: number;
  totalTypes: number;
  /** Every type that cannot open a ticket now, with the blocking codes that stop it. */
  blockedTypes: { panelId: string; typeId: string; codes: TicketHealthCode[] }[];
}

const FIRST_RUN_CODES = new Set<TicketHealthCode>(["noPanels", "noPanelsPosted", "panelChannelMissing", "panelNotPosted", "typeNoHandlers"]);

/** What the bot found, for `ticketHealth` to judge. */
export interface TicketHealthFacts {
  permissions: { manageChannels: boolean; manageWebhooks: boolean; manageThreads: boolean };
  panels: {
    id: string;
    channelId: string | null;
    channelExists: boolean;
    posted: boolean;
    /**
     * Posted by the version before panels were tracked, which did not record
     * the message, so it can be neither found nor updated. Only a server that
     * really used that version has one.
     */
    legacy?: boolean;
    /** A post was recorded but Discord no longer has the message. */
    messageMissing?: boolean;
    /** The settings changed since the post. */
    changed?: boolean;
    /** The posted message is still up in this other channel, which the panel was moved away from. */
    liveChannelId?: string | null;
    types: {
      id: string;
      mode: TicketMode;
      handlerCount: number;
      categoryId: string | null;
      categoryExists: boolean;
      /** Channels in the category now. */
      categoryChildren: number;
      overflowCategoryId?: string | null;
      overflowExists?: boolean;
      overflowChildren?: number;
      /** Its emoji is a custom one the server does not have. */
      emojiMissing?: boolean;
    }[];
  }[];
}

/** Discord's limit on the channels in one category. */
export const CATEGORY_CHANNEL_LIMIT = 50;

/** A panel members can open tickets from now, wherever it is. */
const panelIsUp = (panel: TicketHealthFacts["panels"][number]) =>
  (panel.posted && panel.messageMissing !== true) || panel.legacy === true || !!panel.liveChannelId;

/**
 * Everything wrong with a server's tickets right now, in the order the
 * dashboard lists it. The dashboard words each one; the bot only gathers the
 * facts.
 */
export function ticketHealth(facts: TicketHealthFacts): TicketHealthIssue[] {
  const issues: TicketHealthIssue[] = [];
  const push = (issue: TicketHealthIssue) => issues.push(FIRST_RUN_CODES.has(issue.code) ? { ...issue, firstRun: true } : issue);
  const types = facts.panels.flatMap((panel) => panel.types.map((type) => ({ panel, type })));

  if (types.some(({ type }) => type.mode === "channel") && !facts.permissions.manageChannels) {
    push({ code: "missingManageChannels", blocking: true });
  }
  if (types.some(({ type }) => type.mode === "thread") && !facts.permissions.manageThreads) {
    push({ code: "missingManageThreads", blocking: true });
  }
  if (!facts.permissions.manageWebhooks) push({ code: "missingManageWebhooks", blocking: false });
  if (facts.panels.length === 0) {
    push({ code: "noPanels", blocking: true });
    return issues;
  }

  const anyUp = facts.panels.some(panelIsUp);
  if (!anyUp) push({ code: "noPanelsPosted", blocking: true });

  for (const panel of facts.panels) {
    const where = { panelId: panel.id };
    if (panel.liveChannelId) push({ code: "panelMoved", blocking: false, ...where, channelId: panel.liveChannelId });
    if (panel.channelId === null || !panel.channelExists) {
      // A panel still up where it used to be keeps opening tickets, so a lost channel only blocks one that is down.
      push({ code: "panelChannelMissing", blocking: !panel.liveChannelId, ...where, ...(panel.channelId ? { channelId: panel.channelId } : {}) });
    } else if (panel.legacy === true && !panel.posted) {
      push({ code: "panelLegacy", blocking: false, ...where, channelId: panel.channelId });
    } else if (panel.posted && panel.messageMissing === true) {
      push({ code: "panelMessageMissing", blocking: !anyUp, ...where, channelId: panel.channelId });
    } else if (!panel.posted && !panel.liveChannelId && anyUp) {
      push({ code: "panelNotPosted", blocking: false, ...where, channelId: panel.channelId });
    } else if (panel.posted && panel.changed === true) {
      push({ code: "panelChanged", blocking: false, ...where, channelId: panel.channelId });
    }
  }

  for (const { panel, type } of types) {
    const where = { panelId: panel.id, typeId: type.id };
    if (type.handlerCount === 0) push({ code: "typeNoHandlers", blocking: false, ...where });
    if (type.emojiMissing === true) push({ code: "typeEmojiMissing", blocking: false, ...where });
    if (type.mode !== "channel") continue;
    if (type.categoryId === null) {
      push({ code: "categoryNotSet", blocking: true, ...where });
    } else if (!type.categoryExists) {
      push({ code: "categoryMissing", blocking: true, ...where, channelId: type.categoryId });
    } else if (type.categoryChildren >= CATEGORY_CHANNEL_LIMIT) {
      const overflowHasRoom =
        !!type.overflowCategoryId && type.overflowExists === true && (type.overflowChildren ?? 0) < CATEGORY_CHANNEL_LIMIT;
      push({ code: "categoryFull", blocking: !overflowHasRoom, ...where, channelId: type.categoryId });
    }
  }
  return issues;
}

/**
 * Counts the issues once, for every place that shows them, and works out which
 * types they stop. A blocking issue about the whole server stops every type it
 * applies to (Manage Channels only matters to channel types), one about a panel
 * stops that panel's types, and one about a type stops that type.
 */
export function ticketHealthSummary(facts: TicketHealthFacts, issues: readonly TicketHealthIssue[] = ticketHealth(facts)): TicketHealthSummary {
  const blockingIssues = issues.filter((issue) => issue.blocking);
  const types = facts.panels.flatMap((panel) => panel.types.map((type) => ({ panel, type })));
  const blockedTypes: TicketHealthSummary["blockedTypes"] = [];
  for (const { panel, type } of types) {
    const codes = blockingIssues
      .filter((issue) => {
        if (issue.typeId !== undefined) return issue.typeId === type.id && issue.panelId === panel.id;
        if (issue.panelId !== undefined) return issue.panelId === panel.id;
        if (issue.code === "missingManageChannels") return type.mode === "channel";
        if (issue.code === "missingManageThreads") return type.mode === "thread";
        return true;
      })
      .map((issue) => issue.code);
    if (codes.length > 0) blockedTypes.push({ panelId: panel.id, typeId: type.id, codes: [...new Set(codes)] });
  }
  const afterFirstRun = issues.filter((issue) => issue.firstRun !== true);
  const blocking = blockingIssues.length;
  const noneOpen = facts.panels.length === 0 || (types.length > 0 && blockedTypes.length === types.length);
  return {
    state: noneOpen ? "allBlocked" : blockedTypes.length > 0 ? "someBlocked" : issues.length > 0 ? "warnings" : "ok",
    blocking,
    warnings: issues.length - blocking,
    blockingAfterFirstRun: afterFirstRun.filter((issue) => issue.blocking).length,
    warningsAfterFirstRun: afterFirstRun.filter((issue) => !issue.blocking).length,
    totalTypes: types.length,
    blockedTypes,
  };
}

/** `GET context`: what the workspace needs before it draws anything. */
export interface TicketContextDto {
  /** The Tickets feature is switched on in this server. */
  moduleEnabled: boolean;
  viewer: { userId: string; name: string };
  level: TicketAccessLevel;
  handledTypeIds: string[];
  /** Workspace-wide permissions, from `ticketPermissions(access)`. */
  permissions: TicketPermission[];
  panels: TicketPanelOption[];
  priorities: readonly TicketPriority[];
  /** The bot can post dashboard replies under the staff member's name. */
  canUseWebhooks: boolean;
  health: TicketHealthIssue[];
  /** The dashboard's address is known, so the bot's posts can link back to it. */
  dashboardUrlKnown: boolean;
  /** What closing a ticket does to its channel. Missing from an older bot. */
  closeBehaviour?: "delete" | "archive";
  /** `health` counted once, with the types it stops. Missing from an older bot. */
  healthSummary?: TicketHealthSummary;
  /** The server's saved replies, for the composer to insert. Missing from an older bot. */
  savedReplies?: TicketSavedReplyDto[];
  /** What a dashboard reply may attach. Missing from an older bot, which takes no files. */
  replyFiles?: { maxFiles: number; maxBytes: number };
}

/** A saved reply as the composer offers it. `content` still holds its variables; the bot fills them in when it is sent. */
export interface TicketSavedReplyDto {
  name: string;
  content: string;
}

export interface TicketStatsGroup {
  opened: number;
  closed: number;
  /** Median over tickets opened in the period that got a staff reply. Null when none did. */
  medianFirstResponseMs: number | null;
  /** Median over tickets closed in the period. */
  medianResolutionMs: number | null;
  averageRating: number | null;
  ratingCount: number;
}

/** `GET stats?days=`. Hours are UTC. */
export interface TicketStatsDto extends TicketStatsGroup {
  days: number;
  since: string;
  openNow: number;
  /** How many ratings of 1 to 5 in the period, index 0 being 1. */
  ratingDistribution: [number, number, number, number, number];
  /** One entry per day, oldest first, zeros included. */
  perDay: { date: string; opened: number; closed: number }[];
  /** `listQuery` is the ticket list's query string for that type's tickets, all statuses, to link a row to its tickets. */
  byType: (TicketStatsGroup & { typeId: string | null; typeName: string; openNow: number; listQuery?: string })[];
  /** Busiest first. */
  byHandler: TicketHandlerStats[];
  /** Tickets opened in each hour of the day, 0 to 23. */
  byHour: number[];
}

/**
 * One handler's work in the period. The response and rating fields are
 * missing from an older bot.
 */
export interface TicketHandlerStats {
  user: UserRef;
  claims: number;
  closes: number;
  /** Tickets opened in the period they answered first. */
  firstResponses?: number;
  /** Median wait of the opener for those first answers. */
  medianFirstResponseMs?: number | null;
  /** Ratings of tickets they had claimed. */
  averageRating?: number | null;
  ratingCount?: number;
  /** The ticket list's query string for tickets they claimed, closed or answered first, all statuses. */
  listQuery?: string;
}

/** The median of some durations, or null for none. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/** `GET panels/status`, one per configured panel. */
export interface TicketPanelStatusDto {
  panelId: string;
  name: string;
  channelId: string | null;
  channelExists: boolean;
  posted: boolean;
  /**
   * The panel a server had before panels were recorded. It was most likely
   * posted by the older version, which kept no note of where, so it reads as
   * neither posted nor missing: posting it now puts up a new message, and the
   * old one has to be deleted by hand.
   */
  legacy: boolean;
  messageId: string | null;
  /** A link to the posted message in Discord. */
  messageUrl: string | null;
  postedAt: string | null;
  /** The one word for the strip, from the fields below. Missing from an older bot. */
  state?: TicketPanelState;
  /**
   * Whether Discord still has the posted message, as last checked. Null when it
   * was not checked, because nothing was posted or Discord did not answer in time.
   */
  messageExists?: boolean | null;
  /** The settings changed since it was posted, so pressing Update would change the message. */
  changed?: boolean;
  /** The posted message is up in this channel, which is not the one the settings now name. Posting moves it there. */
  liveChannelId?: string | null;
  /** When Discord was last asked. */
  checkedAt?: string | null;
}

/**
 * `posted`: up where the settings say and as they say. `changed`: up, but the
 * settings changed since. `moved`: up in the channel it used to be in.
 * `messageDeleted`: recorded, but deleted in Discord. `legacy`: posted by the
 * version before panels were tracked. `notPosted`: never posted.
 * `noChannel`: no channel set, or it was deleted.
 */
export type TicketPanelState = "posted" | "changed" | "moved" | "messageDeleted" | "legacy" | "notPosted" | "noChannel";

// -- list filters -----------------------------------------------------------

export type TicketStatusFilter = TicketStatus | "all";
export type TicketClaimFilter = "anyone" | "me" | "unclaimed";
export type TicketSort = "newest" | "oldest" | "activity";

/** `GET tickets`. The inbox uses the first block; the transcript archive adds the second. */
export interface TicketListFilters {
  status: TicketStatusFilter;
  /** Empty means every type the viewer handles. */
  typeIds: string[];
  priority: TicketPriority | null;
  claimed: TicketClaimFilter;
  openerId: string | null;
  /** Matched against the subject, the opener's name and the stored message text. */
  q: string;
  sort: TicketSort;
  page: number;

  rating: number | null;
  /** Who claimed it, closed it or answered it first. */
  handlerId: string | null;
  /** Dates as YYYY-MM-DD, inclusive, matched against when the ticket opened. */
  from: string | null;
  to: string | null;
  /**
   * Only tickets opened after the one with this internal id, for a list that
   * asks what is new since it was drawn. Query key `after`.
   */
  afterId?: number | null;
}

export const DEFAULT_TICKET_FILTERS: Readonly<TicketListFilters> = {
  status: "open",
  typeIds: [],
  priority: null,
  claimed: "anyone",
  openerId: null,
  q: "",
  sort: "activity",
  page: 1,
  rating: null,
  handlerId: null,
  from: null,
  to: null,
  afterId: null,
};

/**
 * `GET count`, with the same filters as the list: a cheap read a list can poll
 * to learn whether it is out of date, without loading a page.
 */
export interface TicketCountDto {
  /** Tickets matching the filters, `after` left out. */
  total: number;
  /** Of those, how many were opened after the `after` ticket. Equal to `total` without `after`. */
  newCount: number;
  /** The highest internal id among them, to pass as `after` next time. Null when there are none. */
  latestId: number | null;
  /** The latest `lastActivityAt` among them, so a list sorted by activity can tell that it moved. */
  latestActivityAt: string | null;
  /** Of those, how many are open with the opener's message last. */
  awaitingStaff: number;
}

const SNOWFLAKE = /^\d{17,20}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROW_ID = /^[A-Za-z0-9_-]{1,32}$/;
const QUERY_MAX = 200;

type QueryLike = URLSearchParams | Record<string, string | string[] | undefined>;

function queryValues(query: QueryLike, key: string): string[] {
  if (query instanceof URLSearchParams) return query.getAll(key);
  const value = query[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Reads the filters from a query string. Anything unknown or malformed falls
 * back to the default rather than failing, so an old bookmarked address still
 * opens. `type` may repeat or hold a comma-separated list.
 */
export function parseTicketListFilters(query: QueryLike): TicketListFilters {
  const one = (key: string) => queryValues(query, key)[0]?.trim() ?? "";
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = one(key);
    return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  };
  const typeIds = [
    ...new Set(
      queryValues(query, "type")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim()),
    ),
  ].filter((value) => ROW_ID.test(value));
  const page = Number(one("page"));
  const rating = Number(one("rating"));
  const date = (key: string) => {
    const value = one(key);
    return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
  };
  const snowflake = (key: string) => (SNOWFLAKE.test(one(key)) ? one(key) : null);
  const priority = one("priority");
  const after = /^\d{1,9}$/.test(one("after")) ? Number(one("after")) : null;

  return {
    status: pick("status", ["open", "closed", "all"] as const, DEFAULT_TICKET_FILTERS.status),
    typeIds,
    priority: isTicketPriority(priority) ? priority : null,
    claimed: pick("claimed", ["anyone", "me", "unclaimed"] as const, DEFAULT_TICKET_FILTERS.claimed),
    openerId: snowflake("opener"),
    q: one("q").slice(0, QUERY_MAX),
    sort: pick("sort", ["newest", "oldest", "activity"] as const, DEFAULT_TICKET_FILTERS.sort),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    handlerId: snowflake("handler"),
    from: date("from"),
    to: date("to"),
    afterId: after !== null && after > 0 ? after : null,
  };
}

/** The query string for some filters, leaving out whatever is at its default. No leading `?`. */
export function ticketListQuery(filters: Partial<TicketListFilters>): string {
  const params = new URLSearchParams();
  const full = { ...DEFAULT_TICKET_FILTERS, ...filters };
  if (full.status !== DEFAULT_TICKET_FILTERS.status) params.set("status", full.status);
  if (full.typeIds.length > 0) params.set("type", full.typeIds.join(","));
  if (full.priority) params.set("priority", full.priority);
  if (full.claimed !== DEFAULT_TICKET_FILTERS.claimed) params.set("claimed", full.claimed);
  if (full.openerId) params.set("opener", full.openerId);
  if (full.q.trim() !== "") params.set("q", full.q.trim());
  if (full.sort !== DEFAULT_TICKET_FILTERS.sort) params.set("sort", full.sort);
  if (full.page > 1) params.set("page", String(full.page));
  if (full.rating) params.set("rating", String(full.rating));
  if (full.handlerId) params.set("handler", full.handlerId);
  if (full.from) params.set("from", full.from);
  if (full.to) params.set("to", full.to);
  if (full.afterId) params.set("after", String(full.afterId));
  return params.toString();
}

export interface TicketPage {
  items: TicketSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
}

// -- writes -----------------------------------------------------------------

/** Who is acting. The dashboard's proxy fills this in from the session and replaces whatever the browser sent. */
export interface TicketActor {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

/** Every write body, as the bot receives it. */
export type TicketWrite<T> = T & { actor: TicketActor };

export interface TicketReplyRequest {
  /** May be empty when files are attached. */
  content: string;
  /** Files to attach, at most TICKET_REPLY_FILES_MAX adding up to TICKET_REPLY_FILES_BYTES_MAX. */
  files?: TicketReplyFile[];
}

/** A file sent with a dashboard reply. `data` is the file as base64, without a `data:` prefix. */
export interface TicketReplyFile {
  name: string;
  contentType: string | null;
  data: string;
}

export interface TicketReplyResult {
  message: TicketMessageDto;
  /** `webhook` when it went out under the staff member's name, `bot` when the bot lacked Manage Webhooks. */
  delivery: "webhook" | "bot";
}

export type TicketClaimRequest = Record<string, never>;
export type TicketUnclaimRequest = Record<string, never>;

export interface TicketPriorityRequest {
  priority: TicketPriority;
}

export interface TicketNoteRequest {
  body: string;
}

export interface TicketMembersRequest {
  action: "add" | "remove";
  /** Empty when adding by `name`. */
  userId: string;
  /** Adding only: a member's name, matched against display names and usernames in the server. */
  name?: string;
}

export interface TicketRenameRequest {
  name: string;
}

export interface TicketRequestCloseRequest {
  reason: string | null;
}

export interface TicketTransferRequest {
  typeId: string;
}

export interface TicketCloseRequest {
  reason: string | null;
}

export type TicketReopenRequest = Record<string, never>;
export type TicketDeleteTranscriptRequest = Record<string, never>;
export type TicketPanelPostRequest = Record<string, never>;

/** What every ticket write but a reply returns. */
export interface TicketActionResult {
  ticket: TicketDetailDto;
  /** Plain-language side notes, such as a direct message that could not be delivered. */
  notes: string[];
}

/** What `DELETE items/:id/transcript` returns: how many stored messages went. The ticket itself is unchanged. */
export interface TicketTranscriptDeleteResult {
  deleted: number;
}

export interface TicketPanelPostResult {
  panelId: string;
  channelId: string;
  messageId: string;
  /** The existing message was edited in place rather than a new one posted. */
  updated: boolean;
  /** This was the first post of a panel an older version had posted, whose old message is still up somewhere and should be deleted. */
  legacyMessageLeft: boolean;
  /** The channel the panel was taken down from, because it moved. Null when it did not move. Missing from an older bot. */
  movedFrom?: string | null;
}

/** A refusal. `code` lets the dashboard tell a missing permission from a missing ticket. */
export interface TicketError {
  error: string;
  code?: "forbidden" | "notFound" | "invalid" | "rateLimited" | "conflict" | "unavailable";
}

export type TicketRead<T> = { ok: true; value: T } | { ok: false; error: string };

const lines = (value: string) => value.replace(/\r\n?/g, "\n").trim();

/**
 * A reply as it will be sent: line endings made plain and the ends trimmed.
 * Refuses an empty reply and one over Discord's limit. Mentions are left in
 * the text; the bot limits what a reply can ping when it sends it.
 */
export function readTicketReply(input: unknown): TicketRead<TicketReplyRequest> {
  const content = isRecord(input) && typeof input.content === "string" ? lines(input.content) : "";
  const files = readTicketReplyFiles(isRecord(input) ? input.files : undefined);
  if (!files.ok) return files;
  if (content === "" && files.value.length === 0) return { ok: false, error: "Write a reply before sending it." };
  if (content.length > TICKET_REPLY_MAX) {
    return { ok: false, error: `A reply can be at most ${TICKET_REPLY_MAX} characters. This one is ${content.length}.` };
  }
  return { ok: true, value: files.value.length > 0 ? { content, files: files.value } : { content } };
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const FILE_NAME_MAX = 100;

/** The bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/**
 * A file name Discord and every system will take: no folders, no characters
 * Windows refuses, nothing invisible, and not empty.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((char) => char.charCodeAt(0) >= 32)
    .join("")
    .replace(/[:*?"<>|]+/g, "-")
    .trim()
    .replace(/^\.+/, "");
  return (cleaned || "file").slice(-FILE_NAME_MAX);
}

/** The files of a dashboard reply, refused when there are too many or they are too big for Discord. */
export function readTicketReplyFiles(input: unknown): TicketRead<TicketReplyFile[]> {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: "The attached files could not be read. Attach them again." };
  if (input.length > TICKET_REPLY_FILES_MAX) {
    return { ok: false, error: `A reply can carry at most ${TICKET_REPLY_FILES_MAX} files. Remove ${input.length - TICKET_REPLY_FILES_MAX} and send again.` };
  }
  const files: TicketReplyFile[] = [];
  let total = 0;
  for (const entry of input) {
    if (!isRecord(entry) || typeof entry.data !== "string" || typeof entry.name !== "string" || !BASE64.test(entry.data) || entry.data.length % 4 !== 0) {
      return { ok: false, error: "One of the attached files could not be read. Attach it again." };
    }
    const bytes = base64Bytes(entry.data);
    if (bytes === 0) return { ok: false, error: `${safeFileName(entry.name)} is empty. Discord does not take empty files.` };
    total += bytes;
    const contentType = typeof entry.contentType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(entry.contentType) ? entry.contentType : null;
    files.push({ name: safeFileName(entry.name), contentType, data: entry.data });
  }
  if (total > TICKET_REPLY_FILES_BYTES_MAX) {
    return { ok: false, error: `The files add up to more than ${TICKET_REPLY_FILES_BYTES_MAX / 1024 / 1024} MB, the most one reply can carry. Send some in another reply.` };
  }
  return { ok: true, value: files };
}

/** `POST items/:id/rename`. The name goes through the same rules as a channel name pattern in the bot. */
export function readTicketRename(input: unknown): TicketRead<TicketRenameRequest> {
  const name = isRecord(input) && typeof input.name === "string" ? input.name.trim() : "";
  if (name === "") return { ok: false, error: "Write the new name first." };
  if (name.length > TICKET_RENAME_MAX) return { ok: false, error: `A name can be at most ${TICKET_RENAME_MAX} characters.` };
  return { ok: true, value: { name } };
}

/** `POST items/:id/request-close`. */
export function readTicketRequestClose(input: unknown): TicketRead<TicketRequestCloseRequest> {
  const read = readTicketClose(input);
  return read.ok ? { ok: true, value: { reason: read.value.reason } } : read;
}

/**
 * What a saved reply can fill in. Discord's `/ticket reply` and the
 * dashboard's composer fill the same ones, so a reply reads the same from both.
 */
export const SAVED_REPLY_VARIABLES = ["user", "staff", "number", "type", "ticket"] as const;

export function savedReplyValues(
  ticket: { number?: number | null; id: number; typeName: string; openerId: string; channelId: string },
  staffId: string,
): Record<(typeof SAVED_REPLY_VARIABLES)[number], string> {
  return {
    user: `<@${ticket.openerId}>`,
    staff: `<@${staffId}>`,
    number: String(ticket.number ?? ticket.id),
    type: ticket.typeName,
    ticket: `<#${ticket.channelId}>`,
  };
}

/** A saved reply with its variables filled in. A name it does not know is left as written. */
export function fillSavedReply(content: string, values: Readonly<Record<string, string>>): string {
  return content.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? (values[name] ?? whole) : whole));
}

export function readTicketNote(input: unknown): TicketRead<TicketNoteRequest> {
  const body = isRecord(input) && typeof input.body === "string" ? lines(input.body) : "";
  if (body === "") return { ok: false, error: "Write the note before saving it." };
  if (body.length > TICKET_NOTE_MAX) return { ok: false, error: `A note can be at most ${TICKET_NOTE_MAX} characters.` };
  return { ok: true, value: { body } };
}

export function readTicketPriority(input: unknown): TicketRead<TicketPriorityRequest> {
  const priority = isRecord(input) ? input.priority : undefined;
  return isTicketPriority(priority)
    ? { ok: true, value: { priority } }
    : { ok: false, error: "Pick a priority: low, normal, high or urgent." };
}

export function readTicketMembers(input: unknown): TicketRead<TicketMembersRequest> {
  const action = isRecord(input) ? input.action : undefined;
  const userId = isRecord(input) && typeof input.userId === "string" ? input.userId.trim() : "";
  const name = isRecord(input) && typeof input.name === "string" ? input.name.trim().replace(/^@/, "") : "";
  if (action !== "add" && action !== "remove") return { ok: false, error: "Say whether to add or remove the member." };
  if (action === "add" && userId === "" && name !== "") {
    if (name.length > 100) return { ok: false, error: "That name is too long to be a member's name." };
    return { ok: true, value: { action, userId: "", name } };
  }
  if (!SNOWFLAKE.test(userId)) return { ok: false, error: "That is not a valid Discord member." };
  return { ok: true, value: { action, userId } };
}

export function readTicketTransfer(input: unknown): TicketRead<TicketTransferRequest> {
  const typeId = isRecord(input) && typeof input.typeId === "string" ? input.typeId : "";
  return ROW_ID.test(typeId) ? { ok: true, value: { typeId } } : { ok: false, error: "Pick the ticket type to move it to." };
}

export function readTicketClose(input: unknown): TicketRead<TicketCloseRequest> {
  const reason = isRecord(input) && typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > TICKET_CLOSE_REASON_MAX) {
    return { ok: false, error: `A reason can be at most ${TICKET_CLOSE_REASON_MAX} characters.` };
  }
  return { ok: true, value: { reason: reason === "" ? null : reason } };
}
