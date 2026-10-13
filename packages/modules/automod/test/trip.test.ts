import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readEvidence, takeDeletionNote, clearDeletionNotes } from "@tier0/core";
import { createTestDatabase } from "../../moderation/test/db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: automod } = await import("../dist/index.js");
const { settings } = await import("../dist/settings.js");
const { RECOMMENDED_ACTIONS } = await import("../dist/settings.js");

const GUILD = "100000000000000060";
const CHANNEL = "100000000000000061";
const LOG_CHANNEL = "100000000000000062";
const MEMBER = "100000000000000063";
const BOT = "100000000000000064";

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Automod test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

interface Sent {
  target: string;
  body: { content: string };
  values: Record<string, string>;
  options: { fallback?: { content: string }; mentions?: { users?: string[]; roles?: string[] } };
}

function setup(options: {
  deleteFails?: boolean;
  timeoutFails?: boolean;
  moderatable?: boolean;
  actions?: string[];
  dashboard?: string;
  content?: string;
  messageId: string;
  stored?: Record<string, unknown>;
  dmFails?: boolean;
}) {
  const sent: Sent[] = [];
  const calls: string[] = [];
  const timeoutReasons: (string | undefined)[] = [];
  const parsed = settings.parse({
    logChannel: LOG_CHANNEL,
    bannedWords: { enabled: true, actions: options.actions ?? ["delete"], words: ["badword", "other thing"] },
    ...options.stored,
  });
  assert.ok(parsed.ok);

  const logChannel = { id: LOG_CHANNEL, isTextBased: () => true };
  const channel = { id: CHANNEL, name: "general", isTextBased: () => true, isDMBased: () => false, isThread: () => false };
  const member = {
    id: MEMBER,
    displayName: "LuxTester",
    roles: { cache: new Map() },
    permissions: { has: () => false },
    moderatable: options.moderatable ?? true,
    timeout: async (ms: number, reason?: string) => {
      calls.push(`timeout:${ms}`);
      timeoutReasons.push(reason);
      if (options.timeoutFails) throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
    },
  };
  const ctx = {
    client: { user: { id: BOT } },
    guild: { id: GUILD, channels: { cache: new Map([[LOG_CHANNEL, logChannel]]) } },
    settings: parsed.value,
    dashboardUrl: async () => options.dashboard ?? "",
    send: async (target: { id: string }, body: { content: string }, values: Record<string, string>, sendOptions: Sent["options"]) => {
      if (options.dmFails && target.id === MEMBER) return null;
      sent.push({ target: target.id, body, values, options: sendOptions });
      return { delete: async () => undefined };
    },
  };
  const message = {
    id: options.messageId,
    guild: { id: GUILD, members: { fetch: async () => member } },
    author: { id: MEMBER, bot: false, username: "luxtester" },
    member,
    content: options.content ?? "you badword, and then some other thing too",
    channel,
    channelId: CHANNEL,
    createdTimestamp: Date.now() - 1000,
    attachments: new Map([["a", { name: "evidence.png", url: "https://cdn.example/evidence.png", contentType: "image/png" }]]),
    delete: async () => {
      calls.push("delete");
      if (options.deleteFails) throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
    },
  };
  return { ctx, message, sent, calls, timeoutReasons };
}

const recordFor = (messageId: string) =>
  prisma.infraction.findFirst({ where: { guildId: GUILD, userId: MEMBER, evidence: { contains: messageId } } });

