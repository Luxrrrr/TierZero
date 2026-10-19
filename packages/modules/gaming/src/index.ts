import { defineModule, type EventHandlers, type TaskHandler } from "@tier0/core";
import { warn, type GamingCtx } from "./context.js";
import { expireOverdue, expirePost, lfgComponents } from "./lfg.js";
import { lfgCommand } from "./lfg-command.js";
import { gamingActions, gamingNotices } from "./actions.js";
import { roomCommand } from "./room-command.js";
import { forgetRoom, roomByChannel } from "./room-store.js";
import { remind, signupComponents, signupModals } from "./signup.js";
import { signupCommand } from "./signup-command.js";
import { settingsSchema, type GamingSettings } from "./settings.js";
import { openRoom, sweepRooms, tidyRoom } from "./voice.js";

/**
 * Three features for gaming communities, each with its own switch: voice rooms
 * members get by joining a hub, looking-for-group posts, and scrim and
 * tournament sign-ups. They share one module because they share an audience
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
      if (room) await tidyRoom(ctx, room, 0);
    }

    if (!after.channelId || !ctx.settings.voice.enabled) return;
    const member = after.member ?? (await ctx.guild.members.fetch(after.id).catch(() => null));
    if (!member || member.user.bot) return;
    const hub = ctx.settings.voice.hubs.find((entry) => entry.channel === after.channelId);
    if (hub) await openRoom(ctx, hub, member);
  },

  async channelDelete(channel) {
    await forgetRoom(channel.id);
  },
};

const tasks: Record<string, TaskHandler<GamingSettings>> = {
  /** Removes rooms that emptied while the bot was away and ends posts whose expiry was lost, then queues itself again. */
  async sweep(_payload, ctx) {
    await ctx.tasks.reschedule("sweep", new Date(Date.now() + SWEEP_EVERY_MS));
    await sweepRooms(ctx);
    if (ctx.settings.lfg.enabled) await expireOverdue(ctx);
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
  requires: ["ManageChannels", "MoveMembers"],

  settings: settingsSchema,
  actions: gamingActions,
  notices: gamingNotices,
  commands: [roomCommand, lfgCommand, signupCommand],
  components: { ...lfgComponents, ...signupComponents },
  modals: signupModals,
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
  },
});
