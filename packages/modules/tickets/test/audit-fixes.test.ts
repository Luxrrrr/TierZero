import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { emptyEmbed, plainReply, type MessageBody } from "@tier0/core";
import { ticketHealth, ticketHealthSummary } from "@tier0/shared-tickets";
import { ADMIN, CAT, HANDLER, LOG, OBSERVER, PANEL_CHANNEL, ada, grace, mallory, mod, open, prisma, refusalText, settingsOf, setup, tickets } from "./ticket-world.ts";
import { channel, interaction, member, user, type World } from "./fake-discord.ts";

/**
 * The fixes from the October tickets audit, each against the behaviour the
 * audit found: the starter panel, the inactivity close, who is pinged and let
 * in, long answers, member text, kept channels, reopening, removing, channel
 * names, renames, emoji, and the panel's state in Discord.
 */

const { forgetPanelChecks } = await import("../dist/panel-post.js");
const working = await import("../dist/working.js");
const { withAnswers } = await import("../dist/welcome.js");
const { accessOf } = await import("../dist/context.js");
const { withinHours, nextOpening, zoneOf } = await import("../dist/hours.js");

const actor = { userId: grace.id, name: "Grace", avatarUrl: null };
const DAY = 86_400_000;
const setSettings = (w: World, settings: unknown) => {
  (w.ctx as unknown as { settings: unknown }).settings = settings;
};
const sentIn = (w: World, channelId: string) => w.channels.get(channelId)?.sent ?? [];

beforeEach(() => forgetPanelChecks());

describe("a new server's starter panel", () => {
  test("is not called the older version's, and health asks for it to be posted", async () => {
    const w = setup({ panels: undefined, panel: undefined });
    const [status] = await mod.panelStatuses(w.ctx);
    assert.equal(status?.legacy, false);
    assert.equal(status?.state, "noChannel");
    const issues = ticketHealth(await mod.ticketHealthFacts(w.ctx));
    assert.ok(!issues.some((issue) => issue.code === "panelLegacy"));
    assert.ok(issues.some((issue) => issue.code === "noPanelsPosted" && issue.firstRun === true));
  });

  test("posting it does not say an old message is still up", async () => {
    const w = setup({ panels: undefined, panel: { channel: PANEL_CHANNEL }, category: CAT, supportRoles: [HANDLER] });
    assert.equal((await mod.postPanel(w.ctx, "default", actor)).legacyMessageLeft, false);
  });
});

