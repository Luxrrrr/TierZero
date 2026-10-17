import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { AuditDto, InfractionDto, NoteDto, UserRef } from "@tier0/core";
import type { MemberProfile } from "@tier0/core";
import {
  activitySeries,
  applyPending,
  buildTimeline,
  counterTone,
  countByFilter,
  dayKey,
  dayLabel,
  diffSnapshots,
  expiryState,
  filterTimeline,
  formatDate,
  formatDateTime,
  groupByDay,
  historyFor,
  pendingKey,
  purgeConfirmed,
  quickFacts,
  recordCounts,
  snapshotText,
  sparkPoints,
  standingOf,
  standingWithDiscord,
  removalLifts,
  limitToShow,
  TIMELINE_PAGE,
} from "../app/guilds/[id]/mod/members/[userId]/timeline.ts";
import {
  canAddNote,
  canRestoreOwnRemoval,
  infractionControls,
  noteControls,
  seesAudit,
  seesQuickFacts,
} from "../app/guilds/[id]/mod/members/[userId]/permissions.ts";

const user = (userId: string): UserRef => ({ userId, name: userId, avatarUrl: null, inServer: true });

/**
 * Shaped like the bot's rows: every new entry is stored with `active: true`,
 * warns and kicks included, and a timeout keeps it after it runs out. Tests
 * that assumed otherwise would pass against data the bot never sends.
 */
function infraction(id: number, action: string, createdAt: string, extra: Partial<InfractionDto> = {}): InfractionDto {
  return {
    id,
    caseNumber: id,
    user: user("100"),
    moderator: user("200"),
    action,
    reason: null,
    createdAt,
    expiresAt: null,
    active: true,
    voided: null,
    ...extra,
  };
}

function note(id: number, createdAt: string, extra: Partial<NoteDto> = {}): NoteDto {
  return {
    id,
    user: user("100"),
    author: user("200"),
    content: "text",
    createdAt,
    updatedAt: createdAt,
    edited: false,
    deleted: null,
    ...extra,
  };
}

function audit(id: number, kind: AuditDto["kind"], at: string, extra: Partial<AuditDto> = {}): AuditDto {
  return {
    id,
    at,
    actor: { userId: "200", name: "Mod", role: "mod" },
    kind,
    label: kind,
    summary: "",
    targetUser: null,
    infractionId: null,
    noteId: null,
    before: null,
    after: null,
    ...extra,
  };
}

const profile = {
  infractions: [infraction(1, "warn", "2026-01-03T00:00:00Z"), infraction(2, "ban", "2026-01-01T00:00:00Z")],
  notes: [note(5, "2026-01-02T00:00:00Z")],
  audit: [
    audit(9, "infraction.void", "2026-01-04T00:00:00Z", { infractionId: 1 }),
    audit(8, "note.add", "2026-01-02T00:00:00Z", { noteId: 5 }),
    // About a case that is not on the timeline (purged since), so it has no card to fold into.
    audit(10, "action.take", "2026-01-05T00:00:00Z", { infractionId: 99 }),
  ],
};

describe("buildTimeline", () => {
  test("merges the three sources newest first", () => {
    const keys = buildTimeline(profile, true).map((item) => item.key);
    assert.deepEqual(keys, ["a10", "i1", "n5", "i2"]);
  });

  test("folds staff activity about a case or note on the timeline into that card instead of repeating it", () => {
    const keys = buildTimeline(profile, true).map((item) => item.key);
    assert.ok(!keys.includes("a9"), "the removal of case 1 is in case 1's history");
    const withNoteEdit = { ...profile, audit: [...profile.audit, audit(11, "note.edit", "2026-01-06T00:00:00Z", { noteId: 5 })] };
    assert.ok(!buildTimeline(withNoteEdit, true).some((item) => item.key === "a11"));
    assert.deepEqual(historyFor(profile.audit, { infractionId: 1 }).map((entry) => entry.id), [9]);
  });

  test("leaves out audit entries when the viewer cannot read them", () => {
    const keys = buildTimeline(profile, false).map((item) => item.key);
    assert.deepEqual(keys, ["i1", "n5", "i2"]);
  });

  test("keeps equal timestamps in a stable order", () => {
    const same = "2026-02-01T00:00:00Z";
    const items = buildTimeline(
      { infractions: [infraction(1, "warn", same)], notes: [note(1, same)], audit: [audit(1, "note.edit", same)] },
      true,
    );
    assert.deepEqual(
      items.map((item) => item.kind),
      ["infraction", "note", "audit"],
    );
  });
});

