import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const store = await import("../dist/signup-store.js");

const GUILD = "300000000000000001";
const user = (n: number) => `31000000000000${String(n).padStart(4, "0")}`;

before(async () => {
  await prisma.guild.create({ data: { id: GUILD, name: "Test" } });
});

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const event = (extra: Partial<Parameters<typeof store.createEvent>[0]> = {}) =>
  store.createEvent({
    guildId: GUILD,
    channelId: "320000000000000001",
    title: "Friday scrims",
    game: "Valorant",
    note: "",
    startsAt: null,
    teamSize: 1,
    capacity: 2,
    waitlist: true,
    requiredRoles: [],
    rewardRoleId: null,
    createdById: user(0),
    ...extra,
  });

describe("registering", () => {
  test("registers while there are places and waitlists after", async () => {
    const created = await event({ capacity: 2 });
    const first = await store.register(GUILD, created.id, [user(1)], "");
    const second = await store.register(GUILD, created.id, [user(2)], "");
    const third = await store.register(GUILD, created.id, [user(3)], "");
    assert.ok(first.ok && second.ok && third.ok);
    assert.deepEqual([first.placement, second.placement, third.placement], ["registered", "registered", "waitlist"]);
  });

  test("refuses when full and there is no waitlist, leaving nothing behind", async () => {
    const created = await event({ capacity: 1, waitlist: false });
    await store.register(GUILD, created.id, [user(1)], "");
    assert.deepEqual(await store.register(GUILD, created.id, [user(2)], ""), { ok: false, code: "full" });
    const stored = await store.eventById(GUILD, created.id);
    assert.equal(stored?.entries.length, 1);
    // The refused player is free to sign up once a place opens.
    const entry = stored?.entries[0];
    assert.ok(entry);
    await store.withdraw(created.id, entry.id);
    assert.ok((await store.register(GUILD, created.id, [user(2)], "")).ok);
  });

  test("has no limit at 0", async () => {
    const created = await event({ capacity: 0, waitlist: false });
    for (let i = 1; i <= 5; i++) assert.ok((await store.register(GUILD, created.id, [user(i)], "")).ok);
  });

  test("keeps a team together, with the captain first", async () => {
    const created = await event({ capacity: 4, teamSize: 3 });
    const result = await store.register(GUILD, created.id, [user(1), user(2), user(3)], "Red");
    assert.ok(result.ok);
    assert.equal(result.entry.captainId, user(1));
    assert.equal(result.entry.teamName, "Red");
    assert.deepEqual(result.entry.members.map((m) => m.userId), [user(1), user(2), user(3)]);
  });

  test("refuses anyone already on the sign-up, naming who, and keeps no half-made team", async () => {
    const created = await event({ capacity: 4, teamSize: 2 });
    await store.register(GUILD, created.id, [user(1), user(2)], "");
    const clash = await store.register(GUILD, created.id, [user(3), user(2)], "");
    assert.deepEqual(clash, { ok: false, code: "taken", userId: user(2) });
    const stored = await store.eventById(GUILD, created.id);
    assert.equal(stored?.entries.length, 1);
    assert.equal(await store.entryOf(created.id, user(3)), null);
  });

  test("lets the same person sign up for different sign-ups", async () => {
    const one = await event();
    const two = await event();
    assert.ok((await store.register(GUILD, one.id, [user(1)], "")).ok);
    assert.ok((await store.register(GUILD, two.id, [user(1)], "")).ok);
  });

  test("refuses a closed sign-up, a missing one and another server's", async () => {
    const created = await event();
    await store.closeEvent(created.id);
    assert.deepEqual(await store.register(GUILD, created.id, [user(1)], ""), { ok: false, code: "closed" });
    assert.deepEqual(await store.register(GUILD, 999_999, [user(1)], ""), { ok: false, code: "gone" });
    assert.deepEqual(await store.register("other", created.id, [user(1)], ""), { ok: false, code: "gone" });
  });

  test("never registers more than the capacity when everyone presses at once", async () => {
    const created = await event({ capacity: 3, waitlist: true });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.register(GUILD, created.id, [user(i + 1)], "")));
    assert.ok(results.every((result) => result.ok));
    const stored = await store.eventById(GUILD, created.id);
    assert.equal(stored?.entries.filter((e) => e.status === "registered").length, 3);
    assert.equal(stored?.entries.filter((e) => e.status === "waitlist").length, 5);
  });
});

