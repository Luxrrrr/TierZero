import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { massSkip, readChannels, readMassRequest } from "../dist/control/mod/raid.js";
import { appealDto, readResponse } from "../dist/control/mod/appeals.js";

const ID_A = "111111111111111111";
const ID_B = "222222222222222222";

describe("readChannels", () => {
  test("takes all, or a list of channel ids without repeats", () => {
    assert.equal(readChannels("all"), "all");
    assert.deepEqual(readChannels([ID_A, ID_B, ID_A]), [ID_A, ID_B]);
  });

  test("refuses anything else", () => {
    for (const bad of [[], "everything", [ID_A, "not-an-id"], [5], null, undefined, Array.from({ length: 501 }, () => ID_A)]) {
      assert.equal(readChannels(bad), null, JSON.stringify(bad)?.slice(0, 40));
    }
  });
});

describe("readMassRequest", () => {
  test("pasted ids make a request for those ids, repeats removed", () => {
    const read = readMassRequest({ action: "ban", ids: [ID_A, ID_B, ID_A], reason: " raid ", deleteDays: 1 });
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.deepEqual(read.request.ids, [ID_A, ID_B]);
      assert.equal(read.request.reason, "raid");
      assert.equal(read.request.deleteDays, 1);
      assert.equal(read.request.window, null);
    }
  });

  test("a join window makes a request for whoever joined in it", () => {
    const read = readMassRequest({ action: "kick", joinedAfter: "2026-10-17T10:00:00Z", joinedBefore: "2026-10-17T11:00:00Z" });
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.request.deleteDays, null);
      assert.equal(read.request.window?.after.toISOString(), "2026-10-17T10:00:00.000Z");
    }
  });

  test("ids and a window together, or neither, are refused", () => {
    assert.equal(readMassRequest({ action: "ban", ids: [ID_A], joinedAfter: "2026-10-17T10:00:00Z", joinedBefore: "2026-10-17T11:00:00Z" }).ok, false);
    assert.equal(readMassRequest({ action: "ban" }).ok, false);
    assert.equal(readMassRequest({ action: "ban", ids: [] }).ok, false);
  });

  test("only ban and kick are mass actions", () => {
    assert.equal(readMassRequest({ action: "timeout", ids: [ID_A] }).ok, false);
    assert.equal(readMassRequest({ ids: [ID_A] }).ok, false);
  });

  test("ids must be Discord user ids, and at most 200", () => {
    assert.equal(readMassRequest({ action: "ban", ids: ["abc"] }).ok, false);
    assert.equal(readMassRequest({ action: "ban", ids: [123] }).ok, false);
    const many = Array.from({ length: 201 }, (_, i) => String(100000000000000000n + BigInt(i)));
    assert.equal(readMassRequest({ action: "ban", ids: many }).ok, false);
    assert.equal(readMassRequest({ action: "ban", ids: many.slice(0, 200) }).ok, true);
  });

  test("a window must be ordered, whole, and at most seven days", () => {
    const window = (after: unknown, before: unknown) => readMassRequest({ action: "ban", joinedAfter: after, joinedBefore: before }).ok;
    assert.equal(window("2026-10-17T11:00:00Z", "2026-10-17T10:00:00Z"), false);
    assert.equal(window("2026-10-17T10:00:00Z", undefined), false);
    assert.equal(window("nonsense", "2026-10-17T10:00:00Z"), false);
    assert.equal(window("2026-10-01T00:00:00Z", "2026-10-17T00:00:00Z"), false);
    assert.equal(window("2026-10-10T00:00:00Z", "2026-10-17T00:00:00Z"), true);
  });

  test("the reason and the days of messages to delete are checked", () => {
    assert.equal(readMassRequest({ action: "ban", ids: [ID_A], reason: "x".repeat(501) }).ok, false);
    assert.equal(readMassRequest({ action: "ban", ids: [ID_A], reason: 5 }).ok, false);
    assert.equal(readMassRequest({ action: "ban", ids: [ID_A], deleteDays: 8 }).ok, false);
    assert.equal(readMassRequest({ action: "ban", ids: [ID_A], deleteDays: 1.5 }).ok, false);
    assert.equal(readMassRequest({ action: "kick", ids: [ID_A], deleteDays: 99 }).ok, true);
  });
});

