import type { ReplyValues } from "@tier0/core";
import { answer, memberOf, warn, type Answerable, type GamingCtx } from "./context.js";
import { cleanGame } from "./group-logic.js";
import { attachMessage, createPost, discardPost, lastPostedAt, openPostsOf } from "./lfg-store.js";
import { findGame, gameKey, scheduleExpiry, sendPost } from "./lfg.js";
import { LFG_REFUSALS, LFG_REPLIES, type LfgRefusalKey } from "./messages.js";
import { cooldownLeft, expiryOf } from "./party.js";
import { WHEN_EXAMPLES, parseWhen, spokenWait } from "./time.js";

/**
 * Asking for players, whichever way the member came to it: the /lfg command or
 * the form behind a panel's button. The game list, the channels, the limits and
 * the wording all come from the settings.
 */

export const NOTE_MAX = 300;

export interface Request {
  game: string;
  needed: number;
  note: string | null;
  /** What the member typed for the start time, if anything. */
  when: string | null;
}

const refuse = (ctx: GamingCtx, interaction: Answerable, key: LfgRefusalKey, values: ReplyValues = {}) =>
  answer(ctx, interaction, ctx.settings.messages.lfgRefusals[key], LFG_REFUSALS[key], values);

/** Checks a request against the server's limits and posts it, telling the member how it went. The reply must already be deferred. */
export async function requestPlayers(ctx: GamingCtx, interaction: Answerable, request: Request): Promise<void> {
  const { lfg } = ctx.settings;
  const listed = findGame(ctx.settings, request.game);
  const typed = cleanGame(request.game);
  if (lfg.restrictGames) {
    if (lfg.games.length === 0) return refuse(ctx, interaction, "noGames");
    if (!listed) return refuse(ctx, interaction, "unknownGame");
  } else if (!listed && typed === "") {
    return refuse(ctx, interaction, "unknownGame");
  }
  const name = listed?.name ?? typed;

  if (!Number.isInteger(request.needed) || request.needed < 1 || request.needed > lfg.maxNeeded) return refuse(ctx, interaction, "badSize", { limit: lfg.maxNeeded });

  const now = new Date();
  let startsAt: Date | null = null;
  if (request.when) {
    const parsed = parseWhen(request.when, now, ctx.settings.timeZone);
    if (!parsed.ok) return refuse(ctx, interaction, "badTime", { examples: WHEN_EXAMPLES });
    startsAt = parsed.at;
  }

  if ((await openPostsOf(ctx.guild.id, interaction.user.id)) >= lfg.maxOpen) return refuse(ctx, interaction, "tooManyOpen", { limit: lfg.maxOpen });
  const wait = cooldownLeft(await lastPostedAt(ctx.guild.id, interaction.user.id), lfg.cooldown, now);
  if (wait > 0) return refuse(ctx, interaction, "cooldown", { remaining: spokenWait(wait) });

  const target = listed?.channel ?? lfg.channel;
  const channel = target ? (ctx.guild.channels.cache.get(target) ?? (await ctx.guild.channels.fetch(target).catch(() => null))) : interaction.channel;
  if (!channel?.isTextBased()) return refuse(ctx, interaction, "cannotPost");

  const member = await memberOf(ctx, interaction);
  const post = await createPost({
    guildId: ctx.guild.id,
    channelId: channel.id,
    gameId: listed ? gameKey(listed) : name,
    gameName: name,
    authorId: interaction.user.id,
    authorName: member?.displayName ?? interaction.user.username,
    needed: request.needed,
    note: request.note ?? "",
    startsAt,
    expiresAt: expiryOf(now, startsAt, lfg.expiresAfter),
  });

  const message = await sendPost(ctx, channel, post);
  if (!message) {
    await discardPost(post.id);
    return refuse(ctx, interaction, "cannotPost");
  }
  await attachMessage(post.id, message.id);
  await scheduleExpiry(ctx, post).catch(warn(`schedule the expiry of post ${post.id}`));
  await answer(ctx, interaction, ctx.settings.messages.lfgReplies.posted, LFG_REPLIES.posted, { link: message.url, game: name });
}