describe("a message that trips a rule", () => {
  test("is kept with the case as evidence, with the banned words that matched, and linked from the log", async () => {
    const { ctx, message, sent } = setup({ messageId: "100000000000000070", dashboard: "https://bot.example.com" });
    await automod.events!.messageCreate!(message as never, ctx as never);

    const row = await recordFor("100000000000000070");
    assert.ok(row);
    assert.equal(row.action, "automod-delete");
    assert.equal(row.reason, "bannedWords: Used a banned word or phrase (matched `badword`, `other thing`)");

    const [kept] = readEvidence(row.evidence);
    assert.equal(kept?.id, "100000000000000070");
    assert.equal(kept?.channelName, "general");
    assert.equal(kept?.content, "you badword, and then some other thing too");
    assert.equal(kept?.deleted, true);
    assert.ok(kept?.deletedAt);
    assert.equal(kept?.attachments[0]?.name, "evidence.png");

    const log = sent.find((s) => s.target === LOG_CHANNEL);
    assert.equal(log?.values.match, "`badword`, `other thing`");
    assert.equal(log?.values.case, String(row.caseNumber));
    assert.equal(log?.values.caseUrl, `https://bot.example.com/guilds/${GUILD}/mod/members/${MEMBER}?case=${row.caseNumber}`);
  });

  test("is kept as evidence even when the delete failed, and then is not marked deleted", async () => {
    const { ctx, message } = setup({ messageId: "100000000000000071", deleteFails: true });
    const original = console.error;
    console.error = () => undefined;
    try {
      await automod.events!.messageCreate!(message as never, ctx as never);
    } finally {
      console.error = original;
    }
    const row = await recordFor("100000000000000071");
    assert.ok(row);
    assert.equal(row.action, "automod-warn");
    assert.match(row.reason ?? "", /Could not delete the message: missing permission/);
    const [kept] = readEvidence(row.evidence);
    assert.equal(kept?.deleted, false);
    assert.equal(kept?.deletedAt, null);
    assert.equal(kept?.content, "you badword, and then some other thing too");
  });

  test("keeps the earlier versions of an edit and flags the one that broke the rule, with no address known", async () => {
    const { ctx, message, sent } = setup({ messageId: "100000000000000072", content: "now a badword" });
    await automod.events!.messageUpdate!({ content: "hello" } as never, message as never, ctx as never);
    const row = await recordFor("100000000000000072");
    assert.ok(row);
    const [kept] = readEvidence(row.evidence);
    assert.deepEqual(kept?.versions?.map((v) => v.content), ["hello", "now a badword"]);
    assert.equal(kept?.flagged, 1);
    assert.equal(sent.find((s) => s.target === LOG_CHANNEL)?.values.caseUrl, "");
  });

  test("never puts the message in anything the channel can read", async () => {
    const { ctx, message, sent } = setup({ messageId: "100000000000000073", dashboard: "https://bot.example.com" });
    await automod.events!.messageCreate!(message as never, ctx as never);
    const notice = sent.find((s) => s.target === CHANNEL);
    assert.ok(notice);
    assert.ok(!Object.values(notice.values).some((v) => v.includes("badword") || v.includes("other thing") || v.includes("bot.example.com")));
  });
});

