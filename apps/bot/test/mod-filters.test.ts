import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { auditWhere, infractionWhere, parseDay, parseInfractionSource, parseInfractionState, RESTRICTION_ACTIONS, stateWhere } from "../dist/control/mod/filters.js";

const GUILD = "100000000000000001";
const params = (query: string) => new URLSearchParams(query);

describe("parseDay", () => {
  test("reads a plain date as that UTC day", () => {
    assert.equal(parseDay("2026-10-09"), Date.UTC(2026, 9, 9));
    assert.equal(parseDay(" 2026-10-09 "), Date.UTC(2026, 9, 9));
  });

  test("reads a timestamp as the UTC day it falls on", () => {
    assert.equal(parseDay("2026-10-09T23:30:00Z"), Date.UTC(2026, 9, 9));
    assert.equal(parseDay("2026-10-09T23:30:00-05:00"), Date.UTC(2026, 9, 10));
  });

  test("ignores garbage and dates that do not exist", () => {
    for (const bad of ["", "yesterday", "2026-13-01", "2026-02-30", "10/09/2026", "2026-10-09junk", "2026-10-09Tnope"]) {
      assert.equal(parseDay(bad), null, bad);
    }
    assert.equal(parseDay(null), null);
  });

  test("accepts a leap day only in a leap year", () => {
    assert.notEqual(parseDay("2028-02-29"), null);
    assert.equal(parseDay("2026-02-29"), null);
  });
});

describe("auditWhere", () => {
  test("is only the guild with no filters", () => {
    assert.deepEqual(auditWhere(GUILD, params("")), { guildId: GUILD });
  });

  test("carries the existing exact filters", () => {
    assert.deepEqual(auditWhere(GUILD, params("kind=note.add&actorId=1&targetUserId=2")), {
      guildId: GUILD,
      kind: "note.add",
      actorId: "1",
      targetUserId: "2",
    });
  });

  test("the automod actor filter matches the role, not an id", () => {
    assert.deepEqual(auditWhere(GUILD, params("actorId=automod")), { guildId: GUILD, actorRole: "automod" });
  });

  test("until includes the whole of that day", () => {
    const where = auditWhere(GUILD, params("since=2026-10-01&until=2026-10-09"));
    assert.deepEqual(where.at, { gte: new Date("2026-10-01T00:00:00.000Z"), lt: new Date("2026-10-10T00:00:00.000Z") });
  });

  test("either bound can stand alone", () => {
    assert.deepEqual(auditWhere(GUILD, params("since=2026-10-01")).at, { gte: new Date("2026-10-01T00:00:00.000Z") });
    assert.deepEqual(auditWhere(GUILD, params("until=2026-10-01")).at, { lt: new Date("2026-10-02T00:00:00.000Z") });
  });

  test("a bad date is dropped without dropping the other bound", () => {
    const where = auditWhere(GUILD, params("since=nope&until=2026-10-01"));
    assert.deepEqual(where.at, { lt: new Date("2026-10-02T00:00:00.000Z") });
    assert.equal(auditWhere(GUILD, params("since=nope&until=also-nope")).at, undefined);
  });

  test("q searches the summary, trimmed and bounded", () => {
    assert.deepEqual(auditWhere(GUILD, params("q=%20 removed ")).summary, { contains: "removed" });
    assert.equal(auditWhere(GUILD, params("q=%20%20")).summary, undefined);
    const long = auditWhere(GUILD, params(`q=${"a".repeat(500)}`)).summary as { contains: string };
    assert.equal(long.contains.length, 200);
  });
});