describe("filterTimeline", () => {
  const items = buildTimeline(profile, true);

  test("filters to each record type", () => {
    assert.equal(filterTimeline(items, "actions").length, 2);
    assert.equal(filterTimeline(items, "notes").length, 1);
    assert.equal(filterTimeline(items, "staff").length, 1);
    assert.equal(filterTimeline(items, "all").length, 4);
  });

  test("counts match the filters", () => {
    assert.deepEqual(countByFilter(items), { all: 4, actions: 2, notes: 1, staff: 1 });
  });
});

describe("historyFor", () => {
  test("returns only entries for the target, without the original add", () => {
    const entries = [
      audit(1, "note.add", "2026-01-01T00:00:00Z", { noteId: 5 }),
      audit(2, "note.edit", "2026-01-02T00:00:00Z", { noteId: 5 }),
      audit(3, "note.edit", "2026-01-02T00:00:00Z", { noteId: 6 }),
    ];
    assert.deepEqual(
      historyFor(entries, { noteId: 5 }).map((entry) => entry.id),
      [2],
    );
  });
});

describe("snapshotText", () => {
  test("reads note content", () => {
    assert.equal(snapshotText({ content: "hello" }), "hello");
    assert.equal(snapshotText("plain"), "plain");
  });

  test("lists scalar fields and skips empty ones", () => {
    assert.equal(snapshotText({ reason: "spam", expiresAt: null, nested: { a: 1 } }), "reason: spam");
  });

  test("returns null when there is nothing to show", () => {
    assert.equal(snapshotText(null), null);
    assert.equal(snapshotText({}), null);
    assert.equal(snapshotText("  "), null);
  });
});

/** One member's record as the bot returns it, newest first, at 2026-10-10 12:00 UTC. */
const RECORD_NOW = new Date("2026-10-10T12:00:00Z");
const record = {
  timeoutNow: infraction(70, "timeout", "2026-10-10T09:00:00Z", { expiresAt: "2026-10-11T09:00:00Z" }),
  warn: infraction(69, "warn", "2026-10-09T09:00:00Z"),
  timeoutOver: infraction(68, "timeout", "2026-10-01T09:00:00Z", { expiresAt: "2026-10-01T10:00:00Z" }),
  kick: infraction(67, "kick", "2026-09-20T09:00:00Z"),
  ban: infraction(66, "ban", "2026-09-01T09:00:00Z"),
  unban: infraction(65, "unban", "2026-08-01T09:00:00Z"),
  liftedBan: infraction(64, "ban", "2026-07-01T09:00:00Z", { active: false }),
  removedTimeout: infraction(63, "timeout", "2026-10-10T08:00:00Z", {
    expiresAt: "2026-10-12T08:00:00Z",
    voided: { at: "2026-10-10T08:30:00Z", by: user("300"), reason: "wrong member" },
  }),
};

