import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { REPLY_COLOR, applyVariablesToMessage, parseMessage, type MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";
import { moderationSettingsWith } from "./settings-helper.ts";
import { formatModLogEntry } from "./legacy-view.ts";

const GUILD = "100000000000000040";
const OWNER = "100000000000000041";
const BOT = "100000000000000042";
const ACTOR = "100000000000000043";
const TARGET = "100000000000000044";
const CHANNEL = "100000000000000045";
const MESSAGE = "100000000000000046";

const db = createTestDatabase();
const { prisma, createInfraction } = await import("@tier0/db");
const { submitContextAction, contextCommands } = await import("../dist/commands/context.js");
const { historyCommand } = await import("../dist/commands/history.js");
const { caseCommand } = await import("../dist/commands/case.js");
const { purgeCommand } = await import("../dist/commands/purge.js");
const { timeoutCommand } = await import("../dist/commands/timeout.js");
const { banCommand } = await import("../dist/commands/ban.js");
const { warnCommand } = await import("../dist/commands/warn.js");
const { kickCommand } = await import("../dist/commands/kick.js");
const { unbanCommand } = await import("../dist/commands/unban.js");
const { CASE_REPLY } = await import("../dist/messages.js");
const { noticeValues } = await import("../dist/modlog.js");

interface World {
  /** What was answered, as plain text once the variables were filled in. */
  said: string[];
  /** The whole filled-in message, for the ones with more than text. */
  bodies: MessageBody[];
  dms: string[];
  discord: string[];
  members: Map<string, ReturnType<typeof member>>;
}

let world: World;

function member(id: string, options: { top?: number; perms?: bigint[] } = {}) {
  const perms = options.perms ?? [];
  return {
    id,
    roles: { highest: { position: options.top ?? 1 } },
    permissions: { has: (flag: bigint) => perms.includes(flag) },
    moderatable: true,
    kickable: true,
    bannable: true,
    isCommunicationDisabled: () => true,
    timeout: async () => {
      world.discord.push(`timeout ${id}`);
    },
    kick: async () => {
      world.discord.push(`kick ${id}`);
    },
  };
}

const ALL = [PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers];

/** What a message says as a sentence: its text, or the description of an embed that is only a sentence, as the stock replies are. */
function sentence(body: MessageBody): string {
  const [embed] = body.embeds;
  const plain = embed !== undefined && body.embeds.length === 1 && !embed.title && embed.fields.length === 0;
  return body.content || (plain ? embed.description : "");
}

/** Fills a message the way sending it would, without sending. */
function render(body: MessageBody, values: Record<string, string | number>): MessageBody {
  const strings = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
  const filled = parseMessage(applyVariablesToMessage(body, { server: "Test Server", ...strings }));
  assert.ok(filled.ok, "a filled-in message must still be sendable");
  return filled.value;
}

function context(stored: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    members: {
      me: { roles: { highest: { position: 10 } } },
      fetch: async (id: string) => {
        const found = world.members.get(id);
        if (!found) throw Object.assign(new Error("Unknown Member"), { code: 10007 });
        return found;
      },
      ban: async (id: string) => {
        world.discord.push(`ban ${id}`);
      },
    },
    bans: {
      fetch: async () => {
        throw Object.assign(new Error("Unknown Ban"), { code: 10026 });
      },
    },
    channels: { cache: new Map(), fetch: async () => null },
  };
  return {
    client: { user: { id: BOT }, users: { fetch: async (id: string) => ({ id, username: "samuel" }) } },
    guild,
    settings: { ...moderationSettingsWith(stored), modLogChannel: null },
    tasks: { schedule: async () => undefined, cancel: async () => 0 },
    dashboardUrl: async () => "",
    send: async (target: { id: string }, body: MessageBody) => {
      world.dms.push(sentence(body));
      return {};
    },
    reply: async (_interaction: unknown, body: MessageBody, values: Record<string, string | number> = {}) => {
      const filled = render(body, values);
      world.said.push(sentence(filled));
      world.bodies.push(filled);
      return true;
    },
    ...extra,
  } as never;
}