describe("infractionWhere", () => {
  test("is only the guild with no filters", () => {
    assert.deepEqual(infractionWhere(GUILD, params("")), { guildId: GUILD });
  });

  test("status separates removed from kept", () => {
    assert.equal(infractionWhere(GUILD, params("status=active")).voidedAt, null);
    assert.deepEqual(infractionWhere(GUILD, params("status=voided")).voidedAt, { not: null });
    assert.equal(infractionWhere(GUILD, params("status=all")).voidedAt, undefined);
  });

  test("q looks in reasons, and also matches case numbers and ids when it is shaped like one", () => {
    assert.deepEqual(infractionWhere(GUILD, params("q=spam")).AND, [{ OR: [{ reason: { contains: "spam" } }] }]);
    assert.deepEqual(infractionWhere(GUILD, params("q=12")).AND, [{ OR: [{ reason: { contains: "12" } }, { caseNumber: 12 }] }]);
    const id = "123456789012345678";
    assert.deepEqual(infractionWhere(GUILD, params(`q=${id}`)).AND, [
      { OR: [{ reason: { contains: id } }, { userId: id }, { moderatorId: id }] },
    ]);
  });

  test("exact filters apply together", () => {
    const where = infractionWhere(GUILD, params("action=ban&moderatorId=5&userId=6"));
    assert.equal(where.action, "ban");
    assert.equal(where.moderatorId, "5");
    assert.equal(where.userId, "6");
  });
});

describe("infraction source filter", () => {
  test("automod keeps only the automod actions", () => {
    assert.deepEqual(infractionWhere(GUILD, params("source=automod")).AND, [{ action: { startsWith: "automod-" } }]);
  });

  test("manual keeps everything that is not an automod action", () => {
    assert.deepEqual(infractionWhere(GUILD, params("source=manual")).AND, [
      { NOT: { action: { startsWith: "automod-" } } },
    ]);
  });

  test("all, a missing value and an unknown value add no restriction", () => {
    for (const query of ["", "source=all", "source=bot", "source=AUTOMOD", "source="]) {
      assert.deepEqual(infractionWhere(GUILD, params(query)), { guildId: GUILD }, query);
    }
    assert.equal(parseInfractionSource(null), "all");
  });

  test("combines with the other filters", () => {
    const where = infractionWhere(GUILD, params("source=automod&action=automod-warn&userId=6&state=onrecord&q=spam"));
    assert.equal(where.action, "automod-warn");
    assert.equal(where.userId, "6");
    assert.deepEqual(where.AND, [
      { action: { startsWith: "automod-" } },
      { voidedAt: null },
      { OR: [{ reason: { contains: "spam" } }] },
    ]);
  });
});

describe("infraction state filter", () => {
  const NOW = new Date("2026-10-09T12:00:00Z");

  test("restrictions are the ones the shared rule treats as restrictions", () => {
    assert.deepEqual([...RESTRICTION_ACTIONS].sort(), ["automod-timeout", "ban", "timeout"]);
  });

  test("reads the five states and ignores anything else", () => {
    for (const state of ["all", "onrecord", "inforce", "expired", "removed"]) {
      assert.equal(parseInfractionState(state), state);
    }
    assert.equal(parseInfractionState("active"), null);
    assert.equal(parseInfractionState(null), null);
  });

  test("onrecord and removed split on whether staff removed the entry", () => {
    assert.deepEqual(stateWhere("onrecord", NOW), { voidedAt: null });
    assert.deepEqual(stateWhere("removed", NOW), { voidedAt: { not: null } });
    assert.deepEqual(stateWhere("all", NOW), {});
  });

  test("inforce needs the active flag, a restricting action and no end or a future one", () => {
    assert.deepEqual(stateWhere("inforce", NOW), {
      voidedAt: null,
      active: true,
      action: { in: RESTRICTION_ACTIONS },
      OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
    });
  });

  test("expired is a restriction still on the record that was cleared or ran out", () => {
    assert.deepEqual(stateWhere("expired", NOW), {
      voidedAt: null,
      action: { in: RESTRICTION_ACTIONS },
      OR: [{ active: false }, { expiresAt: { lte: NOW } }],
    });
  });

  test("state wins over the older status parameter", () => {
    const where = infractionWhere(GUILD, params("state=inforce&status=voided"), NOW);
    assert.equal(where.voidedAt, undefined);
    assert.deepEqual(where.AND, [stateWhere("inforce", NOW)]);
  });

  test("status still works alone and when state is not recognised", () => {
    assert.equal(infractionWhere(GUILD, params("status=active"), NOW).voidedAt, null);
    assert.deepEqual(infractionWhere(GUILD, params("status=voided&state=bogus"), NOW).voidedAt, { not: null });
  });

  test("state and a search term are both applied", () => {
    const where = infractionWhere(GUILD, params("state=expired&q=spam"), NOW);
    assert.equal(where.AND?.length, 2);
  });
});
