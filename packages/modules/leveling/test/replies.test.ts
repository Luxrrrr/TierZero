import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, applyVariablesToMessage, emptyEmbed, parseMessage, type FieldDescriptor, type MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000050";
const USER = "200000000000000050";
const OTHER = "200000000000000051";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: leveling } = await import("../dist/index.js");
const { LEADERBOARD_STARTING, RANK_STARTING, leaderboardLine } = await import("../dist/messages.js");

const registry = new ModuleRegistry();
registry.register(leveling);

function settingsFor(stored: unknown = {}) {
  const result = registry.resolveSettings("leveling", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors[0]?.message);
  return result.value;
}

/** Fills a message the way the bot does before it is sent. */
function render(body: MessageBody, values: Record<string, string | number>): MessageBody {
  const strings = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
  const parsed = parseMessage(applyVariablesToMessage(body, { server: "Northwind", ...strings }));
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors[0]?.message);
  return parsed.value;
}

interface Replied {
  body: MessageBody;
  values: Record<string, string | number>;
  options?: { ephemeral?: boolean; fallback?: MessageBody };
}
let replied: Replied[];
let direct: unknown[];

function context(stored: unknown = {}, custom?: (values: Record<string, string | number>) => unknown) {
  return {
    settings: settingsFor(stored),
    guild: {
      id: GUILD,
      name: "Northwind",
      members: { fetch: async () => new Map([[USER, { displayName: "Ada" }]]) },
    },
    customReply: custom,
    reply: async (_interaction: unknown, body: MessageBody, values: Record<string, string | number> = {}, options?: Replied["options"]) => {
      replied.push({ body, values, options });
      return true;
    },
  } as never;
}

const rank = leveling.commands!.find((command) => command.name === "rank")!;
const board = leveling.commands!.find((command) => command.name === "leaderboard")!;

const rankInteraction = () =>
  ({
    options: { getUser: () => null },
    user: { id: USER, username: "ada", displayAvatarURL: () => "https://cdn.example/ada.png" },
    reply: async (reply: unknown) => {
      direct.push(reply);
    },
  }) as never;
const boardInteraction = (page: number | null = null) =>
  ({
    options: { getInteger: () => page },
    reply: async (reply: unknown) => {
      direct.push(reply);
    },
  }) as never;

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Leveling test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  replied = [];
  direct = [];
  await prisma.levelMember.deleteMany();
});

describe("/rank", () => {
  test("shows the embed it always showed, from the one starting message", async () => {
    await prisma.levelMember.create({ data: { guildId: GUILD, userId: USER, xp: 200, level: 2 } });
    await rank.run(rankInteraction(), context());
    assert.equal(direct.length, 0);
    assert.equal(replied.length, 1);
    assert.deepEqual(replied[0]?.body, RANK_STARTING);
    assert.equal(replied[0]?.options?.ephemeral, false);
    const embed = render(replied[0]!.body, replied[0]!.values).embeds[0];
    assert.deepEqual(embed, {
      ...emptyEmbed(),
      title: "ada - Level 1",
      thumbnailUrl: "https://cdn.example/ada.png",
      fields: [
        { name: "Experience", value: `${replied[0]?.values.xp} / ${replied[0]?.values.need}`, inline: true },
        { name: "Rank", value: "#1", inline: true },
        { name: "Progress", value: String(replied[0]?.values.progress), inline: false },
      ],
    });
  });

  test("calls a member with no experience Unranked, or whatever the server calls it", async () => {
    await rank.run(rankInteraction(), context());
    assert.equal(replied[0]?.values.rank, "Unranked");
    replied = [];
    await rank.run(rankInteraction(), context({ labels: { unranked: "No rank yet" } }));
    assert.equal(replied[0]?.values.rank, "No rank yet");
  });

  test("an owner's own reply is sent as it was", async () => {
    await rank.run(rankInteraction(), context({}, () => ({ content: "mine" })));
    assert.deepEqual(direct, [{ content: "mine" }]);
    assert.equal(replied.length, 0);
  });
});

describe("/leaderboard", () => {
  beforeEach(async () => {
    await prisma.levelMember.create({ data: { guildId: GUILD, userId: USER, xp: 4020, level: 12 } });
    await prisma.levelMember.create({ data: { guildId: GUILD, userId: OTHER, xp: 3110, level: 10 } });
  });

  test("shows the embed it always showed", async () => {
    await board.run(boardInteraction(), context());
    assert.deepEqual(replied[0]?.body, LEADERBOARD_STARTING);
    const embed = render(replied[0]!.body, replied[0]!.values).embeds[0];
    assert.equal(embed?.title, "Northwind leaderboard");
    assert.equal(embed?.description, `**1.** Ada - level 12 (4020 xp)\n**2.** <@${OTHER}> - level 10 (3110 xp)`);
    assert.equal(embed?.footerText, "Page 1");
  });

  test("writes each line from the server's own format", async () => {
    await board.run(boardInteraction(), context({ labels: { leaderboardLine: "{position}) {name}: {level} / {xp}" } }));
    assert.equal(replied[0]?.values.leaderboard, `1) Ada: 12 / 4020\n2) <@${OTHER}>: 10 / 3110`);
  });

  test("the line format reads as it did", () => {
    assert.equal(
      leaderboardLine("**{position}.** {name} - level {level} ({xp} xp)", { position: 3, name: "Ada", level: 4, xp: 99 }),
      "**3.** Ada - level 4 (99 xp)",
    );
  });

  test("a page past the end has its own reply", async () => {
    await board.run(boardInteraction(9), context({ replies: { leaderboardPastEnd: "Page {page} is empty." } }));
    assert.equal(replied[0]?.body.content, "Page {page} is empty.");
    assert.deepEqual(replied[0]?.values, { page: 9 });
  });

  test("an empty leaderboard says so, and reads as it did", async () => {
    await prisma.levelMember.deleteMany();
    await board.run(boardInteraction(), context());
    assert.equal(replied[0]?.body.embeds[0]?.description, "Nobody has earned experience here yet.");
    assert.equal(replied[0]?.body.embeds[0]?.color, REPLY_COLOR.info);
    assert.equal(replied[0]?.body.content, "");
    replied = [];
    await board.run(boardInteraction(2), context());
    assert.equal(replied[0]?.body.embeds[0]?.description, "There is no page that far into the leaderboard.");
    assert.equal(replied[0]?.body.embeds[0]?.color, REPLY_COLOR.info);
  });
});

describe("what the dashboard is told", () => {
  const summary = registry.describe().find((entry) => entry.id === "leveling");
  const fields = summary?.schema.fields as Record<string, FieldDescriptor>;

  test("the replies and the labels are collapsible groups", () => {
    assert.equal(fields.replies?.collapsible, true);
    assert.equal(fields.labels?.collapsible, true);
    const messages = Object.values(fields.replies?.fields as Record<string, FieldDescriptor>);
    assert.ok(messages.every((field) => field.kind === "message" && field.compact === true));
  });

  test("the leaderboard line offers the values it is filled from", () => {
    const labels = fields.labels?.fields as Record<string, FieldDescriptor>;
    assert.deepEqual(labels.leaderboardLine?.placeholders, ["position", "name", "level", "xp"]);
    assert.equal(labels.unranked?.default, "Unranked");
  });
});