function modalSubmit(fields: Record<string, string>, user = ACTOR) {
  return {
    user: { id: user },
    replied: false,
    deferred: false,
    fields: { getTextInputValue: (name: string) => fields[name] ?? "" },
  } as never;
}

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Wording test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  world = {
    said: [],
    bodies: [],
    dms: [],
    discord: [],
    members: new Map([
      [TARGET, member(TARGET)],
      [ACTOR, member(ACTOR, { top: 5, perms: ALL })],
    ]),
  };
  await prisma.infraction.deleteMany();
  await prisma.guild.update({ where: { id: GUILD }, data: { caseCounter: 0 } });
  await prisma.staffMember.deleteMany();
  await prisma.staffMember.create({ data: { guildId: GUILD, userId: ACTOR, role: "admin", addedBy: OWNER } });
});

describe("the right-click confirmations", () => {
  const submit = (action: string, fields: Record<string, string>, stored: Record<string, unknown> = {}, rest = `${action}:${TARGET}`) =>
    submitContextAction(modalSubmit({ reason: "", duration: "", ...fields }), { rest, ctx: context(stored) } as never);

  test("say what they always said until the owner writes another", async () => {
    await submit("warn", { reason: "spam" });
    await submit("kick", {});
    assert.match(world.said[0]!, /^Warned samuel\. Case #1\.$/);
    assert.match(world.said[1]!, /^Kicked samuel\. Case #2\.$/);

    await submit("timeout", { duration: "10m" });
    const until = Math.floor((await prisma.infraction.findFirstOrThrow({ where: { action: "timeout" } })).expiresAt!.getTime() / 1000);
    assert.equal(world.said[2], `Timed out samuel until <t:${until}:f>. Case #3.`);

    await submit("ban", {});
    assert.equal(world.said[3], "Banned samuel. Case #4.");
  });

  test("a temporary ban says when it ends, and the notes follow the case number", async () => {
    world.members.delete(TARGET);
    await submit("ban", { duration: "7d" });
    const row = await prisma.infraction.findFirstOrThrow({ where: { action: "ban" } });
    const at = Math.floor(row.expiresAt!.getTime() / 1000);
    assert.equal(
      world.said[0],
      `Banned samuel. It expires <t:${at}:R>. Case #1. They are not in the server, so the ban stops them from joining again. They are not in the server, so they were not sent a direct message.`,
    );
  });

  test("use the owner's message, with every variable on offer", async () => {
    const stored = { replies: { confirmations: { contextWarned: "{name} noted: #{case}{notes}" } }, labels: { actions: { memberFallback: "someone" } } };
    await submit("warn", {}, stored);
    assert.equal(world.said[0], "samuel noted: #1");
  });

  test("a member who cannot be looked up is named by the owner's fallback wording", async () => {
    const ctx = context({ labels: { actions: { memberFallback: "that person" } } }, {});
    (ctx as unknown as { client: { users: { fetch: () => Promise<never> } } }).client.users.fetch = async () => {
      throw new Error("Unknown User");
    };
    await submitContextAction(modalSubmit({ reason: "", duration: "" }), { rest: `warn:${TARGET}`, ctx } as never);
    assert.equal(
      world.said[0],
      "Warned that person. Case #1. They could not be sent a direct message, most likely because they do not accept messages from the bot.",
    );
  });

  test("refusals use the owner's wording where there is some", async () => {
    await submit("warn", {}, { replies: { staff: { menuOutOfDate: "Reopen the menu." } } }, "nonsense");
    assert.equal(world.said[0], "Reopen the menu.");

    await prisma.staffMember.deleteMany();
    await submit("warn", {});
    assert.equal(world.said[1], "Only moderators on this server's staff list can use this. Ask the server owner to add you on the Access tab of the dashboard.");

    await prisma.staffMember.create({ data: { guildId: GUILD, userId: ACTOR, role: "mod", addedBy: OWNER } });
    await submit("ban", {}, { labels: { abilities: { ban: "verbannen" } } });
    assert.equal(world.said[2], "You need to be an admin to verbannen. A moderator can warn and time members out.");
  });

  test("a refusal from the action itself is looked up by its code", async () => {
    await submit("warn", { reason: "x".repeat(501) });
    assert.equal(world.said[0], "A reason can be at most 500 characters.");
    await submit("timeout", { duration: "soon" });
    assert.equal(world.said[1], "Duration must look like 10m, 2h or 7d.");
    await submit("ban", { duration: "soon" });
    assert.equal(world.said[2], "Duration must look like 1d or 7d.");
    await submit("warn", {}, { replies: { refusals: { targetOwner: "Hands off." } } }, `warn:${OWNER}`);
    assert.equal(world.said[3], "Hands off.");
  });
});

describe("the right-click forms", () => {
  async function form(name: string, stored: Record<string, unknown> = {}, target: Record<string, unknown> = {}) {
    const entry = contextCommands.find((candidate) => candidate.name === name)!;
    let shown: { data: { title?: string; custom_id?: string; components?: { components: { label?: string; placeholder?: string; required?: boolean }[] }[] } } | undefined;
    const base = {
      user: { id: ACTOR },
      targetUser: { id: TARGET, username: "samuel" },
      isUserContextMenuCommand: () => name.endsWith("member"),
      isMessageContextMenuCommand: () => name.endsWith("author"),
      targetMessage: { webhookId: null, channelId: CHANNEL, id: MESSAGE, author: { id: TARGET, username: "samuel" } },
      showModal: async (modal: { toJSON(): never }) => {
        shown = { data: modal.toJSON() };
      },
      replied: false,
      deferred: false,
      ...target,
    };
    await entry.run(base as never, context(stored));
    return shown;
  }

  test("are titled and labelled as they always were", async () => {
    const warn = (await form("Warn member"))!.data;
    assert.equal(warn.title, "Warn samuel");
    const [reason] = warn.components!.map((row) => row.components[0]!);
    assert.deepEqual([reason!.label, reason!.placeholder], ["Reason", "Why"]);
    assert.equal(warn.components!.length, 1);

    const timeout = (await form("Timeout member"))!.data;
    assert.equal(timeout.title, "Time out samuel");
    const length = timeout.components![1]!.components[0]!;
    assert.deepEqual([length.label, length.placeholder], ["How long", "10m, 2h or 7d. Empty uses the server's default."]);

    const ban = (await form("Ban author"))!.data;
    assert.equal(ban.title, "Ban samuel");
    assert.equal(ban.components![0]!.components[0]!.placeholder, "Why. The message is saved with the case.");
    const banLength = ban.components![1]!.components[0]!;
    assert.deepEqual([banLength.label, banLength.placeholder], ["How long (empty is permanent)", "1d or 7d. Empty is permanent."]);
  });

  test("take the owner's titles, boxes and hints, and keep a title within Discord's limit", async () => {
    const stored = {
      labels: {
        menu: { menuWarn: "Verwarnen", modalTitle: "{verb}: {name}", reasonLabel: "Grund", reasonPlaceholder: "Warum", timeoutLabel: "Wie lange" },
      },
    };
    const warn = (await form("Warn member", stored))!.data;
    assert.equal(warn.title, "Verwarnen: samuel");
    assert.deepEqual([warn.components![0]!.components[0]!.label, warn.components![0]!.components[0]!.placeholder], ["Grund", "Warum"]);
    assert.equal((await form("Timeout member", stored))!.data.components![1]!.components[0]!.label, "Wie lange");

    const long = (await form("Warn member", {}, { targetUser: { id: TARGET, username: "n".repeat(60) } }))!.data;
    assert.equal(long.title!.length, 45);
  });

  test("refuse before opening a form, in the owner's words", async () => {
    const stored = { replies: { staff: { menuSelf: "Not yourself.", menuBot: "Not the bot.", menuNotAMember: "No member there." } } };
    await form("Warn member", stored, { targetUser: { id: ACTOR, username: "me" } });
    await form("Warn member", stored, { targetUser: { id: BOT, username: "bot" } });
    await form("Warn author", stored, { targetMessage: { webhookId: "123", channelId: CHANNEL, id: MESSAGE, author: { id: TARGET } } });
    assert.deepEqual(world.said, ["Not yourself.", "Not the bot.", "No member there."]);
  });

  test("keep today's wording when nothing is changed", async () => {
    await form("Warn member", {}, { targetUser: { id: ACTOR, username: "me" } });
    await form("Warn member", {}, { targetUser: { id: BOT, username: "bot" } });
    assert.deepEqual(world.said, ["You cannot take an action on yourself.", "That is this bot. There is nothing to do."]);
  });
});

describe("history, cases and timeouts", () => {
  const interactionFor = (options: Record<string, unknown>) =>
    ({
      user: { id: ACTOR },
      replied: false,
      deferred: false,
      options: {
        getUser: () => ({ id: TARGET, username: "samuel" }),
        getInteger: () => options.number,
        getString: (name: string) => (options[name] as string | undefined) ?? null,
        getSubcommand: () => options.sub,
      },
      reply: async () => undefined,
    }) as never;

  test("/history lists the record in the stock look, and says so when there is none", async () => {
    await historyCommand.run(interactionFor({}), context());
    assert.equal(world.said[0], "samuel has no recorded history.");

    await createInfraction({ guildId: GUILD, userId: TARGET, moderatorId: ACTOR, action: "ban", reason: "Raiding", active: false });
    await createInfraction({ guildId: GUILD, userId: TARGET, moderatorId: ACTOR, action: "warn" });
    await historyCommand.run(interactionFor({}), context());
    const embed = world.bodies[1]!.embeds[0]!;
    assert.equal(embed.title, "Moderation history for samuel");
    const lines = embed.description.split("\n");
    assert.match(lines[0]!, /^\*\*#2\*\* Warned - No reason given - <t:\d+:d>$/);
    assert.match(lines[1]!, /^\*\*#1\*\* Banned \(reversed\) - Raiding - <t:\d+:d>$/);
  });

  test("/history uses the owner's line", async () => {
    await createInfraction({ guildId: GUILD, userId: TARGET, moderatorId: ACTOR, action: "warn", reason: "Spam" });
    await historyCommand.run(interactionFor({}), context({ labels: { history: { line: "{case}/{action}/{reason}" }, actions: { warned: "Verwarnt" } } }));
    assert.equal(world.bodies[0]!.embeds[0]!.description, "1/Verwarnt/Spam");
  });

  test("/case says there is no such case, and shows a case as it always did", async () => {
    await caseCommand.run(interactionFor({ number: 7 }), context());
    assert.equal(world.said[0], "There is no case #7.");

    const row = await createInfraction({ guildId: GUILD, userId: TARGET, moderatorId: ACTOR, action: "timeout", reason: "Spam", expiresAt: new Date("2030-01-01T00:00:00Z"), active: false });
    await caseCommand.run(interactionFor({ number: row.caseNumber }), context());
    const shown = world.bodies[1]!;
    const old = formatModLogEntry({
      caseNumber: row.caseNumber,
      action: "timeout",
      targetId: TARGET,
      moderatorId: ACTOR,
      reason: "Spam",
      expiresAt: row.expiresAt,
    });
    const embed = shown.embeds[0]!;
    assert.equal(embed.title, old.title);
    assert.deepEqual(
      embed.fields.map((field) => [field.name, field.value]),
      old.fields.map((field) => [field.name, field.value]),
    );
    assert.equal(embed.footerText, "This action has since been reversed.");
    assert.equal(embed.timestamp, row.createdAt.toISOString());
    assert.equal(CASE_REPLY.placeholders.some((placeholder) => placeholder.name === "moderatorLine"), true);
    assert.equal(noticeValues({ action: "warn", reason: null, expiresAt: null, moderatorId: "1", moderatorName: "Automod" }).moderatorLine, "Automod");
  });

  test("/case shows an automod case with just Automod as the moderator", async () => {
    const row = await createInfraction({ guildId: GUILD, userId: TARGET, moderatorId: BOT, action: "automod-delete", reason: "invites: x" });
    await caseCommand.run(interactionFor({ number: row.caseNumber }), context({ labels: { actions: { automod: "Autoregeln" } } }));
    const moderator = world.bodies[0]!.embeds[0]!.fields.find((field) => field.name === "Moderator");
    assert.equal(moderator?.value, "Autoregeln");
  });

  test("a case with a very long reason is still shown", async () => {
    const row = await createInfraction({ guildId: GUILD, userId: TARGET, moderatorId: ACTOR, action: "warn", reason: "r".repeat(2000) });
    await caseCommand.run(interactionFor({ number: row.caseNumber }), context());
    assert.equal(world.bodies.length, 1);
    const reason = world.bodies[0]!.embeds[0]!.fields.find((field) => field.name === "Reason");
    assert.equal(reason!.value.length, 1024);
  });

  test("/timeout clear has a reply of its own, and the replies to the other commands start as they were", async () => {
    world.members.set(TARGET, member(TARGET));
    await timeoutCommand.run(interactionFor({ sub: "clear" }), context());
    assert.equal(world.said[0], "Cleared samuel's timeout. Case #1.");

    await timeoutCommand.run(interactionFor({ sub: "clear" }), context({ replies: { confirmations: { timeoutCleared: "{user} is free (#{case})" } } }));
    assert.equal(world.said[1], "samuel is free (#2)");

    await timeoutCommand.run(interactionFor({ sub: "set", duration: "5m" }), context());
    assert.match(world.said[2]!, /^Timed out samuel until <t:\d+:f>\. Case #3\.$/);
    assert.equal(world.bodies[0]?.embeds[0]?.color, REPLY_COLOR.success);
    assert.equal(world.bodies[2]?.embeds[0]?.color, REPLY_COLOR.success);
  });

  test("the replies that confirm an action start as green embeds", () => {
    for (const command of [warnCommand, kickCommand, banCommand, unbanCommand, timeoutCommand]) {
      const starting = command.response!.starting;
      assert.equal(starting.content, "", command.name);
      assert.equal(starting.embeds.length, 1, command.name);
      assert.equal(starting.embeds[0]?.color, REPLY_COLOR.success, command.name);
    }
    assert.equal(purgeCommand.response!.starting.embeds[0]?.color, REPLY_COLOR.success);
  });

  test("/timeout set and /ban say what the length could not be read as", async () => {
    await timeoutCommand.run(interactionFor({ sub: "set", duration: "soon" }), context());
    assert.equal(world.said[0], "Duration must look like 10m, 2h or 7d.");
    await banCommand.run(interactionFor({ duration: "soon" }), context({ replies: { refusals: { durationUnreadableBan: "Try 1d." } } }));
    assert.equal(world.said[1], "Try 1d.");
  });

  test("the owner's own reply to a command wins over the stock one", async () => {
    const custom = { content: "Custom for {user}", embeds: [], buttons: [], selects: [], reactions: [] } as MessageBody;
    const replies: unknown[] = [];
    const ctx = context({}, { customReply: (values: Record<string, string>) => ({ content: render(custom, values).content }) });
    const interaction = interactionFor({ duration: "7d" }) as unknown as { reply: (payload: unknown) => Promise<void> };
    interaction.reply = async (payload: unknown) => {
      replies.push(payload);
    };
    await banCommand.run(interaction as never, ctx);
    assert.equal((replies[0] as { content: string }).content, "Custom for samuel");
    assert.deepEqual(world.said, []);
  });
});

describe("/purge", () => {
  function purgeInteraction(options: { allowed?: boolean; messages?: { createdTimestamp: number; delete(): Promise<void> }[]; bulk?: boolean }) {
    const fetched = new Map((options.messages ?? []).map((message, index) => [String(index), message]));
    const collection = Object.assign(fetched, {
      filter: (predicate: (message: { createdTimestamp: number }) => boolean) => {
        const kept = new Map([...fetched].filter(([, message]) => predicate(message)));
        return Object.assign(kept, { first: () => [...kept.values()][0], filter: undefined });
      },
    });
    const channel = {
      isTextBased: () => true,
      messages: { fetch: async () => collection },
      bulkDelete: async (eligible: Map<string, unknown>) => {
        if (options.bulk === false) throw new Error("Missing Access");
        return new Map(eligible);
      },
      name: "general",
    };
    const calls: string[] = [];
    return {
      calls,
      channel,
      interaction: {
        user: { id: ACTOR, username: "ada" },
        channelId: CHANNEL,
        replied: false,
        deferred: false,
        memberPermissions: { has: () => options.allowed ?? true },
        options: { getInteger: () => 5 },
        deferReply: async () => {
          calls.push("defer");
        },
        editReply: async (payload: unknown) => {
          calls.push(`edit ${JSON.stringify(payload)}`);
        },
        reply: async () => undefined,
      } as never,
    };
  }

  const fresh = (): { createdTimestamp: number; delete(): Promise<void> } => ({ createdTimestamp: Date.now(), delete: async () => undefined });
  const old = (): { createdTimestamp: number; delete(): Promise<void> } => ({ createdTimestamp: Date.now() - 20 * 86_400_000, delete: async () => undefined });

  function purgeContext(stored: Record<string, unknown>, channel: unknown) {
    const ctx = context(stored) as unknown as { guild: { channels: { fetch: () => Promise<unknown> } } };
    ctx.guild.channels.fetch = async () => channel;
    return ctx as never;
  }

  test("each refusal and empty state starts as it was", async () => {
    const denied = purgeInteraction({ allowed: false });
    await purgeCommand.run(denied.interaction, purgeContext({}, denied.channel));
    const nothing = purgeInteraction({ messages: [old(), old()] });
    await purgeCommand.run(nothing.interaction, purgeContext({}, nothing.channel));
    const failing = purgeInteraction({ messages: [fresh(), fresh()], bulk: false });
    await purgeCommand.run(failing.interaction, purgeContext({}, failing.channel));
    const noChannel = purgeInteraction({});
    await purgeCommand.run(noChannel.interaction, purgeContext({}, null));
    assert.deepEqual(world.said, [
      "You need the Manage Messages permission to delete messages.",
      "None of those messages can be bulk deleted: Discord only allows deleting messages sent in the last 14 days.",
      "I could not delete those messages. Check my permissions in this channel.",
      "This command only works in a server text channel.",
    ]);
  });

  test("the count and the note about old messages are worded by the labels", async () => {
    const mixed = purgeInteraction({ messages: [fresh(), fresh(), old()] });
    await purgeCommand.run(mixed.interaction, purgeContext({}, mixed.channel));
    assert.equal(world.said[0], "Deleted 2 messages. 1 message was left because it is older than 14 days.");

    const custom = purgeInteraction({ messages: [fresh(), fresh(), old(), old()] });
    await purgeCommand.run(
      custom.interaction,
      purgeContext({ labels: { counts: { messageMany: "{count} Nachrichten", skippedMany: "{count} blieben, weil sie zu alt sind." } } }, custom.channel),
    );
    assert.equal(world.said[1], "Deleted 2 Nachrichten. 2 blieben, weil sie zu alt sind.");
  });
});
