import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { automodRuleOf, computeStats, type StatsInfraction } from "../src/control/mod/stats-calc.ts";

const NOW = new Date("2026-10-09T15:30:00Z");
const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
function row(overrides: Partial<StatsInfraction> & { at: string }): StatsInfraction {
  counter++;
  const { at, ...rest } = overrides;
  return {
    userId: `u${counter}`,
    moderatorId: "m1",
    action: "warn",
    createdAt: new Date(at),
    expiresAt: null,
    active: false,
    voidedAt: null,
    ...rest,
  };
}

const run = (infractions: StatsInfraction[], days = 7, notes: { authorId: string; createdAt: Date }[] = []) =>
  computeStats({ infractions, notes, now: NOW, days });

describe("computeStats range", () => {
  test("an empty range still lists every day with zeros", () => {
    const stats = run([], 7);
    assert.equal(stats.perDay.length, 7);
    assert.equal(stats.perDay[0]!.date, "2026-10-03");
    assert.equal(stats.perDay[6]!.date, "2026-10-09");
    assert.ok(stats.perDay.every((day) => day.warn + day.timeout + day.kick + day.ban + day.other === 0));
    assert.equal(stats.totals.actions, 0);
    assert.deepEqual(stats.moderators, []);
    assert.deepEqual(stats.topMembers, []);
    assert.equal(stats.byHour.length, 24);
    assert.equal(stats.repeatRate, null);
    assert.equal(stats.since, "2026-10-03T00:00:00.000Z");
  });

  test("a one day range is today in UTC", () => {
    const stats = run([row({ at: "2026-10-09T00:00:00Z" }), row({ at: "2026-10-08T23:59:59Z" })], 1);
    assert.equal(stats.perDay.length, 1);
    assert.equal(stats.totals.actions, 1);
  });

  test("the first and last instants of the range count, anything outside does not", () => {
    const stats = run(
      [
        row({ at: "2026-10-03T00:00:00Z" }),
        row({ at: "2026-10-02T23:59:59.999Z" }),
        row({ at: "2026-10-09T15:30:00Z" }),
        row({ at: "2026-10-09T15:30:01Z" }),
      ],
      7,
    );
    assert.equal(stats.totals.actions, 2);
    assert.equal(stats.perDay[0]!.warn, 1);
    assert.equal(stats.perDay[6]!.warn, 1);
  });

  test("hours are bucketed in UTC", () => {
    const stats = run([row({ at: "2026-10-05T23:59:00Z" }), row({ at: "2026-10-06T00:01:00Z" })]);
    assert.equal(stats.byHour[23], 1);
    assert.equal(stats.byHour[0], 1);
    assert.equal(stats.perDay[2]!.warn, 1);
    assert.equal(stats.perDay[3]!.warn, 1);
  });
});