describe("expiryState", () => {
  const now = RECORD_NOW;

  test("a timeout before its end is in force until then", () => {
    assert.deepEqual(expiryState(record.timeoutNow, now), { state: "active", until: "2026-10-11T09:00:00Z" });
  });

  test("a timeout past its end shows as ended although the bot left it active", () => {
    assert.deepEqual(expiryState(record.timeoutOver, now), { state: "ended", at: "2026-10-01T10:00:00Z" });
  });

  test("warns, kicks and unbans never show as in force", () => {
    assert.equal(expiryState(record.warn, now).state, "none");
    assert.equal(expiryState(record.kick, now).state, "none");
    assert.equal(expiryState(record.unban, now).state, "none");
  });

  test("a ban with no end is in force; a lifted one has ended with no date", () => {
    assert.deepEqual(expiryState(record.ban, now), { state: "active", until: null });
    assert.deepEqual(expiryState(record.liftedBan, now), { state: "ended", at: null });
  });

  test("says nothing for a removed entry, even one whose end is still ahead", () => {
    assert.equal(expiryState(record.removedTimeout, now).state, "none");
  });
});

describe("infractionControls", () => {
  const warn = infraction(1, "warn", "2026-01-01T00:00:00Z");
  const ban = infraction(2, "ban", "2026-01-01T00:00:00Z");
  const removedWarn = infraction(3, "warn", "2026-01-01T00:00:00Z", {
    voided: { at: "2026-01-02T00:00:00Z", by: user("300"), reason: "mistake" },
  });

  test("a moderator can remove a warn but not a ban", () => {
    assert.equal(infractionControls("mod", warn).remove, true);
    assert.equal(infractionControls("mod", ban).remove, false);
  });

  test("only the owner can remove a ban", () => {
    assert.equal(infractionControls("admin", ban).remove, false);
    assert.equal(infractionControls("owner", ban).remove, true);
  });

  test("restore is for admins and the owner, and only on removed entries", () => {
    assert.equal(infractionControls("mod", removedWarn).restore, false);
    assert.equal(infractionControls("admin", removedWarn).restore, true);
    assert.equal(infractionControls("admin", warn).restore, false);
    assert.equal(infractionControls("admin", removedWarn).remove, false);
  });

  test("purge is the owner's alone", () => {
    assert.equal(infractionControls("admin", warn).purge, false);
    assert.equal(infractionControls("owner", warn).purge, true);
  });
});

describe("noteControls", () => {
  const mine = note(1, "2026-01-01T00:00:00Z", { author: user("200") });
  const theirs = note(2, "2026-01-01T00:00:00Z", { author: user("999") });
  const gone = note(3, "2026-01-01T00:00:00Z", { author: user("200"), deleted: { at: "2026-01-02T00:00:00Z", by: user("200") } });

  test("a moderator changes only their own notes", () => {
    assert.equal(noteControls("mod", mine, "200").edit, true);
    assert.equal(noteControls("mod", mine, "200").remove, true);
    assert.equal(noteControls("mod", theirs, "200").edit, false);
    assert.equal(noteControls("mod", theirs, "200").remove, false);
  });

  test("an admin changes any note", () => {
    assert.equal(noteControls("admin", theirs, "200").edit, true);
    assert.equal(noteControls("admin", theirs, "200").remove, true);
  });

  test("a deleted note offers restore to admins only", () => {
    assert.equal(noteControls("mod", gone, "200").restore, false);
    assert.equal(noteControls("admin", gone, "200").restore, true);
    assert.equal(noteControls("admin", gone, "200").edit, false);
  });

  test("purge is the owner's alone", () => {
    assert.equal(noteControls("admin", mine, "200").purge, false);
    assert.equal(noteControls("owner", mine, "200").purge, true);
  });

  test("a moderator cannot restore or purge even their own deleted note", () => {
    assert.deepEqual(noteControls("mod", gone, "200"), { edit: false, remove: false, restore: false, purge: false });
  });

  test("the owner gets every control on a live note and restore on a deleted one", () => {
    assert.deepEqual(noteControls("owner", theirs, "200"), { edit: true, remove: true, restore: false, purge: true });
    assert.deepEqual(noteControls("owner", gone, "999"), { edit: false, remove: false, restore: true, purge: true });
  });
});

