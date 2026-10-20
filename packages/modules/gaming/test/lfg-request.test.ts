import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { requestPlayers } = await import("../dist/lfg-request.js");
const { lfgComponents } = await import("../dist/lfg.js");
const { postById } = await import("../dist/lfg-store.js");
const { lfgPanelComponents, lfgPanelModals } = await import("../dist/lfg-panel.js");

const GUILD = "300000000000000001";
const CHANNEL = "310000000000000001";
let seq = 0;

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const named = () => new Proxy({}, { get: (_t, key) => (typeof key === "string" ? key : undefined) });

function world(lfg: Record<string, unknown> = {}) {
  const replies: string[] = [];
  const edits: string[] = [];
  const sent: { values: Record<string, unknown> }[] = [];
  const channel = { id: CHANNEL, isTextBased: () => true };
  const ctx: any = {
    guild: { id: GUILD, channels: { cache: new Map([[CHANNEL, channel]]), fetch: async () => null }, members: { fetch: async () => null } },
    settings: {
      timeZone: "UTC",
      messages: { lfgRefusals: named(), lfgReplies: named(), lfgStarted: "lfgStarted", lfgGo: "lfgGo", lfgReady: "lfgReady", lfgPost: "lfgPost" },
      lfg: {
        labels: named(),
        enabled: true,
        restrictGames: false,
        games: [{ id: "val1", name: "Valorant", role: "400000000000000001" }],
        maxNeeded: 9,
        maxOpen: 1,
        cooldown: 0,
        expiresAfter: 3_600_000,
        ...lfg,
      },
    },
    reply: async (_i: unknown, body: unknown) => void replies.push(String(body)),
    send: async (_channel: unknown, _body: unknown, values: Record<string, unknown>) => {
      sent.push({ values });
      return { id: `32000000000000${String(++seq).padStart(4, "0")}`, url: "https://discord.test/post" };
    },
    edit: async (_message: unknown, body: unknown) => void edits.push(String(body)),
    tasks: { schedule: async () => undefined, cancel: async () => undefined },
  };
  const who = () => {
    const id = `33000000000000${String(++seq).padStart(4, "0")}`;
    const member = { id, displayName: `Player ${seq}`, voice: {} };
    return { user: { id, username: `p${seq}` }, member, channel };
  };
  return { ctx, replies, sent, edits, who };
}

const ask = (game: string, needed = 2, extra: { note?: string | null; when?: string | null } = {}) => ({ game, needed, note: extra.note ?? null, when: extra.when ?? null });

describe("asking for players", () => {
  test("accepts a game nobody listed", async () => {
    const w = world();
    await requestPlayers(w.ctx, w.who() as never, ask("  Deep   Rock Galactic "));
    assert.deepEqual(w.replies, ["posted"]);
    assert.equal(w.sent[0]!.values.game, "Deep Rock Galactic");
    assert.equal(w.sent[0]!.values.ping, "");
  });

  test("a listed game keeps its name, role and spelling whatever case was typed", async () => {
    const w = world();
    await requestPlayers(w.ctx, w.who() as never, ask("valorant"));
    assert.equal(w.sent[0]!.values.game, "Valorant");
    assert.equal(w.sent[0]!.values.ping, "<@&400000000000000001>");
  });

  test("with the list required, a game outside it is refused", async () => {
    const w = world({ restrictGames: true });
    await requestPlayers(w.ctx, w.who() as never, ask("Deep Rock Galactic"));
    assert.deepEqual(w.replies, ["unknownGame"]);
    assert.equal(w.sent.length, 0);
    await requestPlayers(w.ctx, w.who() as never, ask("Valorant"));
    assert.deepEqual(w.replies, ["unknownGame", "posted"]);
  });

  test("with the list required and empty, says no games are set up", async () => {
    const w = world({ restrictGames: true, games: [] });
    await requestPlayers(w.ctx, w.who() as never, ask("Anything"));
    assert.deepEqual(w.replies, ["noGames"]);
  });

  test("refuses an empty game, a bad size and a bad time", async () => {
    const w = world();
    await requestPlayers(w.ctx, w.who() as never, ask("  "));
    await requestPlayers(w.ctx, w.who() as never, ask("Apex", 0));
    await requestPlayers(w.ctx, w.who() as never, ask("Apex", 10));
    await requestPlayers(w.ctx, w.who() as never, ask("Apex", Number.NaN));
    await requestPlayers(w.ctx, w.who() as never, ask("Apex", 2, { when: "whenever" }));
    assert.deepEqual(w.replies, ["unknownGame", "badSize", "badSize", "badSize", "badTime"]);
  });

  test("holds a member to the number of open posts", async () => {
    const w = world();
    const same = w.who();
    await requestPlayers(w.ctx, same as never, ask("Apex"));
    await requestPlayers(w.ctx, same as never, ask("Apex"));
    assert.deepEqual(w.replies, ["posted", "tooManyOpen"]);
  });
});