describe("the inactivity close", () => {
  const quiet = async (w: World, typeId = "support") => {
    const { row, channel: ch } = await open(w);
    const at = new Date(Date.now() - 3 * DAY);
    await prisma.ticket.update({ where: { id: row.id }, data: { lastActivityAt: at, typeId } });
    return { row: { ...row, lastActivityAt: at, typeId }, ch };
  };
  const status = async (id: number) => (await prisma.ticket.findUniqueOrThrow({ where: { id } })).status;

  test("does not close once auto-close is switched off", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, after: "1h" } } });
    const { row, ch } = await quiet(w);
    setSettings(w, settingsOf({ automation: { autoClose: { enabled: false } } }));
    await tickets.tasks!.autoclose!({ channelId: ch.id }, w.ctx);
    assert.equal(await status(row.id), "open");
  });

  test("does not close a ticket whose type is set to never close", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, after: "1h" } } }, { overrides: { autoClose: "off" } });
    const { row, ch } = await quiet(w);
    await tickets.tasks!.autoclose!({ channelId: ch.id }, w.ctx);
    assert.equal(await status(row.id), "open");
  });

  test("moves the close when a longer time was saved since", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, after: "30d" } } });
    const { row, ch } = await quiet(w);
    await tickets.tasks!.autoclose!({ channelId: ch.id }, w.ctx);
    assert.equal(await status(row.id), "open");
    const moved = w.scheduled.filter((task) => task.kind === "autoclose").at(-1);
    assert.ok(moved && moved.at.getTime() > Date.now() + 20 * DAY);
  });

  test("closes when it is due", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, after: "1h" } } });
    const { row, ch } = await quiet(w);
    await tickets.tasks!.autoclose!({ channelId: ch.id }, w.ctx);
    assert.equal(await status(row.id), "closed");
  });

  test("a settings change moves every open ticket's close, counted from its last message", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, after: "2d" } } });
    const { row, ch } = await quiet(w);
    const previous = w.ctx as unknown as { settings: Parameters<NonNullable<typeof tickets.onSettingsChange>>[1] };
    const before = previous.settings;
    setSettings(w, settingsOf({ automation: { autoClose: { enabled: true, after: "5d" } } }));
    await tickets.onSettingsChange!(w.ctx, before);
    const task = w.scheduled.filter((entry) => entry.kind === "autoclose" && entry.payload.channelId === ch.id).at(-1);
    assert.ok(task);
    assert.ok(Math.abs(task.at.getTime() - (row.lastActivityAt.getTime() + 5 * DAY)) < 1000);

    setSettings(w, settingsOf({ automation: { autoClose: { enabled: false } } }));
    await tickets.onSettingsChange!(w.ctx, settingsOf({ automation: { autoClose: { enabled: true, after: "5d" } } }));
    assert.ok(w.cancelled.some((entry) => entry.kind === "autoclose" && entry.match?.channelId === ch.id));
  });

  test("moving a ticket to a type that never closes cancels its close", async () => {
    const w = setup({ automation: { autoClose: { enabled: true, after: "1h" } } });
    const billingNever = settingsOf({ automation: { autoClose: { enabled: true, after: "1h" } } });
    const billing = billingNever.panels[0]!.types[1]!;
    billing.overrides.autoClose = "off";
    billing.rules.allowedRoles = [];
    setSettings(w, billingNever);
    const { row, channel: ch } = await open(w);
    w.add(channel(billing.opening.category!, { type: 4 }));
    await mod.transferTicket(w.ctx, row.id, { typeId: "billing" }, actor);
    assert.ok(w.cancelled.some((entry) => entry.kind === "autoclose" && entry.match?.channelId === ch.id));
  });

  test("a wait saved below a minute before the minimum existed reads as a minute", () => {
    const settings = settingsOf(
      { general: { closeRequestTimeout: "0s" }, automation: { autoClose: { enabled: true, after: 0 }, reminder: { after: "30s" } } },
      { overrides: { autoClose: "custom", autoCloseAfter: "5s" } },
    );
    assert.equal(settings.general.closeRequestTimeout, 60_000);
    assert.equal(settings.automation.autoClose.after, 60_000);
    assert.equal(settings.automation.reminder.after, 60_000);
    assert.equal(settings.panels[0]!.types[0]!.overrides.autoCloseAfter, 60_000);
  });

  test("a duration below a minute is taken as a minute", async () => {
    const { effectiveAutoClose } = await import("../dist/resolve.js");
    const settings = settingsOf({ automation: { autoClose: { enabled: true, after: "1h" } } });
    settings.automation.autoClose.after = 0;
    assert.equal(effectiveAutoClose(settings, settings.panels[0]!.types[0]).after, 60_000);
  });
});

describe("who hears about a new ticket", () => {
  const PINGED = "120000000000000077";

  test("Other roles are named in the default first message and pinged", async () => {
    const w = setup({}, { opening: { category: CAT, ping: "roles", pingRoles: [PINGED] } });
    const { channel: ch } = await open(w);
    const welcome = ch.sent[0]!;
    assert.equal(welcome.body?.content, "{user} {pingRoles}");
    assert.equal(welcome.values?.pingRoles, `<@&${PINGED}>`);
    assert.deepEqual((welcome.options?.mentions as { roles: string[] }).roles, [PINGED]);
  });
});

describe("a private thread", () => {
  test("lets in the observers and the admin roles as well as the handlers", async () => {
    const w = setup({}, { opening: { mode: "thread", observers: [OBSERVER] } });
    const watcher = w.addMember(member(user("130000000000000021", "watcher"), [OBSERVER]));
    const boss = w.addMember(member(user("130000000000000022", "boss"), [ADMIN]));
    const { channel: thread } = await open(w);
    for (const id of [grace.id, watcher.id, boss.id, ada.id]) assert.ok(thread.members.cache.has(id), id);
  });

  test("can be moved to a channel type, and a channel ticket to a thread type", async () => {
    const thread = setup({}, { opening: { mode: "thread" } });
    const { row } = await open(thread);
    const moved = await mod.transferTicket(thread.ctx, row.id, { typeId: "billing" }, actor);
    assert.equal(moved.ticket.typeId, "billing");
    assert.equal(moved.ticket.mode, "thread");

    await prisma.ticket.deleteMany();
    await prisma.ticketCooldown.deleteMany();
    const settings = settingsOf();
    settings.panels[0]!.types[1]!.opening.mode = "thread";
    const plain = setup();
    setSettings(plain, settings);
    const { row: second } = await open(plain);
    assert.equal((await mod.transferTicket(plain.ctx, second.id, { typeId: "billing" }, actor)).ticket.mode, "channel");
  });
});