describe("role-wide switches", () => {
  test("staff activity, history and quick facts are for admins and the owner", () => {
    assert.equal(seesAudit("mod"), false);
    assert.equal(seesAudit("admin"), true);
    assert.equal(seesAudit("owner"), true);
    assert.equal(seesQuickFacts("mod"), false);
    assert.equal(seesQuickFacts("admin"), true);
  });

  test("every staff role can add a note", () => {
    assert.equal(canAddNote("mod"), true);
    assert.equal(canAddNote("admin"), true);
    assert.equal(canAddNote("owner"), true);
  });

  test("only admins and the owner can undo a removal", () => {
    assert.equal(canRestoreOwnRemoval("mod"), false);
    assert.equal(canRestoreOwnRemoval("admin"), true);
  });

  test("a moderator may remove a timeout but not a kick", () => {
    assert.equal(infractionControls("mod", infraction(4, "timeout", "2026-01-01T00:00:00Z")).remove, true);
    assert.equal(infractionControls("mod", infraction(5, "kick", "2026-01-01T00:00:00Z")).remove, false);
    assert.equal(infractionControls("mod", infraction(5, "kick", "2026-01-01T00:00:00Z")).purge, false);
  });
});

describe("groupByDay", () => {
  const now = new Date("2026-10-10T15:00:00Z");

  test("labels today, yesterday, this year and earlier years", () => {
    assert.equal(dayLabel("2026-10-10", "2026-10-10"), "Today");
    assert.equal(dayLabel("2026-10-09", "2026-10-10"), "Yesterday");
    assert.equal(dayLabel("2026-10-03", "2026-10-10"), "Sat, Oct 3");
    assert.equal(dayLabel("2025-10-03", "2026-10-10"), "Oct 3, 2025");
  });

  test("yesterday crosses month and year boundaries", () => {
    assert.equal(dayLabel("2025-12-31", "2026-01-01"), "Yesterday");
    assert.equal(dayLabel("2026-02-28", "2026-03-01"), "Yesterday");
  });

  test("groups consecutive items by calendar day in order", () => {
    const items = buildTimeline(
      {
        infractions: [infraction(1, "warn", "2026-10-10T09:00:00Z"), infraction(2, "warn", "2026-10-08T09:00:00Z")],
        notes: [note(3, "2026-10-10T08:00:00Z")],
        audit: [],
      },
      false,
    );
    const groups = groupByDay(items, now, "UTC");
    assert.deepEqual(
      groups.map((group) => [group.label, group.items.map((item) => item.key)]),
      [
        ["Today", ["i1", "n3"]],
        ["Thu, Oct 8", ["i2"]],
      ],
    );
  });

  test("uses the viewer's time zone to decide the day", () => {
    assert.equal(dayKey("2026-10-10T02:00:00Z", "UTC"), "2026-10-10");
    assert.equal(dayKey("2026-10-10T02:00:00Z", "America/New_York"), "2026-10-09");
    const items = buildTimeline({ infractions: [infraction(1, "warn", "2026-10-10T02:00:00Z")], notes: [], audit: [] }, false);
    assert.equal(groupByDay(items, now, "America/New_York")[0]?.label, "Yesterday");
  });

  test("an empty timeline has no groups", () => {
    assert.deepEqual(groupByDay([], now, "UTC"), []);
  });
});

function summary(extra: Partial<MemberProfile["summary"]> = {}): MemberProfile["summary"] {
  return {
    user: user("100"),
    infractionCount: 0,
    warnCount: 0,
    timeoutCount: 0,
    banCount: 0,
    kickCount: 0,
    noteCount: 0,
    lastActionAt: null,
    hasActive: false,
    activity: [],
    ...extra,
  };
}