describe("massSkip", () => {
  const actor = { id: "100", topRole: 10, isInstanceOwner: false, isServerOwner: false };
  const member = { topRole: 5, bannable: true, kickable: true };
  const target = (patch = {}) => ({ id: "200", member, isStaff: false, ...patch });
  const skip = (action: "ban" | "kick", t = target(), a = actor) => massSkip(action, t, a, "999", "300");

  test("an ordinary member below the actor goes ahead", () => {
    assert.equal(skip("ban"), null);
    assert.equal(skip("kick"), null);
  });

  test("the actor, the bot, the server owner and staff are left alone", () => {
    assert.ok(skip("ban", target({ id: "100" })));
    assert.ok(skip("ban", target({ id: "999" })));
    assert.ok(skip("ban", target({ id: "300" })));
    assert.ok(skip("ban", target({ isStaff: true })));
  });

  test("someone at or above the actor's top role is left alone, unless the actor owns the server or the install", () => {
    assert.ok(skip("ban", target({ member: { ...member, topRole: 10 } })));
    assert.ok(skip("ban", target({ member: { ...member, topRole: 11 } })));
    assert.equal(skip("ban", target({ member: { ...member, topRole: 11 } }), { ...actor, isServerOwner: true }), null);
    assert.equal(skip("ban", target({ member: { ...member, topRole: 11 } }), { ...actor, isInstanceOwner: true }), null);
  });

  test("a member the bot cannot ban or kick is left alone", () => {
    assert.ok(skip("ban", target({ member: { ...member, bannable: false } })));
    assert.equal(skip("kick", target({ member: { ...member, bannable: false } })), null);
    assert.ok(skip("kick", target({ member: { ...member, kickable: false } })));
  });

  test("someone not in the server can be banned by id but not kicked", () => {
    assert.equal(skip("ban", target({ member: null })), null);
    assert.ok(skip("kick", target({ member: null })));
  });

  test("an actor who is not in the server can only act as the person running the install", () => {
    const outside = { ...actor, topRole: null };
    assert.ok(skip("ban", target(), outside));
    assert.equal(skip("ban", target(), { ...outside, isInstanceOwner: true }), null);
  });
});

describe("appeals", () => {
  const row = {
    id: 3,
    guildId: "g",
    userId: ID_A,
    infractionId: 9,
    caseNumber: 12,
    text: "I was hacked.",
    status: "pending",
    createdAt: new Date("2026-10-16T10:00:00Z"),
    decidedAt: null,
    decidedBy: null,
    decidedByName: null,
    response: null,
    infraction: { reason: "Spam", createdAt: new Date("2026-10-10T10:00:00Z"), expiresAt: null, moderatorId: ID_B, voidedAt: null },
  };
  const ref = (id: string) => ({ userId: id, name: id === ID_A ? "Member" : id === ID_B ? "Mod" : null, avatarUrl: null }) as never;

  test("a pending appeal has no decision", () => {
    const dto = appealDto(row, ref);
    assert.equal(dto.status, "pending");
    assert.equal(dto.decided, null);
    assert.equal(dto.caseNumber, 12);
    assert.equal(dto.ban.removed, false);
  });

  test("a decided appeal shows who decided, when and what the member was told", () => {
    const dto = appealDto({ ...row, status: "denied", decidedAt: new Date("2026-10-17T10:00:00Z"), decidedBy: ID_B, decidedByName: "Old name", response: "Not yet." }, ref);
    assert.equal(dto.decided?.response, "Not yet.");
    assert.equal(dto.decided?.by.name, "Mod");
    assert.equal(dto.decided?.at, "2026-10-17T10:00:00.000Z");
  });

  test("the name saved with the decision is used when the person can no longer be looked up", () => {
    const dto = appealDto({ ...row, status: "accepted", decidedAt: new Date(), decidedBy: "555", decidedByName: "Saved name" }, ref);
    assert.equal(dto.decided?.by.name, "Saved name");
  });

  test("an unknown status reads as pending rather than breaking the tab", () => {
    assert.equal(appealDto({ ...row, status: "weird" }, ref).status, "pending");
  });

  test("the message to the member is optional, trimmed and at most 1000 characters", () => {
    assert.deepEqual(readResponse(undefined), { ok: true, value: null });
    assert.deepEqual(readResponse("   "), { ok: true, value: null });
    assert.deepEqual(readResponse("  Welcome back  "), { ok: true, value: "Welcome back" });
    assert.equal(readResponse("x".repeat(1001)).ok, false);
    assert.equal(readResponse(42).ok, false);
  });
});