describe("computeStats counting", () => {
  test("voided entries are excluded from every action figure but counted as voided", () => {
    const stats = run([
      row({ at: "2026-10-08T10:00:00Z", moderatorId: "m1" }),
      row({ at: "2026-10-08T11:00:00Z", moderatorId: "m1", voidedAt: new Date("2026-10-09T00:00:00Z") }),
      row({ at: "2026-09-01T11:00:00Z", moderatorId: "m1", voidedAt: new Date("2026-09-02T00:00:00Z") }),
    ]);
    assert.equal(stats.totals.actions, 1);
    assert.equal(stats.totals.warns, 1);
    assert.equal(stats.totals.voided, 1);
    assert.equal(stats.byAction.length, 1);
    assert.equal(stats.byHour.reduce((a, b) => a + b, 0), 1);
    assert.equal(stats.moderators[0]!.total, 1);
    assert.equal(stats.moderators[0]!.voided, 1);
    assert.equal(stats.topMembers.length, 1);
  });

  test("a member with only voided entries has no record", () => {
    const stats = run([row({ at: "2026-10-08T10:00:00Z", voidedAt: NOW })]);
    assert.equal(stats.totals.membersWithRecord, 0);
  });

  test("membersWithRecord looks back past the range and counts distinct members", () => {
    const stats = run([
      row({ at: "2026-01-01T00:00:00Z", userId: "a" }),
      row({ at: "2026-10-08T00:00:00Z", userId: "a" }),
      row({ at: "2026-02-01T00:00:00Z", userId: "b" }),
    ]);
    assert.equal(stats.totals.membersWithRecord, 2);
    assert.equal(stats.totals.actions, 1);
  });

  test("each action kind lands in its own column, the rest in other", () => {
    const stats = run([
      row({ at: "2026-10-09T01:00:00Z", action: "warn" }),
      row({ at: "2026-10-09T01:00:00Z", action: "timeout" }),
      row({ at: "2026-10-09T01:00:00Z", action: "kick" }),
      row({ at: "2026-10-09T01:00:00Z", action: "ban" }),
      row({ at: "2026-10-09T01:00:00Z", action: "unban" }),
    ]);
    assert.deepEqual(stats.perDay[6], { date: "2026-10-09", warn: 1, timeout: 1, kick: 1, ban: 1, other: 1 });
    assert.equal(stats.totals.unbans, 1);
    assert.equal(stats.totals.actions, 5);
    assert.equal(stats.moderators[0]!.total, 5);
    assert.equal(stats.moderators[0]!.ban, 1);
  });

  test("activeNow ignores voided, expired and inactive entries, whatever their age", () => {
    const stats = run([
      row({ at: "2026-10-09T10:00:00Z", action: "timeout", active: true, expiresAt: new Date(NOW.getTime() + DAY) }),
      row({ at: "2026-05-01T10:00:00Z", action: "ban", active: true, expiresAt: null }),
      row({ at: "2026-10-09T10:00:00Z", action: "timeout", active: true, expiresAt: new Date(NOW.getTime() - 1) }),
      row({ at: "2026-10-09T10:00:00Z", action: "timeout", active: true, expiresAt: new Date(NOW.getTime() + DAY), voidedAt: NOW }),
      row({ at: "2026-10-09T10:00:00Z", action: "warn", active: false }),
      row({ at: "2026-10-09T10:00:00Z", action: "warn", active: true }),
      row({ at: "2026-10-09T10:00:00Z", action: "kick", active: true }),
    ]);
    assert.equal(stats.totals.activeNow, 2);
  });

  test("notes are counted in range, per author, and create a moderator row", () => {
    const stats = run([row({ at: "2026-10-08T00:00:00Z", moderatorId: "m1" })], 7, [
      { authorId: "m2", createdAt: new Date("2026-10-08T00:00:00Z") },
      { authorId: "m2", createdAt: new Date("2026-10-09T00:00:00Z") },
      { authorId: "m1", createdAt: new Date("2026-10-04T00:00:00Z") },
      { authorId: "m1", createdAt: new Date("2026-08-04T00:00:00Z") },
    ]);
    assert.equal(stats.totals.notes, 3);
    const m2 = stats.moderators.find((m) => m.userId === "m2")!;
    assert.equal(m2.notes, 2);
    assert.equal(m2.total, 0);
    assert.equal(m2.lastActionAt, null);
    assert.equal(stats.moderators.find((m) => m.userId === "m1")!.notes, 1);
  });

  test("lastActionAt is the newest non-voided action", () => {
    const stats = run([
      row({ at: "2026-10-05T10:00:00Z" }),
      row({ at: "2026-10-07T10:00:00Z" }),
      row({ at: "2026-10-08T10:00:00Z", voidedAt: NOW }),
    ]);
    assert.equal(stats.moderators[0]!.lastActionAt, "2026-10-07T10:00:00.000Z");
  });
});