describe("standingOf", () => {
  const now = RECORD_NOW;

  test("a single warn is recent, not a restriction", () => {
    assert.deepEqual(standingOf({ infractions: [record.warn] }, now), { kind: "recent", at: "2026-10-09T09:00:00Z" });
  });

  test("a kick is recent, not a restriction", () => {
    assert.equal(standingOf({ infractions: [record.kick] }, now).kind, "recent");
  });

  test("a timeout that has run out is not a restriction", () => {
    assert.deepEqual(standingOf({ infractions: [record.timeoutOver] }, now), { kind: "recent", at: "2026-10-01T09:00:00Z" });
  });

  test("a timeout in force restricts until it ends", () => {
    assert.deepEqual(standingOf({ infractions: [record.timeoutNow, record.warn] }, now), {
      kind: "restricted",
      action: "timeout",
      caseNumber: 70,
      until: "2026-10-11T09:00:00Z",
    });
  });

  test("a ban outranks a timeout", () => {
    const result = standingOf({ infractions: Object.values(record) }, now);
    assert.deepEqual(result, { kind: "restricted", action: "ban", caseNumber: 66, until: null });
  });

  test("a removed restriction does not count, and does not make the member recent", () => {
    assert.equal(standingOf({ infractions: [record.removedTimeout] }, now).kind, "clear");
  });

  test("a lifted ban and old entries leave the member clear", () => {
    assert.equal(standingOf({ infractions: [record.unban, record.liftedBan] }, now).kind, "clear");
  });

  test("an empty record is clear", () => {
    assert.deepEqual(standingOf({ infractions: [] }, now), { kind: "clear" });
  });
});

describe("formatDate and formatDateTime", () => {
  test("name the zone instead of using the machine's, and label UTC", () => {
    assert.equal(formatDateTime("2026-10-10T02:30:00Z", "UTC"), "Oct 10, 2026, 02:30 AM UTC");
    assert.equal(formatDate("2026-10-10T02:30:00Z", "UTC"), "Oct 10, 2026");
    assert.equal(formatDate("2026-10-10T02:30:00Z", "America/New_York"), "Oct 9, 2026");
    assert.equal(formatDateTime("2026-10-10T02:30:00Z", "America/New_York").endsWith("UTC"), false);
  });

  test("a local time says which zone it is in, so it can be told from the UTC times in the logs", () => {
    assert.equal(formatDateTime("2026-10-10T02:30:00Z", "America/New_York"), "Oct 9, 2026, 10:30 PM EDT");
  });
});

describe("activitySeries", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  test("uses the bot's figures and pads them to fourteen days", () => {
    assert.deepEqual(activitySeries({ summary: { activity: [1, 2] }, infractions: [] }, now), [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2,
    ]);
  });

  test("keeps the last fourteen and cleans bad values", () => {
    const series = activitySeries({ summary: { activity: [9, ...new Array(13).fill(0), -1, Number.NaN] }, infractions: [] }, now);
    assert.equal(series.length, 14);
    assert.equal(series[0], 0);
    assert.equal(series[13], 0);
  });

  test("counts the record itself when the bot sends nothing", () => {
    const series = activitySeries(
      {
        summary: {},
        infractions: [
          infraction(1, "warn", "2026-10-10T01:00:00Z"),
          infraction(2, "warn", "2026-10-10T05:00:00Z"),
          infraction(3, "warn", "2026-10-09T05:00:00Z"),
          infraction(4, "warn", "2026-09-01T05:00:00Z"),
          infraction(5, "warn", "2026-10-10T05:00:00Z", { voided: { at: "2026-10-10T06:00:00Z", by: user("3"), reason: null } }),
        ],
      },
      now,
    );
    assert.equal(series[13], 2);
    assert.equal(series[12], 1);
    assert.equal(series.reduce((a, b) => a + b, 0), 3);
  });

  test("spark points span the box and put the peak at the top", () => {
    assert.equal(sparkPoints([0, 2, 1], 104, 24), "2,22 52,2 102,12");
    assert.equal(sparkPoints([], 10, 10), "");
  });
});