describe("Manage Channels", () => {
  const person = (flags: bigint[]) => ({
    user: user("130000000000000031", "mod"),
    member: { roles: [] },
    memberPermissions: { has: (flag: bigint) => flags.includes(flag) },
  });

  test("works every type in Discord as the dashboard does, without settings", () => {
    const access = accessOf(settingsOf(), person([PermissionFlagsBits.ManageChannels]) as never);
    assert.equal(access.level, "admin");
    assert.equal(accessOf(settingsOf(), person([PermissionFlagsBits.ManageGuild]) as never).level, "manager");
  });

  test("lets its roles see a new ticket channel", async () => {
    const w = setup();
    const MOD_ROLE = "120000000000000088";
    const roles = (w.guild as unknown as { roles: { cache: Map<string, unknown> } }).roles.cache;
    roles.set(MOD_ROLE, { id: MOD_ROLE, managed: false, permissions: { has: (flag: bigint) => flag === PermissionFlagsBits.ManageChannels } });
    await open(w);
    const overwrites = w.created[0]!.permissionOverwrites as { id: string }[];
    assert.ok(overwrites.some((entry) => entry.id === MOD_ROLE));
  });
});

describe("long answers", () => {
  test("are cut to fit under a long first message rather than replacing it", () => {
    const body: MessageBody = { ...plainReply("{user}"), embeds: [{ ...emptyEmbed(), title: "Ticket", description: "x".repeat(4000) }] };
    const answers = Array.from({ length: 5 }, (_, i) => ({ label: `Question ${i + 1}`, value: "y".repeat(3000) }));
    const fitted = withAnswers(body, answers, true);
    const embed = fitted.embeds[0]!;
    const total = embed.title.length + embed.description.length + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
    assert.ok(total <= 6000, String(total));
    assert.equal(embed.description, body.embeds[0]!.description);
    assert.ok(embed.fields.length > 0);
    assert.ok(embed.fields.every((field) => field.value.length <= 1024));
  });
});

describe("member text in the bot's posts", () => {
  test("the transcript post in the log channel pings nobody", async () => {
    const w = setup();
    const { row } = await open(w, "<@&120000000000000001> help");
    await mod.closeTicketAs(w.ctx, row.id, {}, actor);
    const posted = sentIn(w, LOG)[0];
    assert.deepEqual(posted?.options?.mentions, { users: [], roles: [] });
  });

  test("a reason typed into the close form cannot ping a role", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await tickets.modals!.closeReason!(interaction(ada, { channelId: ch.id, fields: { reason: "<@&120000000000000001> @everyone" } }) as never, {
      rest: String(row.id),
      ctx: w.ctx,
    });
    const closing = w.replies.find((reply) => reply.options.ephemeral === false);
    assert.ok(closing);
    assert.ok(!String(closing.values.reason).includes("<@&1"));
    assert.ok(!String(closing.values.reason).includes("@everyone"));
  });
});

describe("a kept channel", () => {
  test("is not deleted when the days are set to 0 after it closed", async () => {
    const w = setup({ general: { closeBehaviour: "archive", archiveDays: 7 } });
    const { row, channel: ch } = await open(w);
    await mod.closeTicketAs(w.ctx, row.id, {}, actor);
    setSettings(w, settingsOf({ general: { closeBehaviour: "archive", archiveDays: 0 } }));
    await prisma.ticket.update({ where: { id: row.id }, data: { closedAt: new Date(Date.now() - 30 * DAY) } });
    await tickets.tasks!.deleteArchived!({ ticketId: row.id }, w.ctx);
    assert.deepEqual(ch.deleted, []);
  });
});

