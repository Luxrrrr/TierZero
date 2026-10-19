import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const store = await import("../dist/lfg-store.js");

const GUILD = "200000000000000001";
const CHANNEL = "210000000000000001";
const AUTHOR = "220000000000000001";
const person = (n: number) => ({ id: `22000000000000010${n}`.slice(0, 18), name: `player${n}` });

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const post = (needed = 2, extra: Partial<Parameters<typeof store.createPost>[0]> = {}) =>
  store.createPost({
    guildId: GUILD,
    channelId: CHANNEL,
    gameId: "abc12345",
    gameName: "Valorant",
    authorId: AUTHOR,
    authorName: "Ada",
    needed,
    note: "",
    startsAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...extra,
  });

describe("joining a post", () => {
  test("adds the player and leaves the post open while there is room", async () => {
    const created = await post(2);
    const joined = await store.joinPost(GUILD, created.id, person(1));
    assert.ok(joined.ok);
    assert.equal(joined.filled, false);
    assert.equal(joined.post.status, "open");
    assert.deepEqual(joined.post.members.map((m) => m.userId), [person(1).id]);
  });

  test("fills the post on the last place and marks it full", async () => {
    const created = await post(2);
    await store.joinPost(GUILD, created.id, person(1));
    const last = await store.joinPost(GUILD, created.id, person(2));
    assert.ok(last.ok);
    assert.equal(last.filled, true);
    assert.equal(last.post.status, "full");
    assert.ok(last.post.closedAt);
  });

  test("refuses once full, twice by the same player, by the author and on a post that is gone", async () => {
    const created = await post(1);
    await store.joinPost(GUILD, created.id, person(1));
    assert.deepEqual(await store.joinPost(GUILD, created.id, person(2)), { ok: false, code: "full" });

    const open = await post(3);
    await store.joinPost(GUILD, open.id, person(1));
    assert.deepEqual(await store.joinPost(GUILD, open.id, person(1)), { ok: false, code: "already" });
    assert.deepEqual(await store.joinPost(GUILD, open.id, { id: AUTHOR, name: "Ada" }), { ok: false, code: "author" });
    assert.deepEqual(await store.joinPost(GUILD, 999_999, person(1)), { ok: false, code: "gone" });
    assert.deepEqual(await store.joinPost("another guild", open.id, person(2)), { ok: false, code: "gone" });
  });

  test("never lets more people in than there are places when they all press at once", async () => {
    const created = await post(3);
    const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => store.joinPost(GUILD, created.id, person(i + 1))));
    const got = outcomes.filter((outcome) => outcome.ok).length;
    assert.equal(got, 3);
    const stored = await store.postById(GUILD, created.id);
    assert.equal(stored?.members.length, 3);
    assert.equal(stored?.status, "full");
    assert.equal(outcomes.filter((o) => o.ok && o.filled).length, 1);
  });
});

describe("leaving a post", () => {
  test("removes the player and frees the place", async () => {
    const created = await post(2);
    await store.joinPost(GUILD, created.id, person(1));
    const left = await store.leavePost(GUILD, created.id, person(1).id);
    assert.ok(left.ok);
    assert.equal(left.post.members.length, 0);
    const again = await store.joinPost(GUILD, created.id, person(1));
    assert.ok(again.ok);
  });

  test("is refused for the author, for someone not in and on a post that ended", async () => {
    const created = await post(2);
    assert.deepEqual(await store.leavePost(GUILD, created.id, AUTHOR), { ok: false, code: "author" });
    assert.deepEqual(await store.leavePost(GUILD, created.id, person(3).id), { ok: false, code: "notIn" });
    await store.joinPost(GUILD, created.id, person(1));
    await store.endPost(created.id, "closed");
    assert.deepEqual(await store.leavePost(GUILD, created.id, person(1).id), { ok: false, code: "ended" });
  });
});

describe("ending a post", () => {
  test("happens once", async () => {
    const created = await post(2);
    assert.equal(await store.endPost(created.id, "closed"), true);
    assert.equal(await store.endPost(created.id, "expired"), false);
    assert.equal((await store.postById(GUILD, created.id))?.status, "closed");
  });

  test("does not reopen a full post", async () => {
    const created = await post(1);
    await store.joinPost(GUILD, created.id, person(1));
    assert.equal(await store.endPost(created.id, "expired"), false);
    assert.equal((await store.postById(GUILD, created.id))?.status, "full");
  });
});

describe("a member's posts", () => {
  test("counts only the open ones", async () => {
    const author = "230000000000000001";
    const first = await post(2, { authorId: author });
    await post(2, { authorId: author });
    assert.equal(await store.openPostsOf(GUILD, author), 2);
    await store.endPost(first.id, "closed");
    assert.equal(await store.openPostsOf(GUILD, author), 1);
  });

  test("knows when the last one was posted", async () => {
    const author = "230000000000000002";
    assert.equal(await store.lastPostedAt(GUILD, author), null);
    await post(2, { authorId: author });
    const last = await store.lastPostedAt(GUILD, author);
    assert.ok(last && Date.now() - last.getTime() < 60_000);
  });
});

describe("overdue posts", () => {
  test("are the open ones past their time", async () => {
    const author = "230000000000000003";
    const late = await post(2, { authorId: author, expiresAt: new Date(Date.now() - 1000) });
    await post(2, { authorId: author, expiresAt: new Date(Date.now() + 3_600_000) });
    const overdue = await store.overduePosts(GUILD, new Date());
    assert.ok(overdue.some((entry) => entry.id === late.id));
    assert.ok(overdue.every((entry) => entry.expiresAt.getTime() <= Date.now()));
  });
});

test("a post whose message never went up can be discarded", async () => {
  const created = await post(2);
  await store.discardPost(created.id);
  assert.equal(await store.postById(GUILD, created.id), null);
});