describe("computeStats ordering", () => {
  test("ties break by name so the output is stable", () => {
    const stats = run([
      row({ at: "2026-10-08T00:00:00Z", moderatorId: "mB", action: "kick", userId: "x2" }),
      row({ at: "2026-10-08T00:00:00Z", moderatorId: "mA", action: "ban", userId: "x1" }),
    ]);
    assert.deepEqual(stats.moderators.map((m) => m.userId), ["mA", "mB"]);
    assert.deepEqual(stats.byAction.map((a) => a.action), ["ban", "kick"]);
    assert.deepEqual(stats.topMembers.map((m) => m.userId), ["x1", "x2"]);
  });

  test("busiest comes first and topMembers is capped at ten", () => {
    const rows = [
      ...Array.from({ length: 15 }, () => row({ at: "2026-10-08T00:00:00Z", moderatorId: "busy", userId: "heavy" })),
      row({ at: "2026-10-08T00:00:00Z", moderatorId: "quiet" }),
      ...Array.from({ length: 12 }, (_, i) => row({ at: "2026-10-08T00:00:00Z", moderatorId: "quiet", userId: `p${i}` })),
    ];
    const stats = run(rows);
    assert.equal(stats.moderators[0]!.userId, "busy");
    assert.equal(stats.topMembers.length, 10);
    assert.deepEqual(stats.topMembers[0], { userId: "heavy", count: 15 });
  });
});

describe("computeStats repeatRate", () => {
  const members = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

  test("is null with fewer than five members actioned in the range", () => {
    const stats = run(members(4).map((userId) => row({ at: "2026-10-08T00:00:00Z", userId })));
    assert.equal(stats.repeatRate, null);
  });

  test("is a share between 0 and 1 once there are five members", () => {
    const rows = [
      ...members(5).map((userId) => row({ at: "2026-10-05T00:00:00Z", userId })),
      row({ at: "2026-10-08T00:00:00Z", userId: "r0" }),
      row({ at: "2026-10-08T00:00:00Z", userId: "r1" }),
    ];
    assert.equal(run(rows).repeatRate, 2 / 5);
  });

  test("a prior action before the range counts, and exactly 30 days apart still counts", () => {
    const base = members(5).map((userId) => row({ at: "2026-10-08T00:00:00Z", userId }));
    const withPrior = [...base, row({ at: "2026-09-08T00:00:00Z", userId: "r0" }), row({ at: "2026-08-01T00:00:00Z", userId: "r1" })];
    assert.equal(run(withPrior).repeatRate, 1 / 5);
  });

  test("a voided prior action does not make a member a repeat", () => {
    const rows = [
      ...members(5).map((userId) => row({ at: "2026-10-08T00:00:00Z", userId })),
      row({ at: "2026-10-01T00:00:00Z", userId: "r0", voidedAt: NOW }),
    ];
    assert.equal(run(rows).repeatRate, 0);
  });

  test("members only actioned before the range are not in the denominator", () => {
    const rows = [
      ...members(5).map((userId) => row({ at: "2026-10-08T00:00:00Z", userId })),
      ...members(5).map((_, i) => row({ at: "2026-06-01T00:00:00Z", userId: `old${i}` })),
    ];
    assert.equal(run(rows).repeatRate, 0);
  });
});