describe("reopening", () => {
  test("is refused to an opener who was blocked since", async () => {
    const w = setup({ general: { closeBehaviour: "archive" } });
    const { row, channel: ch } = await open(w);
    await mod.closeTicketAs(w.ctx, row.id, {}, actor);
    setSettings(w, settingsOf({ general: { closeBehaviour: "archive", blocklist: { members: [ada.id, mallory.id] } } }));
    await tickets.components!.reopen!(interaction(ada, { channelId: ch.id }) as never, { rest: String(row.id), ctx: w.ctx });
    assert.match(refusalText(w) ?? "", /can't open tickets/);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).status, "closed");
  });
});

describe("/ticket remove", () => {
  test("cannot remove the opener", async () => {
    const w = setup();
    const { channel: ch } = await open(w);
    await tickets.commands![0]!.run(
      interaction(grace, { roles: [HANDLER], sub: "remove", users: { member: ada }, channelId: ch.id, component: false }) as never,
      w.ctx,
    );
    assert.match(refusalText(w) ?? "", /can't be removed/);
    assert.ok(ch.permissionOverwrites.cache.has(ada.id));
  });
});

describe("channel names", () => {
  test("keep letters of any alphabet and can carry the ticket's number", async () => {
    const { ticketChannelName } = await import("../dist/naming.js");
    assert.equal(ticketChannelName("Борис"), "ticket-борис");
    assert.equal(ticketChannelName("ゲーマー"), "ticket-ゲーマー");
    assert.equal(ticketChannelName("ada", "support-{number}", { number: 12 }), "support-12");
  });
});

describe("a rename Discord holds back", () => {
  test("says it is waiting, and is recorded when it goes through", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    ch.setName = (name: string) =>
      new Promise((resolve) =>
        setTimeout(() => {
          ch.name = name;
          resolve();
        }, 40),
      );
    const outcome = await working.rename(w.ctx, row, "billing question", actor, undefined, 5);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok ? null : outcome.refusal.key, "renameQueued");
    await new Promise((resolve) => setTimeout(resolve, 120));
    const now = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(now.channelName, "billing-question");
    assert.equal(await prisma.ticketEvent.count({ where: { ticketId: row.id, kind: "rename" } }), 1);
  });
});

describe("a panel's emoji", () => {
  test("from another server is refused before Discord refuses the post, and shows in health", async () => {
    const w = setup({}, { emoji: "<:gg:123456789012345678>" });
    await assert.rejects(mod.postPanel(w.ctx, "main", actor), /custom emoji from another server/);
    const facts = await mod.ticketHealthFacts(w.ctx);
    assert.equal(facts.panels[0]?.types[0]?.emojiMissing, true);
    assert.ok(ticketHealth(facts).some((issue) => issue.code === "typeEmojiMissing"));
  });
});

describe("a panel's state in Discord", () => {
  test("notices a deleted message, changed settings and a panel left in its old channel", async () => {
    const w = setup();
    await mod.postPanel(w.ctx, "main", actor);
    assert.equal((await mod.panelStatuses(w.ctx, { fresh: true }))[0]?.state, "posted");

    const changed = settingsOf();
    changed.panels[0]!.placeholder = "Something else";
    changed.panels[0]!.types[0]!.name = "Help";
    setSettings(w, changed);
    assert.equal((await mod.panelStatuses(w.ctx, { fresh: true }))[0]?.state, "changed");
    assert.ok(ticketHealth(await mod.ticketHealthFacts(w.ctx)).some((issue) => issue.code === "panelChanged"));

    const moved = settingsOf();
    const OTHER = "110000000000000099";
    w.add(channel(OTHER));
    moved.panels[0]!.channel = OTHER;
    setSettings(w, moved);
    const [away] = await mod.panelStatuses(w.ctx, { fresh: true });
    assert.equal(away?.state, "moved");
    assert.equal(away?.liveChannelId, PANEL_CHANNEL);
    const result = await mod.postPanel(w.ctx, "main", actor);
    assert.equal(result.movedFrom, PANEL_CHANNEL);
    assert.equal((await mod.panelStatuses(w.ctx, { fresh: true }))[0]?.state, "posted");

    w.channels.get(OTHER)!.sent = [];
    const [gone] = await mod.panelStatuses(w.ctx, { fresh: true });
    assert.equal(gone?.state, "messageDeleted");
    const facts = await mod.ticketHealthFacts(w.ctx);
    assert.equal(facts.panels[0]?.messageMissing, true);
    const summary = ticketHealthSummary(facts);
    assert.equal(summary.state, "allBlocked");
  });
});

describe("ticket numbers", () => {
  test("count per server, and the bot's messages use them", async () => {
    await prisma.guild.upsert({ where: { id: "100000000000000777" }, create: { id: "100000000000000777", name: "Other" }, update: {} });
    await prisma.ticket.create({ data: { guildId: "100000000000000777", channelId: "990000000000000001", openerId: ada.id, number: 41 } });
    const w = setup({ general: { ticketLimit: 3, channelName: "ticket-{number}" } }, { rules: {} });
    const first = await open(w, "one");
    const second = await open(w, "two");
    assert.equal(first.row.number, 1);
    assert.equal(second.row.number, 2);
    assert.equal(second.channel.name, "ticket-2");
    assert.equal(w.replies.at(-1)?.values.number, 2);
    assert.equal((await mod.getTicketDetail(w.ctx, second.row.id))?.number, 2);
  });
});

