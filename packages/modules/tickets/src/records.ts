import type { MessageEmbed } from "@tier0/core";
import type { TicketAttachmentDto, TicketMentionName, TicketTranscriptRemoval } from "@tier0/shared-tickets";
import { colorToInt } from "@tier0/core";
import { CATEGORY_CHANNEL_LIMIT, ticketStaffLine } from "@tier0/shared-tickets";

/**
 * The parts of keeping a ticket that need no Discord connection: what a stored
 * message holds, which category a new channel goes in, and when the people in
 * a ticket count as answered. Free of discord.js so it can be tested with plain
 * objects.
 */

/** Discord ids are snowflakes; anything else, such as "auto-close", is not a member. */
export const isSnowflake = (id: string): boolean => /^\d{17,20}$/.test(id);

/** The number people see. A row made outside the open path has none and shows its id. */
export const ticketNumber = (ticket: { id: number; number?: number | null }): number => ticket.number ?? ticket.id;

/**
 * Text a member typed, made safe to put in a message that may ping: mentions
 * stay readable but no longer ping anyone. Used where the bot cannot pass a
 * mention allowlist, such as the public answer to a button.
 */
export function withoutPings(text: string): string {
  return text.replace(/<@/g, "<@​").replace(/@(everyone|here)/g, "@​$1");
}

export interface AttachmentLike {
  name: string | null;
  url: string;
  contentType?: string | null;
  size?: number;
}

export interface EmbedLike {
  type?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  color?: number | null;
  author?: { name?: string | null; url?: string | null; iconURL?: string | null } | null;
  provider?: { name?: string | null; url?: string | null } | null;
  fields?: readonly { name?: string | null; value?: string | null; inline?: boolean | null }[] | null;
  thumbnail?: { url?: string | null } | null;
  image?: { url?: string | null } | null;
  footer?: { text?: string | null; iconURL?: string | null } | null;
  timestamp?: string | null;
}

/** What `TicketMessage.attachments` stores: a link to each file, since the files stay on Discord. */
export function attachmentsJson(attachments: Iterable<AttachmentLike>): string {
  const list: TicketAttachmentDto[] = [...attachments].map((attachment) => ({
    name: attachment.name || "file",
    url: attachment.url,
    contentType: attachment.contentType ?? null,
    size: attachment.size ?? 0,
  }));
  return JSON.stringify(list);
}

/** What `TicketMessage.embeds` stores: each embed whole, so the transcript can draw it as Discord did. */
export function embedsJson(embeds: Iterable<EmbedLike>): string {
  const list = [...embeds]
    .map((embed) => ({
      type: embed.type ?? "rich",
      title: embed.title ?? "",
      description: embed.description ?? "",
      url: embed.url ?? null,
      color: embed.color ?? null,
      author: embed.author?.name ? { name: embed.author.name, url: embed.author.url ?? null, iconUrl: embed.author.iconURL ?? null } : null,
      provider: embed.provider?.name ? { name: embed.provider.name, url: embed.provider.url ?? null } : null,
      fields: (embed.fields ?? []).map((field) => ({ name: field.name ?? "", value: field.value ?? "", inline: field.inline === true })),
      thumbnailUrl: embed.thumbnail?.url ?? null,
      imageUrl: embed.image?.url ?? null,
      footer: embed.footer?.text ? { text: embed.footer.text, iconUrl: embed.footer.iconURL ?? null } : null,
      timestamp: embed.timestamp ?? null,
    }))
    .filter(
      (embed) =>
        embed.title !== "" ||
        embed.description !== "" ||
        embed.fields.length > 0 ||
        embed.author !== null ||
        embed.footer !== null ||
        embed.imageUrl !== null ||
        embed.thumbnailUrl !== null,
    );
  return JSON.stringify(list);
}

export interface EmojiLike {
  id?: string | null;
  name?: string | null;
  animated?: boolean | null;
}

/** A component as discord.js gives it from `toJSON()`, in Discord's API shape. */
export interface ComponentLike {
  type: number;
  style?: number;
  label?: string | null;
  emoji?: EmojiLike | null;
  url?: string | null;
  disabled?: boolean;
  placeholder?: string | null;
  components?: readonly ComponentLike[];
}

