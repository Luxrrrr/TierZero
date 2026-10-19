import { s, type ModuleAction, type ModuleNotice } from "@tier0/core";
import { prisma } from "@tier0/db";
import { warn, type GamingCtx } from "./context.js";
import type { GamingSettings } from "./settings.js";
import { attachMessage, createEvent, discardEvent, eventById, eventsOf } from "./signup-store.js";
import { closeSignup, entriesOf, scheduleReminder, sendSignup } from "./signup.js";
import { WHEN_EXAMPLES, parseWhen } from "./time.js";

/**
 * What the settings page can do beyond saving settings: open a sign-up and
 * close one, the same as `/signup` does in Discord, for owners who would
 * rather not type a command.
 */

const createInput = s.object({
  title: s.string({ label: "Name", help: "What the sign-up is called, such as Friday scrims.", max: 100 }),
  channel: s.channel({
    types: ["text"],
    optional: true,
    label: "Post it in",
    help: "Left empty, it goes in the channel chosen under Sign-ups, if there is one.",
  }),
  game: s.string({ label: "Game", optional: true, max: 60 }),
  start: s.string({ label: "Starts", optional: true, max: 60, help: `Such as ${WHEN_EXAMPLES}. Left empty, there is no start time.` }),
  teamSize: s.integer({ label: "Players to a team", help: "1 means players sign up alone.", min: 1, max: 10, default: 1 }),
  max: s.integer({ label: "Most teams (or players)", help: "0 means no limit.", min: 0, max: 500, default: 0 }),
  waitlist: s.boolean({ label: "Keep a waitlist once it is full", default: true }),
  role: s.role({ label: "Role needed to sign up", optional: true }),
  rewardRole: s.role({ label: "Role to give everyone registered", optional: true, assigns: true }),
  note: s.string({ label: "Note for players", optional: true, multiline: true, max: 500 }),
});

const closeInput = s.object({
  number: s.integer({ label: "Sign-up number", help: "The number in the list above, such as 3 for #3.", min: 1, max: 1_000_000 }),
  takeRoles: s.boolean({ label: "Take the reward role back from everyone", default: false }),
});

type Input = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const number = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback);

export const gamingActions: Record<string, ModuleAction<GamingSettings>> = {
  openSignup: {
    label: "Open a sign-up",
    section: "scrimSignups",
    help: "Posts a sign-up for a scrim or tournament with its join buttons.",
    input: createInput,
    async run({ ctx, input }: { ctx: GamingCtx; input: Input }) {
      if (!ctx.settings.signups.enabled) return { ok: false, message: "Turn on Scrim and tournament sign-ups first, and save." };

      let startsAt: Date | null = null;
      const start = text(input.start).trim();
      if (start) {
        const parsed = parseWhen(start, new Date(), ctx.settings.timeZone);
        if (!parsed.ok) return { ok: false, message: `That start time was not understood. Try ${WHEN_EXAMPLES}.` };
        startsAt = parsed.at;
      }

      const target = text(input.channel) || ctx.settings.signups.channel;
      const channel = target ? (ctx.guild.channels.cache.get(target) ?? (await ctx.guild.channels.fetch(target).catch(() => null))) : null;
      if (!channel?.isTextBased()) return { ok: false, message: "Pick a channel to post the sign-up in." };

      const event = await createEvent({
        guildId: ctx.guild.id,
        channelId: channel.id,
        title: text(input.title).trim(),
        game: text(input.game).trim(),
        note: text(input.note).trim(),
        startsAt,
        teamSize: number(input.teamSize, 1),
        capacity: number(input.max, 0),
        waitlist: input.waitlist !== false,
        requiredRoles: text(input.role) ? [text(input.role)] : [],
        rewardRoleId: text(input.rewardRole) || null,
        createdById: ctx.client.user?.id ?? "0",
      });
      const message = await sendSignup(ctx, channel, event);
      if (!message) {
        await discardEvent(event.id);
        return { ok: false, message: `Could not post in #${channel.name}. Check that the bot can send messages and embed links there.` };
      }
      await attachMessage(event.id, message.id);
      await scheduleReminder(ctx, event).catch(warn(`schedule the reminder of sign-up ${event.id}`));
      return { ok: true, message: `Opened sign-up #${event.id} in #${channel.name}.` };
    },
  },

  closeSignup: {
    label: "Close a sign-up",
    section: "scrimSignups",
    help: "Stops taking sign-ups.",
    input: closeInput,
    async run({ ctx, input }: { ctx: GamingCtx; input: Input }) {
      const event = await eventById(ctx.guild.id, number(input.number, 0));
      if (!event) return { ok: false, message: "There is no sign-up with that number." };
      if (!(await closeSignup(ctx, event, input.takeRoles === true))) return { ok: false, message: `Sign-up #${event.id} is already closed.` };
      return { ok: true, message: `Closed sign-up #${event.id}.` };
    },
  },
};

/** A summary of what is running now, so the numbers the actions ask for are on the page. */
export async function gamingNotices(ctx: GamingCtx): Promise<ModuleNotice[]> {
  const notices: ModuleNotice[] = [];
  if (ctx.settings.signups.enabled) {
    const open = await eventsOf(ctx.guild.id, "open");
    if (open.length > 0) {
      const lines = [];
      for (const summary of open.slice(0, 10)) {
        const full = await eventById(ctx.guild.id, summary.id);
        const registered = full ? entriesOf(full).registered.length : 0;
        lines.push(`#${summary.id} ${summary.title} (${registered}${summary.capacity > 0 ? ` of ${summary.capacity}` : ""})`);
      }
      notices.push({ tone: "info", text: `Open sign-ups: ${lines.join(", ")}${open.length > 10 ? ` and ${open.length - 10} more` : ""}.` });
    }
  }
  if (ctx.settings.lfg.enabled) {
    const posts = await prisma.lfgPost.count({ where: { guildId: ctx.guild.id, status: "open" } });
    if (posts > 0) notices.push({ tone: "info", text: `${posts} looking-for-group ${posts === 1 ? "post is" : "posts are"} open.` });
  }
  if (ctx.settings.voice.enabled) {
    const rooms = await prisma.voiceRoom.count({ where: { guildId: ctx.guild.id } });
    if (rooms > 0) notices.push({ tone: "info", text: `${rooms} voice ${rooms === 1 ? "room is" : "rooms are"} in use.` });
  }
  return notices;
}
