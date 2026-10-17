import { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";
import { CATEGORY, GUILD, channel, interaction, known, member, user, world, type World } from "./fake-discord.ts";

/**
 * A server with two ticket types on one panel, a database built from the
 * migrations, and the helpers the flow tests share. Importing this sets the
 * database up for the test file, so it is imported before anything else that
 * reads the database.
 */

export const PANEL_CHANNEL = "110000000000000001";
export const CAT = "110000000000000002";
export const OVERFLOW = "110000000000000003";
export const BILLING_CAT = "110000000000000004";
export const CLOSED_CAT = "110000000000000005";
export const LOG = "110000000000000006";
export const HANDLER = "120000000000000001";
export const BILLING = "120000000000000002";
export const ADMIN = "120000000000000003";
export const VIP = "120000000000000004";
export const OBSERVER = "120000000000000005";

export const ada = user("130000000000000001", "ada");
export const grace = user("130000000000000002", "grace");
export const linus = user("130000000000000003", "linus");
export const mallory = user("130000000000000004", "mallory");

const db = createTestDatabase();
export const { prisma } = await import("@tier0/db");
export const mod = await import("../dist/index.js");
export const tickets = mod.default;
const { forgetWebhook } = await import("../dist/webhooks.js");

const registry = new ModuleRegistry();
registry.register(tickets);

export function settingsOf(extra: Record<string, unknown> = {}, typeExtra: Record<string, unknown> = {}) {
  const { general, transcripts, ratings, automation, ...rest } = extra as Record<string, Record<string, unknown> | undefined>;
  const result = registry.resolveSettings("tickets", {
    panels: [
      {
        id: "main",
        name: "Main",
        channel: PANEL_CHANNEL,
        types: [
          {
            id: "support",
            name: "Support",
            handlers: [HANDLER],
            form: [{ label: "What happened?", style: "short", required: true }],
            opening: { category: CAT, overflowCategory: OVERFLOW, observers: [OBSERVER] },
            rules: { cooldown: "1h" },
            ...typeExtra,
          },
          { id: "billing", name: "Billing", handlers: [BILLING], opening: { category: BILLING_CAT }, rules: { allowedRoles: [VIP] } },
        ],
      },
    ],
    general: { adminRoles: [ADMIN], blocklist: { members: [mallory.id] }, ...general },
    transcripts: { logChannel: LOG, ...transcripts },
    ratings: { ...ratings },
    automation: { ...automation },
    ...rest,
  });
  assert.ok(result.ok, result.ok ? "" : result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  return result.value;
}

export function setup(extra: Record<string, unknown> = {}, typeExtra: Record<string, unknown> = {}, options = {}): World {
  const w = world(settingsOf(extra, typeExtra), options);
  for (const id of [CAT, OVERFLOW, BILLING_CAT, CLOSED_CAT]) w.add(channel(id, { type: CATEGORY }));
  w.add(channel(PANEL_CHANNEL));
  w.add(channel(LOG));
  w.addMember(member(ada));
  w.addMember(member(grace, [HANDLER]));
  w.addMember(member(linus, [HANDLER]));
  w.addMember(member(mallory));
  return w;
}

/** Opens a Support ticket for ada through the form, and returns its channel and row. */
export async function open(w: World, answer = "Cannot log in") {
  await tickets.modals!.subject!(interaction(ada, { fields: { q0: answer } }) as never, { rest: "main:support", ctx: w.ctx });
  const row = await prisma.ticket.findFirstOrThrow({ where: { openerId: ada.id }, orderBy: { id: "desc" } });
  return { row, channel: w.channels.get(row.channelId) ?? known.get(row.channelId)! };
}

export const handlerPress = (who = grace, channelId?: string) => interaction(who, { roles: [HANDLER], ...(channelId ? { channelId } : {}) });
export const refusalText = (w: World) => w.replies.at(-1)?.body.embeds[0]?.description ?? w.replies.at(-1)?.body.content;

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Tickets test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  await prisma.ticket.deleteMany();
  await prisma.ticketCooldown.deleteMany();
  await prisma.ticketPanelPost.deleteMany();
  mod.forgetOpenTickets();
  forgetWebhook();
});