describe("the panel's button and form", () => {
  test("the button opens the form while looking for group is on", async () => {
    const w = world();
    const shown: unknown[] = [];
    await lfgPanelComponents.lfgPanelStart!({ ...w.who(), showModal: async (form: unknown) => void shown.push(form) } as never, { ctx: w.ctx, rest: "panel" } as never);
    assert.equal(shown.length, 1);
    assert.equal((shown[0] as any).toJSON().components.length, 4);
  });

  test("the button says so while the feature is off", async () => {
    const w = world({ enabled: false });
    await lfgPanelComponents.lfgPanelStart!({ ...w.who(), deferReply: async () => undefined } as never, { ctx: w.ctx, rest: "panel" } as never);
    assert.deepEqual(w.replies, ["disabled"]);
  });

  test("the form's answers make the post", async () => {
    const w = world();
    const answers: Record<string, string> = { game: "Apex Legends", players: " 3 ", note: "Plat+", when: "" };
    const submit = { ...w.who(), deferReply: async () => undefined, fields: { getTextInputValue: (name: string) => answers[name] ?? "" } };
    await lfgPanelModals.lfgPanelForm!(submit as never, { ctx: w.ctx, rest: "form" } as never);
    assert.deepEqual(w.replies, ["posted"]);
    assert.equal(w.sent[0]!.values.game, "Apex Legends");
    assert.equal(w.sent[0]!.values.needed, 3);
    assert.equal(w.sent[0]!.values.note, "Plat+");
  });
});

describe("starting a group early", () => {
  async function posted(extra: Record<string, unknown> = {}) {
    const w = world({ pingParty: true, createVoice: false, ...extra });
    const author = w.who();
    await requestPlayers(w.ctx, author as never, ask("Apex", 3));
    const id = String((await prisma.lfgPost.findFirst({ where: { authorId: author.user.id } }))!.id);
    w.replies.length = 0;
    w.sent.length = 0;
    const press = (who: { user: unknown; member: unknown }, mod = false) => ({
      ...who,
      deferReply: async () => undefined,
      message: { id: "m" },
      memberPermissions: { has: () => mod },
    });
    return { w, author, id, press };
  }

  test("the author starts it, the post is rewritten and the party is pinged", async () => {
    const { w, author, id, press } = await posted();
    await lfgComponents.lfgStart!(press(author) as never, { ctx: w.ctx, rest: id } as never);
    assert.equal((await postById(GUILD, Number(id)))?.status, "started");
    assert.deepEqual(w.replies, ["startedByYou"]);
    assert.deepEqual(w.edits, ["lfgStarted"]);
    assert.equal(w.sent.length, 1);
  });

  test("the party is not pinged when that is off", async () => {
    const { w, author, id, press } = await posted({ pingParty: false });
    await lfgComponents.lfgStart!(press(author) as never, { ctx: w.ctx, rest: id } as never);
    assert.equal(w.sent.length, 0);
  });

  test("someone else cannot, a moderator can, and it only starts once", async () => {
    const { w, author, id, press } = await posted();
    const other = w.who();
    await lfgComponents.lfgStart!(press(other) as never, { ctx: w.ctx, rest: id } as never);
    assert.deepEqual(w.replies, ["notAuthor"]);
    await lfgComponents.lfgStart!(press(other, true) as never, { ctx: w.ctx, rest: id } as never);
    await lfgComponents.lfgStart!(press(author) as never, { ctx: w.ctx, rest: id } as never);
    assert.deepEqual(w.replies, ["notAuthor", "startedByYou", "ended"]);
  });
});