describe("computeStats previous", () => {
  const note = (at: string, authorId = "m1") => ({ authorId, createdAt: new Date(at) });

  test("is null when nothing at all predates the range", () => {
    assert.equal(run([]).previous, null);
    assert.equal(run([row({ at: "2026-10-03T00:00:00Z" })]).previous, null);
    assert.equal(run([], 7, [note("2026-10-05T00:00:00Z")]).previous, null);
  });

  test("an infraction or a note just before the range is enough to make a comparison", () => {
    assert.notEqual(run([row({ at: "2026-10-02T23:59:59.999Z" })]).previous, null);
    assert.notEqual(run([], 7, [note("2026-10-02T23:59:59.999Z")]).previous, null);
  });

  test("older history alone gives a comparison of zeros", () => {
    const previous = run([row({ at: "2026-01-01T00:00:00Z" })]).previous!;
    assert.equal(previous.actions, 0);
    assert.equal(previous.warns, 0);
    assert.equal(previous.notes, 0);
  });

  test("a removed action before the range still counts as history", () => {
    const stats = run([row({ at: "2026-09-30T00:00:00Z", voidedAt: NOW })]);
    assert.equal(stats.previous?.voided, 1);
    assert.equal(stats.previous?.actions, 0);
  });

  test("covers the same stretch of time shifted back by the range length, so a part day meets a part day", () => {
    // NOW is 15:30, so the comparison window is 09-26 00:00 up to but not including 10-02 15:30.
    const stats = run([
      row({ at: "2026-09-25T23:59:59.999Z" }),
      row({ at: "2026-09-26T00:00:00Z" }),
      row({ at: "2026-10-02T15:29:59.999Z" }),
      row({ at: "2026-10-02T15:30:00Z" }),
      row({ at: "2026-10-03T00:00:00Z" }),
    ]);
    assert.equal(stats.previous?.actions, 2);
    assert.equal(stats.totals.actions, 1);
  });

  test("counts each kind by the same rules as the current totals", () => {
    const stats = run([
      row({ at: "2026-09-28T01:00:00Z", action: "warn" }),
      row({ at: "2026-09-28T01:00:00Z", action: "warn" }),
      row({ at: "2026-09-28T01:00:00Z", action: "timeout" }),
      row({ at: "2026-09-28T01:00:00Z", action: "kick" }),
      row({ at: "2026-09-28T01:00:00Z", action: "ban" }),
      row({ at: "2026-09-28T01:00:00Z", action: "unban" }),
      row({ at: "2026-09-28T01:00:00Z", action: "warn", voidedAt: NOW }),
    ]);
    const previous = stats.previous!;
    assert.equal(previous.actions, 6);
    assert.equal(previous.warns, 2);
    assert.equal(previous.timeouts, 1);
    assert.equal(previous.kicks, 1);
    assert.equal(previous.bans, 1);
    assert.equal(previous.unbans, 1);
    assert.equal(previous.voided, 1);
  });

  test("notes are counted by creation date, including ones later deleted", () => {
    const stats = run([row({ at: "2026-08-01T00:00:00Z" })], 7, [
      note("2026-09-26T00:00:00Z"),
      note("2026-10-02T15:00:00Z"),
      note("2026-10-02T16:00:00Z"),
      note("2026-09-25T23:00:00Z"),
      note("2026-10-03T00:00:00Z"),
    ]);
    assert.equal(stats.previous?.notes, 2);
    assert.equal(stats.totals.notes, 1);
  });

  test("members with a record are counted as of the end of the comparison window", () => {
    const stats = run([
      row({ at: "2026-09-28T00:00:00Z", userId: "a", action: "ban", active: true }),
      row({ at: "2026-09-28T00:00:00Z", userId: "a" }),
      row({ at: "2026-09-29T00:00:00Z", userId: "c", voidedAt: NOW }),
      row({ at: "2026-10-05T00:00:00Z", userId: "b" }),
    ]);
    assert.equal(stats.totals.membersWithRecord, 2);
    assert.equal(stats.previous?.membersWithRecord, 1);
  });

  test("activeNow in the comparison is a copy of the current figure", () => {
    const stats = run([
      row({ at: "2026-09-28T00:00:00Z", userId: "a", action: "ban", active: true }),
      row({ at: "2026-10-05T00:00:00Z", userId: "b" }),
    ]);
    assert.equal(stats.totals.activeNow, 1);
    assert.equal(stats.previous?.activeNow, 1);
  });

  test("matches what the range itself would have reported at the end of that period", () => {
    const infractions = [
      row({ at: "2026-09-26T05:00:00Z", action: "kick" }),
      row({ at: "2026-09-29T05:00:00Z", action: "warn" }),
      row({ at: "2026-09-30T05:00:00Z", action: "warn", voidedAt: NOW }),
      row({ at: "2026-10-02T15:29:59.999Z", action: "ban" }),
      row({ at: "2026-09-01T00:00:00Z", action: "warn" }),
      row({ at: "2026-10-05T00:00:00Z", action: "warn" }),
    ];
    const notes = [note("2026-09-27T00:00:00Z"), note("2026-10-04T00:00:00Z")];
    const earlier = computeStats({ infractions, notes, now: new Date("2026-10-02T15:29:59.999Z"), days: 7 });
    const windowCounts = (totals: Record<string, number>) => {
      const { membersWithRecord, activeNow, ...counts } = totals;
      void membersWithRecord;
      void activeNow;
      return counts;
    };
    assert.deepEqual(windowCounts(run(infractions, 7, notes).previous!), windowCounts(earlier.totals));
  });

  test("a one day range compares with the whole day before", () => {
    const stats = run(
      [row({ at: "2026-10-08T12:00:00Z" }), row({ at: "2026-10-07T23:59:59Z" }), row({ at: "2026-10-09T01:00:00Z" })],
      1,
    );
    assert.equal(stats.totals.actions, 1);
    assert.equal(stats.previous?.actions, 1);
  });
});