describe("a rule set to do several things", () => {
  const NOTICE = (sent: Sent[]) => sent.find((s) => s.target === CHANNEL)?.values;
  const LOG = (sent: Sent[]) => sent.find((s) => s.target === LOG_CHANNEL)?.values;
  let next = 100;
  const id = () => `1000000000000001${String(next++).padStart(2, "0")}`;

  async function run(options: Omit<Parameters<typeof setup>[0], "messageId">) {
    const messageId = id();
    const made = setup({ ...options, messageId });
    await automod.events!.messageCreate!(made.message as never, made.ctx as never);
    const row = await recordFor(messageId);
    assert.ok(row);
    const [kept] = readEvidence(row.evidence);
    return { ...made, row, kept, messageId };
  }

  test("warn alone records a warning and leaves the message", async () => {
    const { calls, row, kept, sent } = await run({ actions: ["warn"] });
    assert.deepEqual(calls, []);
    assert.equal(row.action, "automod-warn");
    assert.equal(row.active, false);
    assert.equal(kept?.deleted, false);
    assert.equal(NOTICE(sent)?.outcome, "that message tripped automod");
  });

  test("delete alone removes the message", async () => {
    const { calls, row, kept, sent } = await run({ actions: ["delete"] });
    assert.deepEqual(calls, ["delete"]);
    assert.equal(row.action, "automod-delete");
    assert.equal(kept?.deleted, true);
    assert.equal(NOTICE(sent)?.outcome, "your message was removed");
  });

  test("timeout alone times the member out and leaves the message", async () => {
    const { calls, row, kept, sent } = await run({ actions: ["timeout"] });
    assert.deepEqual(calls, ["timeout:600000"]);
    assert.equal(row.action, "automod-timeout");
    assert.equal(row.active, true);
    assert.ok(row.expiresAt);
    assert.equal(kept?.deleted, false);
    assert.equal(NOTICE(sent)?.outcome, "you were timed out");
    assert.equal(NOTICE(sent)?.duration, "10 minutes");
  });

  test("delete and warn removes the message and is filed as a warning", async () => {
    const { calls, row, sent } = await run({ actions: ["delete", "warn"] });
    assert.deepEqual(calls, ["delete"]);
    assert.equal(row.action, "automod-warn");
    assert.equal(NOTICE(sent)?.outcome, "your message was removed and you were warned");
    assert.equal(LOG(sent)?.action, "delete and warn");
  });

  test("delete and timeout does both, as the old timeout preset did", async () => {
    const { calls, row, sent } = await run({ actions: ["delete", "timeout"] });
    assert.deepEqual(calls, ["delete", "timeout:600000"]);
    assert.equal(row.action, "automod-timeout");
    assert.equal(row.active, true);
    assert.equal(NOTICE(sent)?.outcome, "your message was removed and you were timed out");
  });

  test("warn and timeout leaves the message", async () => {
    const { calls, row, kept, sent } = await run({ actions: ["warn", "timeout"] });
    assert.deepEqual(calls, ["timeout:600000"]);
    assert.equal(row.action, "automod-timeout");
    assert.equal(kept?.deleted, false);
    assert.equal(NOTICE(sent)?.outcome, "you were warned and timed out");
  });

  test("all three, with one case for the trip", async () => {
    const { calls, row, sent, messageId } = await run({ actions: ["delete", "warn", "timeout"] });
    assert.deepEqual(calls, ["delete", "timeout:600000"]);
    assert.equal(row.action, "automod-timeout");
    assert.equal(NOTICE(sent)?.outcome, "your message was removed, and you were warned and timed out");
    assert.equal(LOG(sent)?.case, String(row.caseNumber));
    const cases = await prisma.infraction.count({ where: { guildId: GUILD, userId: MEMBER, evidence: { contains: messageId } } });
    assert.equal(cases, 1);
  });

  test("a timeout the bot cannot give degrades to what did happen", async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      const { row, kept, sent } = await run({ actions: ["delete", "warn", "timeout"], timeoutFails: true });
      assert.equal(row.action, "automod-warn");
      assert.equal(row.active, false);
      assert.equal(row.expiresAt, null);
      assert.match(row.reason ?? "", /Could not time out: missing permission/);
      assert.equal(kept?.deleted, true);
      assert.equal(NOTICE(sent)?.outcome, "your message was removed and you were warned");
      assert.equal(NOTICE(sent)?.duration, "");
      assert.match(LOG(sent)?.problems ?? "", /Could not time out/);
    } finally {
      console.error = original;
    }
  });

  test("a member the bot cannot moderate is not timed out, and is never asked to be", async () => {
    const { calls, row, sent } = await run({ actions: ["delete", "timeout"], moderatable: false });
    assert.deepEqual(calls, ["delete"]);
    assert.equal(row.action, "automod-delete");
    assert.equal(NOTICE(sent)?.outcome, "your message was removed");
  });

  test("a warning alone is still recorded when the timeout it came with fails", async () => {
    const { row, sent } = await run({ actions: ["warn", "timeout"], timeoutFails: true });
    assert.equal(row.action, "automod-warn");
    assert.equal(NOTICE(sent)?.outcome, "that message tripped automod");
  });
});