describe("when the opener leaves", () => {
  const leave = (w: World) => tickets.events!.memberLeave!({ id: ada.id, displayName: "ada", user: ada } as never, w.ctx);

  test("the ticket says so once and is marked", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    await leave(w);
    await leave(w);
    const notices = ch.sent.filter((message) => /left the server/.test(message.body?.embeds[0]?.description ?? ""));
    assert.equal(notices.length, 1);
    const now = await prisma.ticketEvent.findFirst({ where: { ticketId: row.id, kind: "opener_left" } });
    assert.ok(now);
    assert.ok((await mod.getTicketDetail(w.ctx, row.id))?.openerLeftAt);
  });

  test("closes the ticket when General says so", async () => {
    const w = setup({ general: { openerLeaves: "close" } });
    const { row } = await open(w);
    await leave(w);
    const closed = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(closed.status, "closed");
    assert.equal(closed.closeReason, "The opener left the server");
  });

  test("does nothing when General says to", async () => {
    const w = setup({ general: { openerLeaves: "nothing" } });
    const { row } = await open(w);
    await leave(w);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).openerLeftAt, null);
  });
});

describe("saved replies", () => {
  const saved = { savedReplies: [{ name: "Thanks", content: "Thanks {user}, ticket #{number} is with us." }] };

  test("/ticket reply sends one under the staff member's name with its variables filled", async () => {
    const w = setup(saved);
    const { row, channel: ch } = await open(w);
    await tickets.commands![0]!.run(
      interaction(grace, { roles: [HANDLER], sub: "reply", strings: { name: "thanks" }, channelId: ch.id, component: false }) as never,
      w.ctx,
    );
    const posted = ch.webhookSent.at(-1);
    assert.equal(posted?.content, `Thanks <@${ada.id}>, ticket #${row.number} is with us.`);
    assert.equal(await prisma.ticketMessage.count({ where: { ticketId: row.id, source: "dashboard" } }), 1);
  });

  test("an unknown name is refused, and autocomplete offers the names", async () => {
    const w = setup(saved);
    const { channel: ch } = await open(w);
    await tickets.commands![0]!.run(
      interaction(grace, { roles: [HANDLER], sub: "reply", strings: { name: "nope" }, channelId: ch.id, component: false }) as never,
      w.ctx,
    );
    assert.match(refusalText(w) ?? "", /no saved reply by that name/);
    let offered: unknown[] = [];
    await tickets.commands![0]!.autocomplete!(
      { options: { getFocused: () => ({ name: "name", value: "th" }) }, respond: async (choices: unknown[]) => void (offered = choices) } as never,
      w.ctx,
    );
    assert.deepEqual(offered, [{ name: "Thanks", value: "Thanks" }]);
  });
});

describe("working hours", () => {
  const hours = (days: { day: string; from: string; to: string }[], timeZone?: string) => ({ enabled: true, timeZone, days });
  // A Monday, 10:00 in London (summer time, UTC+1).
  const MONDAY_TEN = new Date("2026-06-01T09:00:00.000Z");

  test("are read in the server's time zone", () => {
    const weekdays = hours([{ day: "mon", from: "09:00", to: "17:00" }], "Europe/London");
    assert.equal(withinHours(weekdays, MONDAY_TEN), true);
    assert.equal(withinHours(weekdays, new Date("2026-06-01T16:30:00.000Z")), false);
    assert.equal(withinHours(hours([{ day: "mon", from: "09:00", to: "17:00" }]), new Date("2026-06-01T08:30:00.000Z")), false);
  });

  test("a row ending before it starts runs past midnight", () => {
    const night = hours([{ day: "mon", from: "22:00", to: "02:00" }]);
    assert.equal(withinHours(night, new Date("2026-06-01T23:00:00.000Z")), true);
    assert.equal(withinHours(night, new Date("2026-06-02T01:00:00.000Z")), true);
    assert.equal(withinHours(night, new Date("2026-06-02T03:00:00.000Z")), false);
  });

  test("off, or with no rows, every time counts as working hours", () => {
    assert.equal(withinHours({ enabled: false, days: [] }, MONDAY_TEN), true);
    assert.equal(withinHours(hours([]), MONDAY_TEN), true);
  });

  test("say when they next start, and an unknown zone reads as UTC", () => {
    const next = nextOpening(hours([{ day: "tue", from: "09:00", to: "17:00" }]), MONDAY_TEN);
    assert.equal(next?.toISOString(), "2026-06-02T09:00:00.000Z");
    assert.equal(zoneOf("Mars/Olympus"), "UTC");
  });

  test("a ticket opened outside them is told when the team is back", async () => {
    const today = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(new Date()).toLowerCase().slice(0, 3);
    const other = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].find((day) => day !== today)!;
    const w = setup({ automation: { hours: { enabled: true, timeZone: "UTC", days: [{ day: other, from: "09:00", to: "09:30" }] } } });
    const { channel: ch } = await open(w);
    const notice = ch.sent.find((message) => /working hours/.test(message.body?.embeds[0]?.description ?? ""));
    assert.ok(notice);
    assert.match(String(notice.values?.opens), /^<t:\d+:R>$/);
  });
});

