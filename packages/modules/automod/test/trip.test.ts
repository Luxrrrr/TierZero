import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readEvidence } from "@tier0/core";
import { createTestDatabase } from "../../moderation/test/db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: automod } = await import("../dist/index.js");
const { settings } = await import("../dist/settings.js");

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
  values: Record<string, string>;
}

function setup(options: { deleteFails?: boolean; dashboard?: string; content?: string; messageId: string }) {
  const sent: Sent[] = [];
  const parsed = settings.parse({ logChannel: LOG_CHANNEL, bannedWords: { enabled: true, action: "delete", words: ["badword", "other thing"] } });
  assert.ok(parsed.ok);

  const logChannel = { id: LOG_CHANNEL, isTextBased: () => true };
  const channel = { id: CHANNEL, name: "general", isTextBased: () => true, isDMBased: () => false, isThread: () => false };
  const member = {
    id: MEMBER,
    roles: { cache: new Map() },
    permissions: { has: () => false },
    moderatable: true,
  };
  const ctx = {
    client: { user: { id: BOT } },
    guild: { id: GUILD, channels: { cache: new Map([[LOG_CHANNEL, logChannel]]) } },
    settings: parsed.value,
    dashboardUrl: async () => options.dashboard ?? "",
    send: async (target: { id: string }, _body: unknown, values: Record<string, string>) => {
      sent.push({ target: target.id, values });
      return { delete: async () => undefined };
    },
  };
  const message = {
    id: options.messageId,
    guild: { id: GUILD, members: { fetch: async () => member } },
    author: { id: MEMBER, bot: false },
    member,
    content: options.content ?? "you badword, and then some other thing too",
    channel,
    channelId: CHANNEL,
    createdTimestamp: Date.now() - 1000,
    attachments: new Map([["a", { name: "evidence.png", url: "https://cdn.example/evidence.png", contentType: "image/png" }]]),
    delete: async () => {
      if (options.deleteFails) throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
    },
  };
  return { ctx, message, sent };
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