describe("computeStats restriction rule", () => {
  test("an automod timeout in force counts as active, an expired one does not", () => {
    const stats = run([
      row({ at: "2026-10-09T10:00:00Z", action: "automod-timeout", active: true, expiresAt: new Date(NOW.getTime() + DAY) }),
      row({ at: "2026-10-09T10:00:00Z", action: "automod-timeout", active: true, expiresAt: new Date(NOW.getTime() - 1) }),
      row({ at: "2026-10-09T10:00:00Z", action: "timeout", active: true, expiresAt: new Date(NOW.getTime() - 1) }),
      row({ at: "2026-10-09T10:00:00Z", action: "automod-warn", active: true }),
    ]);
    assert.equal(stats.totals.activeNow, 1);
  });
});

describe("computeStats repeatRate scope", () => {
  const five = (extra: StatsInfraction[]) => [
    ...["a", "b", "c", "d", "e"].map((userId) => row({ at: "2026-10-08T00:00:00Z", userId })),
    ...extra,
  ];

  test("a reversal after an action does not make the member a repeat", () => {
    const rows = five([
      row({ at: "2026-10-09T00:00:00Z", userId: "a", action: "unban" }),
      row({ at: "2026-10-09T00:00:00Z", userId: "b", action: "timeout-clear" }),
    ]);
    assert.equal(run(rows).repeatRate, 0);
  });

  test("automod entries neither join the actioned members nor repeat them", () => {
    const rows = five([
      row({ at: "2026-10-09T00:00:00Z", userId: "a", action: "automod-warn" }),
      row({ at: "2026-10-09T00:00:00Z", userId: "z1", action: "automod-delete" }),
      row({ at: "2026-10-09T00:00:00Z", userId: "z2", action: "automod-timeout" }),
    ]);
    assert.equal(run(rows).repeatRate, 0);
  });

  test("a member with only reversals is not counted as actioned", () => {
    const rows = [
      ...["a", "b", "c", "d"].map((userId) => row({ at: "2026-10-08T00:00:00Z", userId })),
      row({ at: "2026-10-08T00:00:00Z", userId: "u", action: "unban" }),
    ];
    assert.equal(run(rows).repeatRate, null);
  });

  test("a real repeat still counts next to ignored rows", () => {
    const rows = five([
      row({ at: "2026-10-09T00:00:00Z", userId: "a", action: "warn" }),
      row({ at: "2026-10-09T00:00:00Z", userId: "b", action: "unban" }),
    ]);
    assert.equal(run(rows).repeatRate, 1 / 5);
  });
});