describe("the audit trail of an automod case", () => {
  let next = 200;
  const id = () => `1000000000000002${String(next++).padStart(2, "0")}`;

  async function trip(options: Omit<Parameters<typeof setup>[0], "messageId">) {
    const messageId = id();
    const made = setup({ ...options, messageId });
    await automod.events!.messageCreate!(made.message as never, made.ctx as never);
    const row = await recordFor(messageId);
    assert.ok(row);
    const audit = await prisma.modAudit.findMany({ where: { infractionId: row.id } });
    return { ...made, row, audit };
  }

  const cases: Array<[string, string[], string]> = [
    ["warn", ["warn"], "Automod warned LuxTester (case #N): Used a banned word or phrase (matched badword, other thing)"],
    ["delete", ["delete"], "Automod deleted a message from LuxTester (case #N): Used a banned word or phrase (matched badword, other thing)"],
    ["timeout", ["timeout"], "Automod timed out LuxTester (case #N): Used a banned word or phrase (matched badword, other thing)"],
    ["delete and warn", ["delete", "warn"], "Automod deleted a message from LuxTester and warned them (case #N): Used a banned word or phrase (matched badword, other thing)"],
    ["delete and timeout", ["delete", "timeout"], "Automod deleted a message from LuxTester and timed them out (case #N): Used a banned word or phrase (matched badword, other thing)"],
    ["warn and timeout", ["warn", "timeout"], "Automod warned LuxTester and timed them out (case #N): Used a banned word or phrase (matched badword, other thing)"],
    ["all three", ["delete", "warn", "timeout"], "Automod deleted a message from LuxTester, warned them and timed them out (case #N): Used a banned word or phrase (matched badword, other thing)"],
  ];

  for (const [name, actions, expected] of cases) {
    test(`${name} leaves one action entry on the case`, async () => {
      const { row, audit } = await trip({ actions });
      assert.equal(audit.length, 1);
      const [entry] = audit;
      assert.equal(entry!.kind, "action.take");
      assert.equal(entry!.actorId, BOT);
      assert.equal(entry!.actorName, "Automod");
      assert.equal(entry!.actorRole, "automod");
      assert.equal(entry!.targetUserId, MEMBER);
      assert.equal(entry!.summary, expected.replace("#N", `#${row.caseNumber}`));
      assert.deepEqual(JSON.parse(entry!.after!), {
        action: row.action,
        caseNumber: row.caseNumber,
        reason: "Used a banned word or phrase",
      });
    });
  }

  test("carries the matched words in the summary, which only staff read, as plain text", async () => {
    const { audit } = await trip({ actions: ["delete"] });
    assert.ok(audit[0]!.summary.endsWith("(matched badword, other thing)"));
    assert.ok(!audit[0]!.summary.includes("`"));
    assert.ok(!audit[0]!.after!.includes("badword"));
  });

  test("a refused delete is not claimed in the entry", async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      const { audit } = await trip({ actions: ["delete"], deleteFails: true });
      assert.match(audit[0]!.summary, /^Automod warned LuxTester/);
    } finally {
      console.error = original;
    }
  });
});

describe("telling the server log about the delete", () => {
  test("the deletion is noted before the delete call, and only for a delete that went through", async () => {
    clearDeletionNotes();
    const { ctx, message } = setup({ messageId: "100000000000000299", actions: ["delete"] });
    let noteAtDelete: unknown = "not called";
    message.delete = async () => {
      noteAtDelete = takeDeletionNote("100000000000000299");
    };
    await automod.events!.messageCreate!(message as never, ctx as never);
    assert.deepEqual(noteAtDelete, { by: "automod" });
  });

  test("a note is withdrawn when Discord refuses the delete", async () => {
    clearDeletionNotes();
    const { ctx, message } = setup({ messageId: "100000000000000298", actions: ["delete"], deleteFails: true });
    const original = console.error;
    console.error = () => undefined;
    try {
      await automod.events!.messageCreate!(message as never, ctx as never);
    } finally {
      console.error = original;
    }
    assert.equal(takeDeletionNote("100000000000000298"), null);
  });

  test("a rule that does not delete notes nothing", async () => {
    clearDeletionNotes();
    const { ctx, message } = setup({ messageId: "100000000000000297", actions: ["warn"] });
    await automod.events!.messageCreate!(message as never, ctx as never);
    assert.equal(takeDeletionNote("100000000000000297"), null);
  });
});