describe("recordCounts", () => {
  test("counts live entries by type and removed ones apart", () => {
    const counts = recordCounts({
      infractions: [
        infraction(1, "warn", "2026-01-01T00:00:00Z"),
        infraction(2, "ban", "2026-01-01T00:00:00Z"),
        infraction(3, "unban", "2026-01-01T00:00:00Z"),
        infraction(4, "warn", "2026-01-01T00:00:00Z", { voided: { at: "2026-01-02T00:00:00Z", by: user("3"), reason: null } }),
      ],
      notes: [note(1, "2026-01-01T00:00:00Z"), note(2, "2026-01-01T00:00:00Z", { deleted: { at: "2026-01-02T00:00:00Z", by: user("3") } })],
    });
    assert.deepEqual(counts, { warn: 1, timeout: 0, kick: 0, ban: 1, other: 1, notes: 1, removed: 2, expired: 0 });
  });

  test("counts a warning past the warn expiry apart from the warns that still count", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const counts = recordCounts(
      {
        infractions: [
          infraction(1, "warn", "2026-01-01T00:00:00Z", { warnExpiresAt: "2026-02-01T00:00:00Z" }),
          infraction(2, "automod-warn", "2026-05-20T00:00:00Z", { warnExpiresAt: "2026-06-20T00:00:00Z" }),
          infraction(3, "warn", "2026-05-25T00:00:00Z"),
        ],
        notes: [],
      },
      now,
    );
    assert.equal(counts.expired, 1);
    assert.equal(counts.warn, 1);
    assert.equal(counts.other, 1);
  });
});

describe("quickFacts", () => {
  test("summarises who touched the record and since when", () => {
    const facts = quickFacts({
      infractions: [
        infraction(1, "warn", "2026-03-01T00:00:00Z"),
        infraction(2, "warn", "2026-02-01T00:00:00Z", { moderator: user("201") }),
        infraction(3, "warn", "2026-04-01T00:00:00Z"),
        infraction(4, "warn", "2026-04-02T00:00:00Z", {
          moderator: user("201"),
          voided: { at: "2026-04-03T00:00:00Z", by: user("300"), reason: null },
        }),
      ],
      notes: [note(1, "2026-01-15T00:00:00Z", { author: user("202") })],
      audit: [audit(1, "note.add", "2026-01-15T00:00:00Z"), audit(2, "infraction.void", "2026-04-03T00:00:00Z", { actor: { userId: "300", name: "A", role: "admin" } })],
    });
    assert.equal(facts.firstEntryAt, "2026-01-15T00:00:00Z");
    assert.equal(facts.staffInvolved, 4);
    assert.equal(facts.topModerator?.user.userId, "200");
    assert.equal(facts.topModerator?.count, 2);
    assert.equal(facts.changes, 1);
  });

  test("an empty record has no facts to speak of", () => {
    assert.deepEqual(quickFacts({ infractions: [], notes: [], audit: [] }), {
      firstEntryAt: null,
      staffInvolved: 0,
      topModerator: null,
      changes: 0,
    });
  });
});

