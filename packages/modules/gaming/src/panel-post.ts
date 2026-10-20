import type { ActionRowBuilder, MessageActionRowComponentBuilder } from "discord.js";
import type { MessageBody, ReplyValues, RowStatus } from "@tier0/core";
import type { GamingCtx } from "./context.js";
import { forgetPanelPost, panelPostOf, savePanelPost } from "./group-store.js";

/**
 * Posting a panel, the message in a channel that members press a button on, and
 * keeping track of where it went. Shared by the group hubs and the looking-for-group
 * panels, which differ only in the message and the buttons.
 */

export type Published = { ok: true; updated: boolean; channelId: string } | { ok: false; message: string };

export interface PanelMessage {
  panelId: string;
  channelId: string;
  body: MessageBody;
  fallback: MessageBody;
  values: ReplyValues;
  rows: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

/** Posts a panel, or edits its posted message when that still sits in the panel's channel. */
export async function publishMessage(ctx: GamingCtx, panel: PanelMessage): Promise<Published> {
  const channel = ctx.guild.channels.cache.get(panel.channelId);
  if (!channel?.isTextBased()) return { ok: false, message: "The panel's channel no longer exists. Pick another channel and save." };

  const options = { fallback: panel.fallback, rows: panel.rows };
  const current = await panelPostOf(ctx.guild.id, panel.panelId);
  if (current && current.channelId === channel.id) {
    const message = await channel.messages.fetch(current.messageId).catch(() => null);
    if (message) {
      const edited = await ctx.edit(message, panel.body, panel.values, options);
      // Not falling through to a repost: that would delete the live panel over a message that cannot be built.
      if (!edited) return { ok: false, message: "The posted panel could not be edited. Check that the bot can still see that channel and send messages in it." };
      return { ok: true, updated: true, channelId: channel.id };
    }
  }
  if (current) {
    const old = ctx.guild.channels.cache.get(current.channelId);
    if (old?.isTextBased()) await old.messages.delete(current.messageId).catch(() => undefined);
    await forgetPanelPost(ctx.guild.id, panel.panelId);
  }

  const posted = await ctx.send(channel, panel.body, panel.values, options);
  if (!posted) return { ok: false, message: "The panel could not be posted. Check that the bot can send messages and embed links in that channel." };
  await savePanelPost(ctx.guild.id, panel.panelId, channel.id, posted.id);
  return { ok: true, updated: false, channelId: channel.id };
}

/** Whether a panel is up in Discord, for the line under it in the dashboard. */
export async function postStatus(ctx: GamingCtx, panelId: string): Promise<RowStatus> {
  const post = await panelPostOf(ctx.guild.id, panelId);
  if (!post) return { tone: "idle", text: "Not posted yet" };
  const channel = ctx.guild.channels.cache.get(post.channelId);
  if (!channel?.isTextBased()) return { tone: "problem", text: "Its channel was deleted. Post it again." };
  const message = await channel.messages.fetch(post.messageId).catch(() => null);
  if (!message) return { tone: "problem", text: `The post in #${channel.name} was deleted or cannot be read. Post it again.` };
  return { tone: "ok", text: `Posted in #${channel.name}. Post it again after changing the options or the message.` };
}

/** The text a "Post in Discord" button reports back. */
export function postReport(ctx: GamingCtx, result: Published): { ok: boolean; message: string } {
  if (!result.ok) return { ok: false, message: result.message };
  const name = ctx.guild.channels.cache.get(result.channelId)?.name;
  const where = name ? `#${name}` : "its channel";
  return { ok: true, message: result.updated ? `Updated the panel in ${where}.` : `Posted the panel in ${where}.` };
}
