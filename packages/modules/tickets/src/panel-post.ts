import { createHash } from "node:crypto";
import { ChannelType, type Message, type TextChannel } from "discord.js";
import { LEGACY_PANEL_ID, type TicketHealthFacts, type TicketPanelPostResult, type TicketPanelState, type TicketPanelStatusDto } from "@tier0/shared-tickets";
import { prisma, type TicketPanelPost } from "@tier0/db";
import type { TicketCtx } from "./context.js";
import { panelRows } from "./controls.js";
import { PANEL_MESSAGE } from "./messages.js";
import { done, refused, type Outcome } from "./outcome.js";
import type { TicketPanel, TicketType } from "./panels.js";

/**
 * Posting a panel, and editing the one already posted in place, which is what
 * lets an owner change a panel's settings and update the live message. Where
 * each panel was posted is kept in `TicketPanelPost`, with a fingerprint of
 * what was posted so a change to the settings since shows.
 */

const messageUrl = (guildId: string, channelId: string, messageId: string) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/**
 * The record a panel posted by the version before panels were tracked has: a
 * row with no message id, written by the migration only for a server that
 * really used that version. Until it is posted again it can be neither found
 * nor updated, and posting it leaves the old message behind.
 */
const isLegacyPost = (post: Pick<TicketPanelPost, "messageId"> | null | undefined) => !!post && post.messageId === "";

/**
 * The migration only writes that record for databases it ran on in one go with
 * the overhaul, and not for one that applied an earlier edit of it. So a panel
 * with no record at all counts as the old one when the server clearly used it:
 * its tickets carry the default panel, or the stored settings still hold the
 * old `panel.channel`. A panel posted by this version always has a record.
 */
async function usedOldPanel(guildId: string, panelId: string): Promise<boolean> {
  if (panelId !== LEGACY_PANEL_ID) return false;
  if ((await prisma.ticket.count({ where: { guildId, panelId: LEGACY_PANEL_ID } })) > 0) return true;
  const stored = await prisma.guildModule.findUnique({ where: { guildId_moduleId: { guildId, moduleId: "tickets" } } });
  try {
    const panel = (JSON.parse(stored?.settings ?? "{}") as { panel?: { channel?: unknown } }).panel;
    return typeof panel?.channel === "string";
  } catch {
    return false;
  }
}

/** What the panel looks like in Discord, as its settings say. Two posts with the same fingerprint look the same. */
export function panelFingerprint(panel: TicketPanel): string {
  const shown = {
    message: panel.message,
    style: panel.style,
    placeholder: panel.style === "menu" ? panel.placeholder : "",
    types: panel.types.map((type) => [type.id, type.name, type.emoji ?? "", type.appearance.buttonStyle, type.appearance.buttonLabel ?? "", type.appearance.description ?? ""]),
  };
  return createHash("sha256").update(JSON.stringify(shown)).digest("hex").slice(0, 16);
}

const CUSTOM_EMOJI = /^<a?:\w{2,32}:(\d{17,20})>$/;

/** A type whose emoji is a custom one the server does not have, which makes Discord refuse the whole panel. */
export function typeWithForeignEmoji(ctx: TicketCtx, panel: TicketPanel): TicketType | undefined {
  return panel.types.find((type) => emojiMissing(ctx, type));
}

function emojiMissing(ctx: TicketCtx, type: TicketType): boolean {
  const id = type.emoji ? CUSTOM_EMOJI.exec(type.emoji)?.[1] : undefined;
  const emojis = ctx.guild.emojis?.cache;
  return id !== undefined && emojis !== undefined && !emojis.has(id);
}

/** How long a look at a posted message is trusted before Discord is asked again, unless someone asks to check now. */
const CHECK_TTL_MS = 60_000;
const CHECK_WAIT_MS = 2_500;
const checks = new Map<string, { messageId: string; exists: boolean; at: number }>();

/** Forgets what was learned about posted messages, for tests. */
export function forgetPanelChecks(): void {
  checks.clear();
}

/**
 * Whether Discord still has a posted message. Null when it could not tell in
 * time or there was no channel to look in, so a slow answer is not read as a
 * deleted panel.
 */