describe("diffSnapshots", () => {
  test("compares note text as a block", () => {
    assert.deepEqual(diffSnapshots({ content: "old" }, { content: "new" }), { kind: "text", before: "old", after: "new" });
    assert.deepEqual(diffSnapshots({ content: "gone" }, null), { kind: "text", before: "gone", after: null });
  });

  test("lists only the fields that moved, with readable labels", () => {
    const diff = diffSnapshots(
      { caseNumber: 58, userId: "1", reason: "spam", voidedAt: null, voidReason: null },
      { caseNumber: 58, userId: "1", reason: "spam", voidedAt: "2026-10-10T04:54:32.605Z", voidReason: "demo" },
    );
    assert.equal(diff.kind, "fields");
    if (diff.kind !== "fields") return;
    assert.deepEqual(
      diff.rows.map((row) => [row.label, row.before, row.after, row.time]),
      [
        ["Removed at", null, "2026-10-10T04:54:32.605Z", true],
        ["Removal reason", null, "demo", false],
      ],
    );
  });

  test("a partial after-snapshot does not read as fields being cleared", () => {
    const diff = diffSnapshots(
      { caseNumber: 28, action: "warn", reason: "spam", voided: false },
      { voided: true, reason: "rule was unclear" },
    );
    assert.equal(diff.kind, "fields");
    if (diff.kind !== "fields") return;
    assert.deepEqual(
      diff.rows.map((row) => row.field),
      ["reason", "voided"],
    );
  });

  test("a one-sided snapshot lists what it held", () => {
    const diff = diffSnapshots({ caseNumber: 28, action: "warn", voided: false }, null);
    assert.equal(diff.kind, "fields");
    if (diff.kind !== "fields") return;
    assert.deepEqual(
      diff.rows.map((row) => [row.label, row.before]),
      [
        ["Case", "28"],
        ["Type", "warn"],
        ["Removed", "No"],
      ],
    );
  });

  test("nothing to show when both sides are empty", () => {
    assert.deepEqual(diffSnapshots(null, null), { kind: "none" });
    assert.deepEqual(diffSnapshots({ a: 1 }, { a: 1 }), { kind: "none" });
  });

  test("names unknown fields from their camel case", () => {
    const diff = diffSnapshots(null, { someNewThing: "x" });
    assert.equal(diff.kind === "fields" && diff.rows[0]?.label, "Some new thing");
  });
});

describe("small rules", () => {
  test("purge needs the word typed, in any case", () => {
    assert.equal(purgeConfirmed(" Purge "), true);
    assert.equal(purgeConfirmed("purg"), false);
    assert.equal(purgeConfirmed(""), false);
  });

  test("the counter wakes up near the limit", () => {
    assert.equal(counterTone(10, 2000), "quiet");
    assert.equal(counterTone(1800, 2000), "near");
    assert.equal(counterTone(2000, 2000), "full");
  });
});

describe("applyPending", () => {
  const base: MemberProfile = {
    user: user("100"),
    joinedAt: null,
    accountCreatedAt: null,
    roles: [],
    summary: summary(),
    infractions: [infraction(1, "warn", "2026-01-01T00:00:00Z")],
    notes: [note(5, "2026-01-01T00:00:00Z")],
    audit: [],
  };
  const me = user("200");
  const at = "2026-02-01T00:00:00Z";

  test("returns the same object when nothing is pending", () => {
    assert.equal(applyPending(base, []), base);
  });

  test("a new note appears first with a temporary id", () => {
    const next = applyPending(base, [{ type: "note.add", tempId: -1, content: "hi", author: me, at }]);
    assert.deepEqual(
      next.notes.map((entry) => entry.id),
      [-1, 5],
    );
    assert.equal(base.notes.length, 1);
  });

  test("edits, deletes and restores notes in place", () => {
    const edited = applyPending(base, [{ type: "note.edit", id: 5, content: "changed", at }]);
    assert.equal(edited.notes[0]?.content, "changed");
    assert.equal(edited.notes[0]?.edited, true);
    const deleted = applyPending(base, [{ type: "note.delete", id: 5, by: me, at }]);
    assert.deepEqual(deleted.notes[0]?.deleted, { at, by: me });
    const restored = applyPending(deleted, [{ type: "note.restore", id: 5 }]);
    assert.equal(restored.notes[0]?.deleted, null);
  });

  test("removes, restores and purges actions", () => {
    const voided = applyPending(base, [{ type: "infraction.void", id: 1, by: me, reason: "mistake", at }]);
    assert.deepEqual(voided.infractions[0]?.voided, { at, by: me, reason: "mistake" });
    assert.equal(applyPending(voided, [{ type: "infraction.restore", id: 1 }]).infractions[0]?.voided, null);
    assert.equal(applyPending(base, [{ type: "infraction.purge", id: 1 }]).infractions.length, 0);
    assert.equal(applyPending(base, [{ type: "note.purge", id: 5 }]).notes.length, 0);
  });

  test("pending keys match timeline keys", () => {
    assert.equal(pendingKey({ type: "note.add", tempId: -3, content: "", author: me, at }), "n-3");
    assert.equal(pendingKey({ type: "note.restore", id: 5 }), "n5");
    assert.equal(pendingKey({ type: "infraction.restore", id: 1 }), "i1");
  });
});