const BUTTON = 2;
const SELECT_MENUS = new Set([3, 5, 6, 7, 8]);
const ACTION_ROW = 1;

const emojiOf = (emoji: EmojiLike | null | undefined) =>
  emoji && (emoji.id || emoji.name) ? { id: emoji.id ?? null, name: emoji.name ?? "", animated: emoji.animated === true } : null;

/** What `TicketMessage.components` stores: rows of buttons and menus. The newer layout components are not drawn and not kept. */
export function componentsJson(rows: Iterable<ComponentLike>): string {
  const out = [];
  for (const row of rows) {
    if (row.type !== ACTION_ROW) continue;
    const components = [];
    for (const item of row.components ?? []) {
      if (item.type === BUTTON) {
        components.push({ kind: "button", style: item.style ?? 2, label: item.label ?? "", emoji: emojiOf(item.emoji), url: item.url ?? null, disabled: item.disabled === true });
      } else if (SELECT_MENUS.has(item.type)) {
        components.push({ kind: "select", placeholder: item.placeholder ?? "", disabled: item.disabled === true });
      }
    }
    if (components.length > 0) out.push({ components });
  }
  return JSON.stringify(out);
}

export function stickersJson(stickers: Iterable<{ id: string; name: string; format: number }>): string {
  return JSON.stringify([...stickers].map((sticker) => ({ id: sticker.id, name: sticker.name, format: sticker.format })));
}

export function reactionsJson(reactions: Iterable<{ emoji: EmojiLike; count: number | null }>): string {
  const out = [];
  for (const reaction of reactions) {
    const emoji = emojiOf(reaction.emoji);
    if (emoji && reaction.count) out.push({ emoji, count: reaction.count });
  }
  return JSON.stringify(out);
}

/** Looks up what a mention reads as. Each returns undefined for an id the bot cannot see. */
export interface MentionLookup {
  user(id: string): TicketMentionName | undefined;
  role(id: string): TicketMentionName | undefined;
  channel(id: string): TicketMentionName | undefined;
}