describe("automod figures", () => {
  const hit = (at: string, reason: string | null | undefined, extra: Partial<StatsInfraction> = {}) =>
    row({ at, action: "automod-warn", reason, ...extra });

  test("an empty history has no hits and no rules", () => {
    assert.deepEqual(run([]).automod, { total: 0, previousTotal: null, byRule: [] });
  });

  test("counts all three automod kinds in the range and leaves manual actions out", () => {
    const stats = run([
      row({ at: "2026-10-08T00:00:00Z", action: "automod-warn", reason: "links: example.com" }),
      row({ at: "2026-10-08T00:00:00Z", action: "automod-timeout", reason: "rateLimit" }),
      row({ at: "2026-10-08T00:00:00Z", action: "automod-delete", reason: "invites" }),
      row({ at: "2026-10-08T00:00:00Z", action: "warn", reason: "links: by hand" }),
    ]);
    assert.equal(stats.automod.total, 3);
    assert.equal(stats.totals.actions, 4);
  });

  test("removed entries are excluded", () => {
    const stats = run([
      hit("2026-10-08T00:00:00Z", "links"),
      hit("2026-10-08T00:00:00Z", "links", { voidedAt: new Date("2026-10-08T01:00:00Z") }),
    ]);
    assert.equal(stats.automod.total, 1);
    assert.deepEqual(stats.automod.byRule, [{ rule: "links", count: 1 }]);
  });

  test("previousTotal counts the equally long window before, and is null without history", () => {
    const withHistory = run([
      hit("2026-10-08T00:00:00Z", "links"),
      hit("2026-10-01T00:00:00Z", "links"),
      hit("2026-10-02T00:00:00Z", "links"),
      hit("2026-10-02T00:00:00Z", "links", { voidedAt: new Date("2026-10-03T00:00:00Z") }),
      hit("2026-09-20T00:00:00Z", "links"),
    ]);
    assert.equal(withHistory.automod.total, 1);
    assert.equal(withHistory.automod.previousTotal, 2);

    const noHistory = run([hit("2026-10-08T00:00:00Z", "links")]);
    assert.equal(noHistory.previous, null);
    assert.equal(noHistory.automod.previousTotal, null);
  });

  test("history that is only manual gives a previous total of zero", () => {
    const stats = run([row({ at: "2026-09-30T00:00:00Z" }), hit("2026-10-08T00:00:00Z", "links")]);
    assert.equal(stats.automod.previousTotal, 0);
  });

  test("groups by the text before the first colon, folded to lower case, busiest first", () => {
    const stats = run([
      hit("2026-10-08T00:00:00Z", "Links: a.com"),
      hit("2026-10-08T00:00:00Z", " links : b.com"),
      hit("2026-10-08T00:00:00Z", "links"),
      hit("2026-10-08T00:00:00Z", "invites: discord.gg/x: extra"),
      hit("2026-10-08T00:00:00Z", "bannedWords: word"),
    ]);
    assert.deepEqual(stats.automod.byRule, [
      { rule: "links", count: 3 },
      { rule: "bannedwords", count: 1 },
      { rule: "invites", count: 1 },
    ]);
  });

  test("an empty, blank or missing reason groups under unknown", () => {
    const stats = run([
      hit("2026-10-08T00:00:00Z", ""),
      hit("2026-10-08T00:00:00Z", "   "),
      hit("2026-10-08T00:00:00Z", null),
      hit("2026-10-08T00:00:00Z", undefined),
      hit("2026-10-08T00:00:00Z", ": detail only"),
    ]);
    assert.deepEqual(stats.automod.byRule, [{ rule: "unknown", count: 5 }]);
  });

  test("more than ten rules fold the tail into other", () => {
    const rows: StatsInfraction[] = [];
    for (let i = 0; i < 12; i++) {
      for (let n = 0; n <= 12 - i; n++) rows.push(hit("2026-10-08T00:00:00Z", `rule${String(i).padStart(2, "0")}`));
    }
    const { byRule, total } = run(rows).automod;
    assert.equal(byRule.length, 11);
    assert.equal(byRule[0]!.rule, "rule00");
    assert.equal(byRule[10]!.rule, "other");
    assert.equal(byRule[10]!.count, 3 + 2);
    assert.equal(byRule.reduce((sum, item) => sum + item.count, 0), total);
  });

  test("exactly ten rules gets no other bucket", () => {
    const rows = Array.from({ length: 10 }, (_, i) => hit("2026-10-08T00:00:00Z", `r${i}`));
    assert.equal(run(rows).automod.byRule.length, 10);
  });

  test("automodRuleOf", () => {
    assert.equal(automodRuleOf("capitals: 80% capitals"), "capitals");
    assert.equal(automodRuleOf(undefined), "unknown");
  });
});