describe("editing a case", () => {
  const mine = infraction(1, "warn", "2026-01-01T00:00:00Z");
  const removed = infraction(2, "warn", "2026-01-01T00:00:00Z", { voided: { at: "2026-01-02T00:00:00Z", by: user("300"), reason: "x" } });

  test("a moderator may edit their own case but not another moderator's", () => {
    assert.equal(infractionControls("mod", mine, "200").edit, true);
    assert.equal(infractionControls("mod", mine, "999").edit, false);
  });

  test("an admin may edit any case, and a removed case cannot be edited", () => {
    assert.equal(infractionControls("admin", mine, "999").edit, true);
    assert.equal(infractionControls("admin", removed, "999").edit, false);
  });
});

describe("what Discord holds against the record", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  test("a member banned in Discord with no ban case is not called clear", () => {
    const standing = standingWithDiscord(standingOf({ infractions: [] }, now), { banned: true, timedOutUntil: null }, now);
    assert.deepEqual(standing, { kind: "restricted", action: "ban", caseNumber: null, until: null, inDiscordOnly: true });
  });

  test("a timeout in Discord shows when the record has none in force", () => {
    const until = "2026-10-11T00:00:00.000Z";
    const standing = standingWithDiscord({ kind: "clear" }, { banned: false, timedOutUntil: until }, now);
    assert.equal(standing.kind === "restricted" && standing.until, until);
  });

  test("the record's own restriction stands, and no answer changes nothing", () => {
    const record = standingOf({ infractions: [infraction(1, "ban", "2026-10-09T00:00:00Z")] }, now);
    assert.deepEqual(standingWithDiscord(record, { banned: true, timedOutUntil: null }, now), record);
    assert.deepEqual(standingWithDiscord(record, null, now), record);
  });
});

describe("what removing a case also undoes in Discord", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  test("a ban or timeout still in force is lifted; history is not", () => {
    assert.equal(removalLifts(infraction(1, "ban", "2026-10-09T00:00:00Z"), now), "ban");
    assert.equal(removalLifts(infraction(2, "automod-timeout", "2026-10-10T11:00:00Z", { expiresAt: "2026-10-10T13:00:00Z" }), now), "timeout");
    assert.equal(removalLifts(infraction(3, "timeout", "2026-10-09T00:00:00Z", { expiresAt: "2026-10-09T01:00:00Z" }), now), null);
    assert.equal(removalLifts(infraction(4, "ban", "2026-10-09T00:00:00Z", { active: false }), now), null);
    assert.equal(removalLifts(infraction(5, "warn", "2026-10-09T00:00:00Z"), now), null);
  });
});

describe("a long timeline, a page at a time", () => {
  test("shows enough pages to reach a linked entry, and never fewer than now", () => {
    assert.equal(limitToShow(-1, TIMELINE_PAGE), TIMELINE_PAGE);
    assert.equal(limitToShow(5, TIMELINE_PAGE), TIMELINE_PAGE);
    assert.equal(limitToShow(30, TIMELINE_PAGE), 60);
    assert.equal(limitToShow(61, TIMELINE_PAGE), 90);
    assert.equal(limitToShow(10, 90), 90);
  });
});