describe("withdrawing", () => {
  test("promotes the waitlist in the order it joined", async () => {
    const created = await event({ capacity: 2 });
    const a = await store.register(GUILD, created.id, [user(1)], "");
    await store.register(GUILD, created.id, [user(2)], "");
    await store.register(GUILD, created.id, [user(3)], "");
    await store.register(GUILD, created.id, [user(4)], "");
    assert.ok(a.ok);
    const outcome = await store.withdraw(created.id, a.entry.id);
    assert.ok(outcome);
    assert.deepEqual(outcome.promoted.map((entry) => entry.captainId), [user(3)]);
    const stored = await store.eventById(GUILD, created.id);
    assert.deepEqual(stored?.entries.filter((e) => e.status === "registered").map((e) => e.captainId), [user(2), user(3)]);
    assert.deepEqual(stored?.entries.filter((e) => e.status === "waitlist").map((e) => e.captainId), [user(4)]);
  });

  test("frees the withdrawn people to sign up again", async () => {
    const created = await event({ capacity: 2, teamSize: 2 });
    const team = await store.register(GUILD, created.id, [user(1), user(2)], "");
    assert.ok(team.ok);
    await store.withdraw(created.id, team.entry.id);
    assert.equal(await store.entryOf(created.id, user(2)), null);
    assert.ok((await store.register(GUILD, created.id, [user(2), user(3)], "")).ok);
  });

  test("promotes nobody when a waitlisted entry leaves", async () => {
    const created = await event({ capacity: 1 });
    await store.register(GUILD, created.id, [user(1)], "");
    const waiting = await store.register(GUILD, created.id, [user(2)], "");
    await store.register(GUILD, created.id, [user(3)], "");
    assert.ok(waiting.ok);
    const outcome = await store.withdraw(created.id, waiting.entry.id);
    assert.deepEqual(outcome?.promoted, []);
  });

  test("answers null for an entry that is already gone", async () => {
    const created = await event();
    const entry = await store.register(GUILD, created.id, [user(1)], "");
    assert.ok(entry.ok);
    assert.ok(await store.withdraw(created.id, entry.entry.id));
    assert.equal(await store.withdraw(created.id, entry.entry.id), null);
  });

  test("a place freed with no waitlist is simply free", async () => {
    const created = await event({ capacity: 1, waitlist: false });
    const first = await store.register(GUILD, created.id, [user(1)], "");
    assert.ok(first.ok);
    await store.withdraw(created.id, first.entry.id);
    assert.ok((await store.register(GUILD, created.id, [user(2)], "")).ok);
  });
});

describe("closing", () => {
  test("happens once", async () => {
    const created = await event();
    assert.equal(await store.closeEvent(created.id), true);
    assert.equal(await store.closeEvent(created.id), false);
  });

  test("the reminder is marked once and not for a closed sign-up", async () => {
    const created = await event();
    assert.equal(await store.markReminded(created.id), true);
    assert.equal(await store.markReminded(created.id), false);
    const closed = await event();
    await store.closeEvent(closed.id);
    assert.equal(await store.markReminded(closed.id), false);
  });
});

describe("the sign-up itself", () => {
  test("keeps the roles it asks for", async () => {
    const created = await event({ requiredRoles: ["r1", "r2"] });
    assert.deepEqual(store.requiredRolesOf(created), ["r1", "r2"]);
    assert.deepEqual(store.requiredRolesOf({ requiredRoles: "not json" }), []);
  });

  test("is listed newest first, and by state", async () => {
    const open = await event();
    const closed = await event();
    await store.closeEvent(closed.id);
    const all = await store.eventsOf(GUILD);
    assert.ok(all.findIndex((e) => e.id === closed.id) < all.findIndex((e) => e.id === open.id));
    assert.ok((await store.eventsOf(GUILD, "open")).every((e) => e.status === "open"));
  });

  test("a sign-up whose post never went up can be discarded with its entries", async () => {
    const created = await event();
    await store.register(GUILD, created.id, [user(1)], "");
    await store.discardEvent(created.id);
    assert.equal(await store.eventById(GUILD, created.id), null);
    assert.equal(await prisma.signupMember.count({ where: { eventId: created.id } }), 0);
  });
});

describe("a teammate leaving", () => {
  test("takes only that person off the team and leaves the entry and the captain", async () => {
    const created = await event({ teamSize: 3, capacity: 4 });
    const joined = await store.register(GUILD, created.id, [user(11), user(12), user(13)], "Night Owls");
    assert.ok(joined.ok);

    assert.equal(await store.removeTeammate(created.id, joined.entry.id, user(12)), true);
    const entry = await store.entryOf(created.id, user(11));
    assert.deepEqual(entry?.members.map((member) => member.userId), [user(11), user(13)]);
    assert.equal(await store.entryOf(created.id, user(12)), null);
  });

  test("the person who left can sign up again", async () => {
    const created = await event({ teamSize: 2, capacity: 4 });
    const joined = await store.register(GUILD, created.id, [user(21), user(22)], "");
    assert.ok(joined.ok);
    await store.removeTeammate(created.id, joined.entry.id, user(22));
    const again = await store.register(GUILD, created.id, [user(22)], "");
    assert.ok(again.ok);
  });

  test("the captain cannot be taken off this way, nor someone who is not on the entry", async () => {
    const created = await event({ teamSize: 2, capacity: 4 });
    const joined = await store.register(GUILD, created.id, [user(31), user(32)], "");
    assert.ok(joined.ok);
    assert.equal(await store.removeTeammate(created.id, joined.entry.id, user(31)), false);
    assert.equal(await store.removeTeammate(created.id, joined.entry.id, user(99)), false);
    assert.equal((await store.entryOf(created.id, user(31)))?.members.length, 2);
  });
});