describe("the recommended actions", () => {
  test("every rule has a set, and each is a valid combination", () => {
    assert.deepEqual(Object.keys(RECOMMENDED_ACTIONS).sort(), ["bannedWords", "capitals", "invites", "links", "mentions", "rateLimit", "repeatedText"]);
    for (const set of Object.values(RECOMMENDED_ACTIONS)) {
      assert.ok(set.length >= 1);
      assert.equal(new Set(set).size, set.length);
    }
  });
});

describe("the direct message to the member", () => {
  let next = 300;
  const id = () => `1000000000000003${String(next++).padStart(2, "0")}`;

  async function trip(options: Omit<Parameters<typeof setup>[0], "messageId">) {
    const made = setup({ ...options, messageId: id() });
    await automod.events!.messageCreate!(made.message as never, made.ctx as never);
    return made;
  }

  test("is off unless it is switched on, so nothing changes for a server that already runs automod", async () => {
    const { sent, ctx } = await trip({ actions: ["delete"] });
    assert.equal((ctx.settings as { dmOnAction: boolean }).dmOnAction, false);
    assert.equal(sent.some((s) => s.target === MEMBER), false);
    assert.equal(sent.length, 2, "the notice and the log, as before");
  });

  test("goes to the member with the stock wording and the same fixed reason as the notice", async () => {
    const { sent } = await trip({ actions: ["delete", "warn"], stored: { dmOnAction: true } });
    const dm = sent.find((s) => s.target === MEMBER);
    assert.ok(dm);
    assert.equal(dm.body.embeds[0]?.description, "In {server}, {outcome} ({rule}{reasonNote}).");
    assert.equal(dm.options.fallback?.embeds[0]?.description, "In {server}, {outcome} ({rule}{reasonNote}).");
    assert.equal(dm.values.outcome, "your message was removed and you were warned");
    assert.equal(dm.values.rule, "bannedWords");
    assert.equal(dm.values.reason, "Used a banned word or phrase");
    assert.equal(dm.values.action, "delete and warn");
    assert.equal(dm.values.user, `<@${MEMBER}>`);
  });

  test("never carries what the member wrote, or anything only staff should see", async () => {
    const { sent } = await trip({ actions: ["delete"], stored: { dmOnAction: true }, dashboard: "https://bot.example.com" });
    const dm = sent.find((s) => s.target === MEMBER);
    assert.ok(dm);
    for (const value of Object.values(dm.values)) {
      assert.ok(!value.includes("badword") && !value.includes("other thing") && !value.includes("bot.example.com"), value);
    }
    assert.deepEqual(Object.keys(dm.values).sort(), ["action", "duration", "outcome", "outcomeTitle", "reason", "reasonNote", "rule", "ruleKey", "user", "userId"]);
    assert.equal(dm.options.mentions, undefined, "a direct message mentions nobody on its own account");
  });

  test("uses the owner's message", async () => {
    const { sent } = await trip({ actions: ["timeout"], stored: { dmOnAction: true, dmMessage: { content: "Hi {user}: {outcome} for {duration}." } } });
    const dm = sent.find((s) => s.target === MEMBER);
    assert.equal(dm?.body.content, "Hi {user}: {outcome} for {duration}.");
    assert.equal(dm?.values.duration, "10 minutes");
  });

  test("a member with direct messages closed is skipped, and everything else still happens", async () => {
    const { sent, calls, ctx } = await trip({ actions: ["delete"], stored: { dmOnAction: true }, dmFails: true });
    assert.deepEqual(calls, ["delete"]);
    assert.equal(sent.some((s) => s.target === MEMBER), false);
    assert.equal(sent.some((s) => s.target === CHANNEL), true);
    assert.equal(sent.some((s) => s.target === LOG_CHANNEL), true);
    assert.ok(ctx);
  });
});