describe("dashboard replies with files", () => {
  test("carry the files through the webhook", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const data = Buffer.from("gg wp").toString("base64");
    await mod.replyToTicket(w.ctx, row.id, "", actor, [{ name: "clip.txt", contentType: "text/plain", data }]);
    const sent = ch.webhookSent.at(-1) as { files?: { name?: string }[] } | undefined;
    assert.equal(sent?.files?.length, 1);
  });

  test("are refused over Discord's limit", async () => {
    const w = setup();
    const { row } = await open(w);
    const big = Buffer.alloc(9 * 1024 * 1024).toString("base64");
    await assert.rejects(mod.replyToTicket(w.ctx, row.id, "x", actor, [{ name: "big.bin", contentType: null, data: big }]), /more than 8 MB/);
  });
});

describe("the text transcript", () => {
  test("names mentions, shows the reason and uses the server's number", async () => {
    const { renderStoredTranscriptText } = await import("../dist/transcript-html.js");
    const text = renderStoredTranscriptText(
      {
        id: 900,
        number: 12,
        guildName: "Northwind",
        channelName: "ticket-ada",
        typeName: "Support",
        subject: null,
        status: "closed",
        priority: "low",
        openerId: ada.id,
        openerName: "ada",
        claimedByName: null,
        openedAt: new Date("2026-10-01T10:00:00Z"),
        closedAt: new Date("2026-10-01T11:00:00Z"),
        closedBy: grace.id,
        closedByName: "Grace",
        closeReason: "Fixed the queue bug",
        answers: [],
        rating: null,
      },
      [
        {
          messageId: "1",
          authorId: ada.id,
          authorName: "Ada [OCE]",
          authorAvatar: null,
          authorIsStaff: false,
          content: `hi <@${grace.id}> and <@&${HANDLER}>`,
          attachments: "[]",
          embeds: "[]",
          mentions: JSON.stringify({ users: { [grace.id]: { name: "Grace" } }, roles: { [HANDLER]: { name: "Support Team" } }, channels: {} }),
          createdAt: new Date("2026-10-01T10:05:00Z"),
          editedAt: null,
          deletedAt: null,
          edits: 0,
          source: "discord",
        },
      ],
    );
    assert.match(text, /^Ticket #12 /);
    assert.match(text, /Opened by Ada \[OCE\]/);
    assert.match(text, /Reason: Fixed the queue bug/);
    assert.match(text, /hi @Grace and @Support Team/);
  });
});

describe("the first response", () => {
  test("records who gave it, for the per-handler stats", async () => {
    const w = setup();
    const { row } = await open(w);
    await mod.replyToTicket(w.ctx, row.id, "on it", actor);
    assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } })).firstResponderId, grace.id);
  });
});

describe("adding a member by name", () => {
  test("finds the one member with that name", async () => {
    const w = setup();
    const { row, channel: ch } = await open(w);
    const frag = w.addMember(member(user("130000000000000041", "fragmuffin")));
    await mod.changeTicketMember(w.ctx, row.id, { userId: "", action: "add", name: "FragMuffin" }, actor);
    assert.ok(ch.permissionOverwrites.cache.has(frag.id));
    await assert.rejects(mod.changeTicketMember(w.ctx, row.id, { userId: "", action: "add", name: "nobody-here" }, actor), /Nobody in this server/);
  });
});