async function messageExists(ctx: TicketCtx, channelId: string, messageId: string, fresh: boolean): Promise<{ exists: boolean | null; at: number | null }> {
  const key = `${ctx.guild.id}:${channelId}:${messageId}`;
  const known = checks.get(key);
  if (!fresh && known && Date.now() - known.at < CHECK_TTL_MS) return { exists: known.exists, at: known.at };
  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return { exists: null, at: null };
  const looked = channel.messages.fetch({ message: messageId, force: fresh }).then(
    () => true,
    (error: unknown) => (isUnknownMessage(error) ? false : null),
  );
  const exists = await Promise.race([looked, new Promise<null>((resolve) => setTimeout(() => resolve(null), CHECK_WAIT_MS).unref())]);
  if (exists === null) return { exists: null, at: null };
  const at = Date.now();
  checks.set(key, { messageId, exists, at });
  return { exists, at };
}

/** Discord's answers for a message, or a channel, that is not there any more. */
function isUnknownMessage(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  return code === 10008 || code === 10003 || (error instanceof Error && /unknown message/i.test(error.message));
}

/**
 * Edits the posted message when it is still in the panel's channel, and posts
 * a new one otherwise. A message left in a channel the panel moved away from
 * is deleted, so members do not open tickets from two places.
 */
export async function postPanelMessage(ctx: TicketCtx, panel: TicketPanel): Promise<Outcome<TicketPanelPostResult>> {
  const channel = panel.channel ? ctx.guild.channels.cache.get(panel.channel) : undefined;
  if (!channel || channel.type !== ChannelType.GuildText) return refused("noPanelChannel");
  const foreign = typeWithForeignEmoji(ctx, panel);
  if (foreign) return refused("panelEmoji", { type: foreign.name });

  const where = { guildId_panelId: { guildId: ctx.guild.id, panelId: panel.id } };
  const previous = await prisma.ticketPanelPost.findUnique({ where });
  const legacy = isLegacyPost(previous) || (!previous && (await usedOldPanel(ctx.guild.id, panel.id)));
  const rows = panelRows(panel);
  const hash = panelFingerprint(panel);
  let movedFrom: string | null = null;

  if (previous && !legacy && previous.channelId === channel.id) {
    const message = await channel.messages.fetch(previous.messageId).catch(() => null);
    const edited = message ? await ctx.edit(message, panel.message, {}, { fallback: PANEL_MESSAGE, rows }) : null;
    if (edited) {
      await prisma.ticketPanelPost.update({ where, data: { postedAt: new Date(), hash } });
      checks.set(`${ctx.guild.id}:${channel.id}:${edited.id}`, { messageId: edited.id, exists: true, at: Date.now() });
      return done({ panelId: panel.id, channelId: channel.id, messageId: edited.id, updated: true, legacyMessageLeft: false, movedFrom: null });
    }
  } else if (previous && !legacy) {
    const old = ctx.guild.channels.cache.get(previous.channelId);
    if (old?.isTextBased()) {
      const removed = await old.messages.delete(previous.messageId).then(
        () => true,
        () => false,
      );
      if (removed) movedFrom = previous.channelId;
    }
  }

  const posted: Message | null = await ctx.send(channel as TextChannel, panel.message, {}, { fallback: PANEL_MESSAGE, rows });
  if (!posted) return refused("panelFailed");
  await prisma.ticketPanelPost.upsert({
    where,
    create: { guildId: ctx.guild.id, panelId: panel.id, channelId: channel.id, messageId: posted.id, hash },
    update: { channelId: channel.id, messageId: posted.id, postedAt: new Date(), hash },
  });
  checks.set(`${ctx.guild.id}:${channel.id}:${posted.id}`, { messageId: posted.id, exists: true, at: Date.now() });
  return done({ panelId: panel.id, channelId: channel.id, messageId: posted.id, updated: false, legacyMessageLeft: legacy, movedFrom });
}

function stateOf(status: Omit<TicketPanelStatusDto, "state">): TicketPanelState {
  if (status.liveChannelId) return "moved";
  if (status.channelId === null || !status.channelExists) return "noChannel";
  if (status.legacy) return "legacy";
  if (status.messageId === null) return "notPosted";
  if (status.messageExists === false) return "messageDeleted";
  if (status.changed) return "changed";
  return "posted";
}