describe("how long the notice stays", () => {
  function delays(): { seen: number[]; restore(): void } {
    const seen: number[] = [];
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: () => void, delay?: number) => {
      seen.push(delay ?? 0);
      return { unref() {} } as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    return {
      seen,
      restore: () => {
        globalThis.setTimeout = original;
      },
    };
  }

  async function lifetimeFor(stored: Record<string, unknown>, messageId: string) {
    const timers = delays();
    try {
      const { ctx, message } = setup({ messageId, stored });
      await automod.events!.messageCreate!(message as never, ctx as never);
    } finally {
      timers.restore();
    }
    return timers.seen;
  }

  test("is eight seconds until the owner changes it", async () => {
    assert.deepEqual(await lifetimeFor({}, "100000000000000401"), [8000]);
  });

  test("follows the setting, with two seconds as the least and zero meaning the notice is kept", async () => {
    assert.deepEqual(await lifetimeFor({ noticeLifetime: "30s" }, "100000000000000402"), [30_000]);
    assert.deepEqual(await lifetimeFor({ noticeLifetime: "1s" }, "100000000000000403"), [2000]);
    assert.deepEqual(await lifetimeFor({ noticeLifetime: "0s" }, "100000000000000404"), []);
  });

  test("cannot be set past five minutes", () => {
    assert.equal(settings.parse({ noticeLifetime: "6m" }).ok, false);
    assert.equal(settings.parse({ noticeLifetime: "5m" }).ok, true);
  });
});

describe("the wording an owner can change", () => {
  test("the reason on the timeout in the audit log is Automod and the rule, until it is changed", async () => {
    const stock = setup({ messageId: "100000000000000411", actions: ["timeout"] });
    await automod.events!.messageCreate!(stock.message as never, stock.ctx as never);
    assert.deepEqual(stock.timeoutReasons, ["Automod: bannedWords"]);

    const custom = setup({
      messageId: "100000000000000412",
      actions: ["timeout"],
      stored: { labels: { audit: { timeoutReason: "Auto: {rule} ({ruleKey})" }, ruleNames: { bannedWords: "Word filter" } } },
    });
    await automod.events!.messageCreate!(custom.message as never, custom.ctx as never);
    assert.deepEqual(custom.timeoutReasons, ["Auto: Word filter (bannedWords)"]);
  });

  test("the notice and the case follow the owner's labels, and the case keeps the rule's own key", async () => {
    const stored = {
      labels: {
        ruleNames: { bannedWords: "Word filter" },
        reasons: { bannedWords: "Said something not allowed" },
        outcomes: { removed: "your post is gone" },
        fragments: { reasonNote: " - {reason}" },
      },
    };
    const { ctx, message, sent } = setup({ messageId: "100000000000000413", actions: ["delete"], stored });
    await automod.events!.messageCreate!(message as never, ctx as never);
    const notice = sent.find((s) => s.target === CHANNEL)!;
    assert.equal(notice.values.rule, "Word filter");
    assert.equal(notice.values.ruleKey, "bannedWords");
    assert.equal(notice.values.outcome, "your post is gone");
    assert.equal(notice.values.reasonNote, " - Said something not allowed");
    const row = await recordFor("100000000000000413");
    assert.equal(row?.reason, "bannedWords: Said something not allowed (matched `badword`, `other thing`)");
  });

  test("the problems staff see follow the owner's words", async () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      const { ctx, message, sent } = setup({
        messageId: "100000000000000414",
        actions: ["delete"],
        deleteFails: true,
        stored: { labels: { problems: { deleteMissingPermission: "No delete rights" } } },
      });
      await automod.events!.messageCreate!(message as never, ctx as never);
      assert.equal(sent.find((s) => s.target === LOG_CHANNEL)?.values.problems, "No delete rights");
      assert.match((await recordFor("100000000000000414"))?.reason ?? "", /\(No delete rights\)$/);
    } finally {
      console.error = original;
    }
  });
});
