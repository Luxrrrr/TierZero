import { defineModule, type EventHandlers, type TaskHandler } from "@tier0/core";
import { warn, type GamingCtx } from "./context.js";
import { expireOverdue, expirePost, lfgComponents } from "./lfg.js";
import { lfgPanelComponents, lfgPanelModals, lfgPanelRows } from "./lfg-panel.js";
import { lfgCommand } from "./lfg-command.js";
import { gamingActions, gamingNotices } from "./actions.js";
import { groupComponents, groupModals } from "./group-controls.js";
import { groupPanelComponents, groupPanelModals, groupPanelRows } from "./group-panel.js";
import { GROUP_HUB, groupById, groupByVoice } from "./group-store.js";
import { endGroup, groupMemberJoined, groupMemberLeft, sweepGroups, tidyGroup } from "./groups.js";
import { roomCommand } from "./room-command.js";
import { forgetRoom, roomByChannel } from "./room-store.js";
import { remind, signupComponents, signupModals } from "./signup.js";
import { signupCommand } from "./signup-command.js";
import { settingsSchema, type GamingSettings } from "./settings.js";
import { openRoom, sweepRooms, tidyRoom } from "./voice.js";

/**
 * Four features for gaming communities, each with its own switch: voice rooms
 * members get by joining a hub, looking-for-group posts, scrim and tournament
 * sign-ups, and group hubs that give a group a voice channel and a thread. They share one module because they share an audience
 * and a place in the dashboard, not because they share code.
 */

const SWEEP_EVERY_MS = 10 * 60_000;
const FIRST_SWEEP_MS = 30_000;

/** Guilds whose sweep this process has already made sure is queued. */
const queued = new Set<string>();

/**
 * Keeps one sweep queued. The queue outlives the bot, so after a restart the
 * old row simply comes due, and this only covers a row that was lost.
 */
async function ensureSweep(ctx: GamingCtx): Promise<void> {
  if (queued.has(ctx.guild.id)) return;
  queued.add(ctx.guild.id);
  await ctx.tasks.reschedule("sweep", new Date(Date.now() + FIRST_SWEEP_MS)).catch(warn("queue the sweep"));
}

const events: Partial<EventHandlers<GamingSettings>> = {
  async voiceStateUpdate(before, after, ctx) {
    await ensureSweep(ctx);
    if (before.channelId === after.channelId) return;

    if (before.channelId) {
      const room = await roomByChannel(ctx.guild.id, before.channelId);
      if (room?.hubId === GROUP_HUB) await groupMemberLeft(ctx, before.channelId);
      else if (room) await tidyRoom(ctx, room, 0);
    }

    if (!after.channelId) return;
    const member = after.member ?? (await ctx.guild.members.fetch(after.id).catch(() => null));
    if (!member || member.user.bot) return;
    await groupMemberJoined(ctx, member, after.channelId);
    if (!ctx.settings.voice.enabled) return;
    const hub = ctx.settings.voice.hubs.find((entry) => entry.channel === after.channelId);
    if (hub) await openRoom(ctx, hub, member);
  },

  async channelDelete(channel, ctx) {
    const group = await groupByVoice(ctx.guild.id, channel.id);
    if (group) await endGroup(ctx, group, ctx.settings.groups.labels.groupEndReason);
    await forgetRoom(channel.id);
  },
};

async function tidyGroupOf(ctx: GamingCtx, payload: Record<string, unknown>): Promise<void> {
  if (typeof payload.groupId !== "number") return;
  const group = await groupById(ctx.guild.id, payload.groupId);
  if (group) await tidyGroup(ctx, group);
}

const tasks: Record<string, TaskHandler<GamingSettings>> = {
  /** Removes rooms that emptied while the bot was away and ends posts whose expiry was lost, then queues itself again. */
  async sweep(_payload, ctx) {
    await ctx.tasks.reschedule("sweep", new Date(Date.now() + SWEEP_EVERY_MS));
    await sweepRooms(ctx);
    await sweepGroups(ctx);
    if (ctx.settings.lfg.enabled) await expireOverdue(ctx);
  },

  /** Runs when a group's owner has had their time to join, and again when its voice channel has sat empty. */
  async groupDeadline(payload, ctx) {
    await tidyGroupOf(ctx, payload);
  },

  async groupTidy(payload, ctx) {
    await tidyGroupOf(ctx, payload);
  },

  async lfgExpire(payload, ctx) {
    if (typeof payload.postId === "number") await expirePost(ctx, payload.postId);
  },

  async signupReminder(payload, ctx) {
    if (typeof payload.eventId === "number") await remind(ctx, payload.eventId);
  },
};

export default defineModule({
  id: "gaming",
  name: "Gaming tools",
  summary: "Join-to-create voice channels, looking-for-group posts and scrim sign-ups.",
  category: "engagement",
  requires: ["ManageChannels", "Connect", "MoveMembers"],

  settings: settingsSchema,
  actions: gamingActions,
  notices: gamingNotices,
  commands: [roomCommand, lfgCommand, signupCommand],
  components: { ...lfgComponents, ...signupComponents, ...lfgPanelComponents, ...groupPanelComponents, ...groupComponents },
  modals: { ...signupModals, ...lfgPanelModals, ...groupPanelModals, ...groupModals },
  rows: { "groups.panels": groupPanelRows, "lfg.panels": lfgPanelRows },
  events,
  tasks,

  async onEnable(ctx) {
    queued.add(ctx.guild.id);
    await ctx.tasks.reschedule("sweep", new Date(Date.now() + FIRST_SWEEP_MS));
  },

  async onDisable(ctx) {
    queued.delete(ctx.guild.id);
    await ctx.tasks.cancel("sweep");
    // Rooms that are already empty would otherwise stay, since nothing will notice them leave.
    await sweepRooms(ctx).catch(warn("remove empty rooms"));
    await sweepGroups(ctx).catch(warn("remove empty groups"));
  },
});