/**
 * Where each configured panel stands in Discord. Each posted message is
 * looked up, from what was learned in the last minute unless `fresh`, so a
 * panel deleted in Discord, one still up in a channel it was moved away from,
 * and one whose settings changed since all show as what they are.
 */
export async function panelStatusList(ctx: TicketCtx, options: { fresh?: boolean } = {}): Promise<TicketPanelStatusDto[]> {
  const fresh = options.fresh === true;
  const posts = new Map((await prisma.ticketPanelPost.findMany({ where: { guildId: ctx.guild.id } })).map((post) => [post.panelId, post]));
  return Promise.all(
    ctx.settings.panels.map(async (panel): Promise<TicketPanelStatusDto> => {
      const channelId = panel.channel ?? null;
      const channelExists = channelId !== null && ctx.guild.channels.cache.get(channelId)?.type === ChannelType.GuildText;
      const post = posts.get(panel.id);
      const legacy = isLegacyPost(post) || (!post && (await usedOldPanel(ctx.guild.id, panel.id)));
      const recorded = post && !legacy ? post : undefined;
      const check = recorded ? await messageExists(ctx, recorded.channelId, recorded.messageId, fresh) : { exists: null, at: null };
      const here = !!recorded && channelExists && recorded.channelId === channelId;
      const elsewhere = !!recorded && recorded.channelId !== channelId && check.exists === true;
      const posted = here && check.exists !== false;
      const status = {
        legacy,
        panelId: panel.id,
        name: panel.name,
        channelId,
        channelExists,
        posted,
        messageId: here ? recorded.messageId : null,
        messageUrl: here || elsewhere ? messageUrl(ctx.guild.id, recorded.channelId, recorded.messageId) : null,
        postedAt: recorded ? recorded.postedAt.toISOString() : null,
        messageExists: recorded ? check.exists : null,
        // A post from before fingerprints were kept has none, and is not called out of date for that.
        changed: here && recorded.hash !== "" && recorded.hash !== panelFingerprint(panel),
        liveChannelId: elsewhere ? recorded.channelId : null,
        checkedAt: check.at === null ? null : new Date(check.at).toISOString(),
      };
      return { ...status, state: stateOf(status) };
    }),
  );
}

/** The facts core's `ticketHealth` judges: the bot's permissions, and each panel's channel, message and types. */
export async function healthFacts(ctx: TicketCtx): Promise<TicketHealthFacts> {
  const permissions = ctx.guild.members.me?.permissions;
  const statuses = new Map((await panelStatusList(ctx)).map((status) => [status.panelId, status]));
  const category = (id: string | undefined) => {
    const exists = !!id && ctx.guild.channels.cache.get(id)?.type === ChannelType.GuildCategory;
    return { exists, children: exists ? ctx.guild.channels.cache.filter((c) => c.parentId === id).size : 0 };
  };
  return {
    permissions: {
      manageChannels: permissions?.has("ManageChannels") ?? false,
      manageWebhooks: permissions?.has("ManageWebhooks") ?? false,
      manageThreads: (permissions?.has("ManageThreads") ?? false) && (permissions?.has("CreatePrivateThreads") ?? false),
    },
    panels: ctx.settings.panels.map((panel) => {
      const status = statuses.get(panel.id);
      return {
        id: panel.id,
        channelId: panel.channel ?? null,
        channelExists: status?.channelExists ?? false,
        posted: status?.posted ?? false,
        legacy: status?.legacy ?? false,
        messageMissing: status?.messageExists === false && status.messageId !== null,
        changed: status?.changed ?? false,
        liveChannelId: status?.liveChannelId ?? null,
        types: panel.types.map((type) => {
          const primary = category(type.opening.category);
          const overflow = category(type.opening.overflowCategory);
          return {
            id: type.id,
            mode: type.opening.mode === "thread" ? "thread" : "channel",
            handlerCount: type.handlers.length,
            categoryId: type.opening.category ?? null,
            categoryExists: primary.exists,
            categoryChildren: primary.children,
            overflowCategoryId: type.opening.overflowCategory ?? null,
            overflowExists: overflow.exists,
            overflowChildren: overflow.children,
            emojiMissing: emojiMissing(ctx, type),
          };
        }),
      };
    }),
  };
}
