import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, applyVariablesToMessage, type MessageBody } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const GUILD = "100000000000000070";
const FRAG = "200000000000000071";
const QUILL = "200000000000000072";
const GHOST = "200000000000000073";
const SHY = "200000000000000074";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { default: leveling } = await import("../dist/index.js");
const { RANK_STARTING, LEADERBOARD_STARTING } = await import("../dist/messages.js");
const { clampPage, forgetPages, hiddenMembers, publicLeaderboard, publicPageUrl, resetMemberFetchBudget, setHidden, takeMemberFetch, PUBLIC_MAX_PAGES } = await import("../dist/public-page.js");

const registry = new ModuleRegistry();
registry.register(leveling);

const settingsFor = (stored: unknown = {}) => {
  const result = registry.resolveSettings("leveling", stored);
  assert.ok(result.ok);
  return result.value as { publicPage: { enabled: boolean; indexed: boolean } };
};

const people: Record<string, string> = { [FRAG]: "fragmuffin", [QUILL]: "quillfeather", [SHY]: "lurker" };
const guild = {
  id: GUILD,
  name: "Night Raid",
  iconURL: () => "https://cdn.discordapp.com/icons/1/a.png",
  members: {
    cache: new Map<string, unknown>(),
    fetch: async ({ user }: { user: string[] }) =>
      new Map(
        user.filter((id) => people[id]).map((id) => [id, { displayName: people[id], displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}.png` }]),
      ),
  },
} as never;

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Public page test guild" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  await prisma.levelMember.deleteMany();
  await prisma.guildModule.deleteMany();
  forgetPages(GUILD);
  resetMemberFetchBudget();
  (guild as never as { members: { cache: Map<string, unknown> } }).members.cache.clear();
  await prisma.levelMember.createMany({
    data: [
      { guildId: GUILD, userId: FRAG, xp: 900, level: 6 },
      { guildId: GUILD, userId: QUILL, xp: 400, level: 3 },
      { guildId: GUILD, userId: GHOST, xp: 300, level: 2 },
      { guildId: GUILD, userId: SHY, xp: 200, level: 2 },
    ],
  });
});

describe("the public leaderboard", () => {
  test("starts off, and asks search engines not to list it", () => {
    assert.deepEqual(settingsFor().publicPage, { enabled: false, indexed: false });
  });

  test("shows names, pictures and levels in order, and no ids", async () => {
    const board = await publicLeaderboard(guild, 1, false);
    assert.deepEqual(board.server, { name: "Night Raid", icon: "https://cdn.discordapp.com/icons/1/a.png" });
    assert.deepEqual(
      board.members.map((m) => [m.position, m.name, m.level]),
      [
        [1, "fragmuffin", 6],
        [2, "quillfeather", 3],
        [3, "Former member", 2],
        [4, "lurker", 2],
      ],
    );
    assert.equal(board.members[2]?.avatar, null);
    assert.equal(board.pages, 1);
    // A picture's CDN address is the one Discord itself shows; nothing else about a member is passed on.
    for (const member of board.members) assert.deepEqual(Object.keys(member).sort(), ["avatar", "level", "name", "position"]);
  });

  test("leaves off a member who asked, and puts them back when they ask again", async () => {
    assert.equal(await setHidden(GUILD, SHY, true), true);
    assert.equal(await setHidden(GUILD, SHY, true), false, "hiding twice changes nothing");
    assert.deepEqual(await hiddenMembers(GUILD), [SHY]);
    let board = await publicLeaderboard(guild, 1, false);
    assert.deepEqual(board.members.map((m) => m.name), ["fragmuffin", "quillfeather", "Former member"]);

    await setHidden(GUILD, SHY, false);
    board = await publicLeaderboard(guild, 1, false);
    assert.equal(board.members.length, 4);
  });

  test("keeps the opt-outs out of the module list and the settings", async () => {
    await setHidden(GUILD, SHY, true);
    const row = await prisma.guildModule.findFirst({ where: { guildId: GUILD } });
    assert.equal(row?.enabled, false);
    assert.equal(registry.get(row!.moduleId), undefined, "the row names no module");
  });

  test("answers a burst of visits from a minute-old copy", async () => {
    const first = await publicLeaderboard(guild, 1, false, 1_000);
    await prisma.levelMember.update({ where: { guildId_userId: { guildId: GUILD, userId: QUILL } }, data: { xp: 5000, level: 9 } });
    const again = await publicLeaderboard(guild, 1, true, 30_000);
    assert.deepEqual(again.members, first.members);
    assert.equal(again.indexed, true, "the owner's choice is never cached");
    const later = await publicLeaderboard(guild, 1, false, 70_000);
    assert.equal(later.members[0]?.name, "quillfeather");
  });

  test("reads names from the members the bot holds and asks Discord only for the rest", async () => {
    const asked: string[][] = [];
    const held = { displayName: "held-name", displayAvatarURL: () => "https://cdn.discordapp.com/avatars/held.png" };
    const probe = {
      ...(guild as object),
      members: {
        cache: new Map([[FRAG, held]]),
        fetch: async ({ user }: { user: string[] }) => {
          asked.push(user);
          return new Map();
        },
      },
    } as never;
    const board = await publicLeaderboard(probe, 1, false);
    assert.equal(board.members[0]?.name, "held-name");
    assert.deepEqual(asked, [[QUILL, GHOST, SHY]]);
  });

  test("asks Discord for no more than the budget, then serves the last copy of the page", async () => {
    let asks = 0;
    const counting = {
      ...(guild as object),
      members: { cache: new Map(), fetch: (query: { user: string[] }) => ((asks += 1), (guild as never as { members: { fetch: (q: unknown) => Promise<unknown> } }).members.fetch(query)) },
    } as never;
    const first = await publicLeaderboard(counting, 1, false, 1_000);
    assert.equal(asks, 1);

    resetMemberFetchBudget();
    for (let n = 0; n < 10; n += 1) assert.equal(takeMemberFetch(GUILD, 61_500), true);
    assert.equal(takeMemberFetch(GUILD, 61_500), false, "ten a minute for one server");
    const stale = await publicLeaderboard(counting, 1, false, 61_500);
    assert.deepEqual(stale.members, first.members);
    assert.equal(asks, 1, "the spent budget sent nothing to Discord");
    assert.equal(takeMemberFetch(GUILD, 121_600), true, "a new minute starts a new budget");
  });

  test("past the overall budget a server with its own allowance is still held back", () => {
    resetMemberFetchBudget();
    let allowed = 0;
    for (let n = 0; n < 8; n += 1) for (let i = 0; i < 10; i += 1) if (takeMemberFetch(`guild-${n}`, 5_000)) allowed += 1;
    assert.equal(allowed, 40);
  });

  test("a failed name lookup is not kept as if the members had left", async () => {
    const failing = { ...(guild as object), members: { cache: new Map(), fetch: async () => Promise.reject(new Error("gateway busy")) } } as never;
    const broken = await publicLeaderboard(failing, 1, false);
    assert.ok(broken.members.every((member) => member.name === "Member"));
    const recovered = await publicLeaderboard(guild, 1, false);
    assert.equal(recovered.members[0]?.name, "fragmuffin");
  });

  test("page numbers are whole, at least 1 and capped", () => {
    assert.equal(clampPage("3"), 3);
    assert.equal(clampPage("0"), 1);
    assert.equal(clampPage("2.5"), 1);
    assert.equal(clampPage("nope"), 1);
    assert.equal(clampPage(null), 1);
    assert.equal(clampPage("99999"), PUBLIC_MAX_PAGES);
  });

  test("has an address only when the dashboard does", () => {
    assert.equal(publicPageUrl("", GUILD), "");
    assert.equal(publicPageUrl("https://bot.example.com", GUILD), `https://bot.example.com/leaderboard/${GUILD}`);
  });
});

describe("the dashboard and the replies", () => {
  const ctxFor = (stored: unknown, address: string) =>
    ({ settings: settingsFor(stored), guild: { id: GUILD }, dashboardUrl: async () => address }) as never;

  test("say nothing while the page is off", async () => {
    assert.deepEqual(await leveling.notices!(ctxFor({}, "https://bot.example.com")), []);
  });

  test("give the exact address once the page is on", async () => {
    const [notice] = await leveling.notices!(ctxFor({ publicPage: { enabled: true } }, "https://bot.example.com"));
    assert.equal(notice?.tone, "info");
    assert.ok(notice?.text.includes(`https://bot.example.com/leaderboard/${GUILD}`));
    assert.equal(notice?.link?.href, `https://bot.example.com/leaderboard/${GUILD}`);
  });

  test("say plainly when there is no address anyone else can open", async () => {
    const [notice] = await leveling.notices!(ctxFor({ publicPage: { enabled: true } }, ""));
    assert.equal(notice?.tone, "attention");
    assert.match(notice!.text, /nobody can reach the page/);
    assert.equal(notice?.link?.href, `/guilds/${GUILD}/mod/settings`);
  });

  test("/rank and /leaderboard carry a link button only when there is an address", () => {
    for (const body of [RANK_STARTING, LEADERBOARD_STARTING] as MessageBody[]) {
      assert.equal(applyVariablesToMessage(body, { "leaderboard.url": "" }).buttons.length, 0);
      const filled = applyVariablesToMessage(body, { "leaderboard.url": "https://bot.example.com/leaderboard/1" });
      assert.deepEqual(filled.buttons.map((b) => [b.label, b.url]), [["Full leaderboard", "https://bot.example.com/leaderboard/1"]]);
    }
  });

  test("/leaderboard-privacy hides and shows the member who ran it, privately", async () => {
    const command = leveling.commands!.find((c) => c.name === "leaderboard-privacy")!;
    const replies: { ephemeral?: boolean; text: string }[] = [];
    const ctx = {
      settings: settingsFor(),
      guild: { id: GUILD },
      reply: async (_i: unknown, body: MessageBody, _v: unknown, options?: { ephemeral?: boolean }) => {
        replies.push({ ephemeral: options?.ephemeral, text: body.embeds[0]?.description ?? "" });
        return true;
      },
    } as never;
    const run = (choice: string) => command.run({ user: { id: SHY }, options: { getString: () => choice } } as never, ctx);

    await run("hide");
    assert.deepEqual(await hiddenMembers(GUILD), [SHY]);
    await run("show");
    assert.deepEqual(await hiddenMembers(GUILD), []);
    assert.match(replies[0]!.text, /left off the public leaderboard page/);
    assert.match(replies[1]!.text, /shown on the public leaderboard page again/);
    assert.ok(replies.every((reply) => reply.ephemeral === undefined), "replies keep the private default");
  });
});