const MENTION_IDS = /<(@!?|@&|#)(\d{17,20})>/g;
const MAX_MENTIONS = 50;

/**
 * The names behind every id mentioned in some text, as they read today, so
 * the transcript still shows them after a member leaves or a role is renamed.
 */
export function mentionsJson(texts: Iterable<string>, lookup: MentionLookup): string {
  const out: { users: Record<string, TicketMentionName>; roles: Record<string, TicketMentionName>; channels: Record<string, TicketMentionName> } = {
    users: {},
    roles: {},
    channels: {},
  };
  let count = 0;
  for (const text of texts) {
    for (const match of text.matchAll(MENTION_IDS)) {
      if (count >= MAX_MENTIONS) break;
      const [, kind, id] = match;
      const table = kind === "@&" ? out.roles : kind === "#" ? out.channels : out.users;
      if (id === undefined || table[id]) continue;
      const found = kind === "@&" ? lookup.role(id) : kind === "#" ? lookup.channel(id) : lookup.user(id);
      if (!found) continue;
      table[id] = found.color ? { name: found.name, color: found.color } : { name: found.name };
      count++;
    }
  }
  return JSON.stringify(out);
}

export interface CategoryFacts {
  id: string;
  exists: boolean;
  /** Channels in it now. */
  children: number;
}

export type CategoryChoice =
  | { ok: true; id: string }
  | { ok: false; code: "noCategory" | "categoryGone" | "categoryFull" };

/**
 * Where a new ticket channel goes: the type's category while it has room, then
 * its overflow category. A category that was deleted is only reported when
 * there is nowhere else to go, so a full primary with a working overflow still
 * opens tickets.
 */
export function chooseCategory(primary: CategoryFacts | null, overflow: CategoryFacts | null): CategoryChoice {
  const roomIn = (category: CategoryFacts | null) => category !== null && category.exists && category.children < CATEGORY_CHANNEL_LIMIT;
  if (roomIn(primary)) return { ok: true, id: primary!.id };
  if (roomIn(overflow)) return { ok: true, id: overflow!.id };
  if (primary === null) return { ok: false, code: "noCategory" };
  if (!primary.exists) return { ok: false, code: "categoryGone" };
  return { ok: false, code: "categoryFull" };
}

/**
 * Whether a message answers the opener: it was written by a person who is not
 * the opener. The first one sets `firstResponseAt`, which the stats measure.
 */
export function isResponse(author: { id: string; bot: boolean }, openerId: string): boolean {
  return !author.bot && author.id !== openerId;
}

/** A Discord timestamp that every reader sees in their own time zone, as "in 2 hours". */
export function relativeTime(at: Date): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:R>`;
}

/** A length of time as a reader would say it: "45 minutes", "3 hours", "2 days". */
export function spokenDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return unit(hours, "hour");
  return unit(Math.round(hours / 24), "day");
}

/** The ids a reply in a ticket may ping: the people in it and its staff roles, never everyone. */
export function replyMentions(people: readonly string[], roles: readonly string[]): { parse: []; users: string[]; roles: string[] } {
  return { parse: [], users: [...new Set(people)].slice(0, 100), roles: [...new Set(roles)].slice(0, 100) };
}

/**
 * Cuts a reply into messages of at most `room` characters, at a line break or
 * a space near the end of the first where there is one, so nothing is cut off.
 * `tail` is a closing line that goes after the text, on the last message, or
 * on one of its own when it would not fit.
 */
export function splitReply(content: string, room: number, tail: string | null = null): string[] {
  let parts: string[];
  if (content.length <= room) {
    parts = [content];
  } else {
    const window = content.slice(0, room);
    const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const cut = breakAt > room - 200 ? breakAt : room;
    parts = [content.slice(0, cut), content.slice(cut).replace(/^[ \n]/, "")].filter((part) => part !== "");
  }
  if (tail === null) return parts;
  const last = parts[parts.length - 1] ?? "";
  const joined = last === "" ? tail : `${last}\n${tail}`;
  if (joined.length <= room) return [...parts.slice(0, -1), joined];
  return [...parts, tail];
}

/**
 * A dashboard reply sent as the bot because it could not use a webhook: the
 * name in bold on the first line. A reply that no longer fits Discord's limit
 * with the name on top goes out as two messages, split by `splitReply`. Each
 * part is what that message says after the name.
 */
export function attributedReply(name: string, content: string, max = 2000, tail: string | null = null): { head: string; parts: string[] } {
  const head = `**${name.replace(/[*_~`|]/g, "").slice(0, 80)}**\n`;
  return { head, parts: splitReply(content, max - head.length, tail) };
}

export interface ReplySettings {
  identity?: string;
  teamName?: string;
  teamAvatar?: string;
  showStaffName?: boolean;
  /** The wording of the line, with {name} for who sent it and {user} for a mention of them. */
  staffLine?: string;
}

export interface ReplyIdentity {
  name: string;
  avatarUrl: string | null;
  /** Sent under the team's name rather than the staff member's. */
  team: boolean;
  /** The line the reply ends with naming who sent it, or null. */
  staffLine: string | null;
}

export const DEFAULT_TEAM_NAME = "Support Team";

/**
 * Who a dashboard reply is sent as. The team's picture falls back to the bot's
 * when none is set, and the line naming the sender is only ever added to a
 * team reply, since a staff member's own name is already on top.
 */
export function replyIdentity(
  replies: ReplySettings | undefined,
  actor: { name: string; avatarUrl: string | null; userId?: string },
  botAvatar: string | null,
): ReplyIdentity {
  if (replies?.identity !== "team") return { name: actor.name.slice(0, 80) || "Staff", avatarUrl: actor.avatarUrl, team: false, staffLine: null };
  return {
    name: replies.teamName?.trim().slice(0, 80) || DEFAULT_TEAM_NAME,
    avatarUrl: replies.teamAvatar?.trim() || botAvatar,
    team: true,
    staffLine: replies.showStaffName === true ? ticketStaffLine(actor.name, replies.staffLine, actor.userId) : null,
  };
}

/** An embed of a reply as Discord's API takes it. A time of "now" becomes the moment of sending. */
export interface ReplyEmbedPayload {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  timestamp?: string;
  author?: { name: string; url?: string; icon_url?: string };
  footer?: { text: string; icon_url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  fields?: { name: string; value: string; inline: boolean }[];
}

export function replyEmbedPayloads(embeds: readonly MessageEmbed[], now = new Date()): ReplyEmbedPayload[] {
  return embeds.map((embed) => {
    const color = colorToInt(embed.color);
    const stamp = embed.timestamp === "now" ? now.toISOString() : embed.timestamp;
    return {
      ...(embed.title ? { title: embed.title } : {}),
      ...(embed.url ? { url: embed.url } : {}),
      ...(embed.description ? { description: embed.description } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(stamp ? { timestamp: new Date(stamp).toISOString() } : {}),
      ...(embed.authorName
        ? { author: { name: embed.authorName, ...(embed.authorUrl ? { url: embed.authorUrl } : {}), ...(embed.authorIconUrl ? { icon_url: embed.authorIconUrl } : {}) } }
        : {}),
      ...(embed.footerText ? { footer: { text: embed.footerText, ...(embed.footerIconUrl ? { icon_url: embed.footerIconUrl } : {}) } } : {}),
      ...(embed.imageUrl ? { image: { url: embed.imageUrl } } : {}),
      ...(embed.thumbnailUrl ? { thumbnail: { url: embed.thumbnailUrl } } : {}),
      ...(embed.fields.length > 0 ? { fields: embed.fields.map((field) => ({ name: field.name, value: field.value, inline: field.inline })) } : {}),
    };
  });
}

/** What `TicketMessage.embeds` stores for the embeds of a reply, in the shape the transcript reads. */
export function replyEmbedsJson(embeds: readonly MessageEmbed[], now = new Date()): string {
  return embedsJson(
    replyEmbedPayloads(embeds, now).map((embed) => ({
      type: "rich",
      title: embed.title ?? null,
      description: embed.description ?? null,
      url: embed.url ?? null,
      color: embed.color ?? null,
      author: embed.author ? { name: embed.author.name, url: embed.author.url ?? null, iconURL: embed.author.icon_url ?? null } : null,
      fields: embed.fields ?? [],
      thumbnail: embed.thumbnail ?? null,
      image: embed.image ?? null,
      footer: embed.footer ? { text: embed.footer.text, iconURL: embed.footer.icon_url ?? null } : null,
      timestamp: embed.timestamp ?? null,
    })),
  );
}

/** A channel name typed by staff, through the same rules as a pattern. */
export const RENAME_MAX = 90;

export interface RemovalFacts {
  status: string;
  closedAt: Date | null;
  messageCount: number;
  transcriptDeletedAt: Date | null;
  transcriptDeletedById: string | null;
  transcriptDeletedByName: string | null;
  messagesPrunedAt: Date | null;
}

/**
 * Why a ticket's stored messages are gone, or null when they are not. A
 * manager's delete is recorded with who and when. Retention is recorded when
 * it runs; a ticket pruned before that was recorded is recognised by having
 * had messages and being closed for longer than the period.
 */
export function transcriptRemovalOf(
  row: RemovalFacts,
  stored: number,
  transcripts: { store: boolean; retentionDays: number } | undefined,
  now = Date.now(),
): TicketTranscriptRemoval | null {
  if (row.transcriptDeletedAt) {
    return {
      kind: "deleted",
      at: row.transcriptDeletedAt.toISOString(),
      by: row.transcriptDeletedById ? { userId: row.transcriptDeletedById, name: row.transcriptDeletedByName ?? row.transcriptDeletedById } : null,
    };
  }
  if (row.messagesPrunedAt) return { kind: "pruned", at: row.messagesPrunedAt.toISOString() };
  if (stored > 0 || row.messageCount === 0 || !transcripts?.store || transcripts.retentionDays <= 0 || row.status !== "closed" || !row.closedAt) return null;
  return row.closedAt.getTime() + transcripts.retentionDays * 86_400_000 <= now ? { kind: "pruned", at: null } : null;
}

/** Durations shorter than this are taken as this, so a setting of 0 cannot close a ticket the moment it opens. */
export const SHORTEST_WAIT_MS = 60_000;

export const atLeastAMinute = (ms: number): number => (Number.isFinite(ms) && ms > SHORTEST_WAIT_MS ? ms : SHORTEST_WAIT_MS);
