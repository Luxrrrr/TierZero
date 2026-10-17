import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkNoteContent,
  checkVoidReason,
  activityByDay,
  describeCase,
  filterMembers,
  infractionDto,
  isInForce,
  matchesMember,
  noteDto,
  parseMemberFilter,
  parseMemberSort,
  slicePage,
  sortMembers,
  summarizeMember,
  joinWords,
  liftsBan,
  restoredActive,
} from "../dist/control/mod/dto.js";

const ref = (id: string) => ({ userId: id, name: `name-${id}`, avatarUrl: null, inServer: true });
const NOW = new Date("2026-10-09T12:00:00Z");

function infraction(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    caseNumber: 1,
    guildId: "100000000000000001",
    userId: "200000000000000001",
    moderatorId: "300000000000000001",
    action: "warn",
    reason: "spam",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    expiresAt: null,
    active: true,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...over,
  } as any;
}

function note(over: Record<string, unknown> = {}) {
  const created = new Date("2026-10-02T00:00:00Z");
  return {
    id: 1,
    guildId: "100000000000000001",
    userId: "200000000000000001",
    authorId: "300000000000000001",
    content: "watch this one",
    createdAt: created,
    updatedAt: created,
    deletedAt: null,
    deletedBy: null,
    ...over,
  } as any;
}

describe("validation", () => {
  test("trims note content and keeps the trimmed text", () => {
    assert.deepEqual(checkNoteContent("  hello  "), { ok: true, value: "hello" });
  });

  test("rejects empty, blank and non-text notes", () => {
    assert.equal(checkNoteContent("").ok, false);
    assert.equal(checkNoteContent("   ").ok, false);
    assert.equal(checkNoteContent(12).ok, false);
    assert.equal(checkNoteContent(undefined).ok, false);
  });

  test("allows exactly 2000 characters and no more", () => {
    assert.equal(checkNoteContent("a".repeat(2000)).ok, true);
    assert.equal(checkNoteContent("a".repeat(2001)).ok, false);
  });

  test("void reasons are capped at 500", () => {
    assert.equal(checkVoidReason("b".repeat(500)).ok, true);
    assert.equal(checkVoidReason("b".repeat(501)).ok, false);
    assert.equal(checkVoidReason("  ").ok, false);
  });
});

describe("infractionDto", () => {
  test("maps a live case with no void block", () => {
    const dto = infractionDto(infraction(), ref);
    assert.equal(dto.voided, null);
    assert.equal(dto.caseNumber, 1);
    assert.equal(dto.createdAt, "2026-10-01T00:00:00.000Z");
    assert.equal(dto.moderator.name, "name-300000000000000001");
  });

  test("is not edited until the reason changes, then says who and when", () => {
    assert.equal(infractionDto(infraction(), ref).edited, null);
    const dto = infractionDto(infraction({ editedAt: new Date("2026-10-02T00:00:00Z"), editedBy: "400000000000000001" }), ref);
    assert.equal(dto.edited?.at, "2026-10-02T00:00:00.000Z");
    assert.equal(dto.edited?.by.userId, "400000000000000001");
  });

  test("describes who removed a case and why", () => {
    const dto = infractionDto(
      infraction({ voidedAt: new Date("2026-10-03T00:00:00Z"), voidedBy: "400000000000000001", voidReason: "mistake" }),
      ref,
    );
    assert.equal(dto.voided?.reason, "mistake");
    assert.equal(dto.voided?.by.userId, "400000000000000001");
  });
});

describe("noteDto", () => {
  test("is not edited when updatedAt equals createdAt", () => {
    assert.equal(noteDto(note(), ref).edited, false);
  });

  test("is edited once updatedAt moves on", () => {
    assert.equal(noteDto(note({ updatedAt: new Date("2026-10-02T01:00:00Z") }), ref).edited, true);
  });

  test("marks a deleted note with who and when", () => {
    const dto = noteDto(note({ deletedAt: new Date("2026-10-04T00:00:00Z"), deletedBy: "400000000000000001" }), ref);
    assert.equal(dto.deleted?.by.userId, "400000000000000001");
  });
});

describe("describeCase", () => {
  test("includes the reason when there is one", () => {
    const text = describeCase(infraction({ caseNumber: 12 }), ref("200000000000000001"));
    assert.equal(text, "warn #12 for name-200000000000000001: spam");
  });

  test("falls back to the id for an unknown user and omits a missing reason", () => {
    const text = describeCase(infraction({ reason: null }), {
      userId: "200000000000000001",
      name: null,
      avatarUrl: null,
      inServer: false,
    });
    assert.equal(text, "warn #1 for 200000000000000001");
  });
});

describe("isInForce", () => {
  test("a timeout that has not run out is in force", () => {
    const row = infraction({ action: "timeout", expiresAt: new Date("2026-10-10T00:00:00Z") });
    assert.equal(isInForce(row, NOW), true);
  });

  test("an expired timeout, a voided ban and a warn are not", () => {
    assert.equal(isInForce(infraction({ action: "timeout", expiresAt: new Date("2026-10-01T00:00:00Z") }), NOW), false);
    assert.equal(isInForce(infraction({ action: "ban", voidedAt: NOW }), NOW), false);
    assert.equal(isInForce(infraction({ action: "warn" }), NOW), false);
  });

  test("an automod timeout follows the same rule", () => {
    assert.equal(isInForce(infraction({ action: "automod-timeout", expiresAt: new Date("2026-10-10T00:00:00Z") }), NOW), true);
    assert.equal(isInForce(infraction({ action: "automod-timeout", expiresAt: new Date("2026-10-01T00:00:00Z") }), NOW), false);
    assert.equal(isInForce(infraction({ action: "automod-warn" }), NOW), false);
  });

  test("a permanent ban is in force until it is lifted", () => {
    assert.equal(isInForce(infraction({ action: "ban" }), NOW), true);
    assert.equal(isInForce(infraction({ action: "ban", active: false }), NOW), false);
  });
});

describe("summarizeMember", () => {
  test("counts by action and ignores removed entries", () => {
    const { summary } = summarizeMember(
      ref("200000000000000001"),
      [
        infraction({ id: 1 }),
        infraction({ id: 2, action: "warn", voidedAt: NOW }),
        infraction({ id: 3, action: "ban" }),
        infraction({ id: 4, action: "kick" }),
      ],
      [note({ id: 1 }), note({ id: 2, deletedAt: NOW })],
      NOW,
    );
    assert.equal(summary.infractionCount, 3);
    assert.equal(summary.warnCount, 1);
    assert.equal(summary.banCount, 1);
    assert.equal(summary.kickCount, 1);
    assert.equal(summary.noteCount, 1);
    assert.equal(summary.hasActive, true);
  });

  test("reports the newest live action", () => {
    const { summary } = summarizeMember(
      ref("2"),
      [
        infraction({ id: 1, createdAt: new Date("2026-10-01T00:00:00Z") }),
        infraction({ id: 2, createdAt: new Date("2026-10-05T00:00:00Z") }),
        infraction({ id: 3, createdAt: new Date("2026-10-08T00:00:00Z"), voidedAt: NOW }),
      ],
      [],
      NOW,
    );
    assert.equal(summary.lastActionAt, "2026-10-05T00:00:00.000Z");
  });

  test("a member with only a note has no last action but still orders by the note", () => {
    const entry = summarizeMember(ref("2"), [], [note()], NOW);
    assert.equal(entry.summary.lastActionAt, null);
    assert.equal(entry.touchedAt, new Date("2026-10-02T00:00:00Z").getTime());
  });
});

describe("sorting and search", () => {
  const entry = (id: string, name: string | null, count: number, touchedAt: number) => ({
    summary: {
      user: { userId: id, name, avatarUrl: null, inServer: true },
      infractionCount: count,
      warnCount: 0,
      timeoutCount: 0,
      banCount: 0,
      kickCount: 0,
      noteCount: 0,
      lastActionAt: null,
      hasActive: false,
      activity: [],
    },
    touchedAt,
  });
  const entries = [entry("1", "bravo", 2, 100), entry("2", "Alpha", 5, 50), entry("3", null, 5, 200)];

  test("recent puts the latest activity first", () => {
    assert.deepEqual(sortMembers(entries, "recent").map((e) => e.summary.user.userId), ["3", "1", "2"]);
  });

  test("most orders by count and breaks ties by recency", () => {
    assert.deepEqual(sortMembers(entries, "most").map((e) => e.summary.user.userId), ["3", "2", "1"]);
  });

  test("name is case-insensitive and puts unknown names last", () => {
    assert.deepEqual(sortMembers(entries, "name").map((e) => e.summary.user.userId), ["2", "1", "3"]);
  });

  test("an unrecognised sort falls back to recent", () => {
    assert.equal(parseMemberSort("nonsense"), "recent");
    assert.equal(parseMemberSort(null), "recent");
    assert.equal(parseMemberSort("most"), "most");
  });

  test("search matches part of a name or an id", () => {
    const user = { userId: "123456789012345678", name: "Bravo Fox", avatarUrl: null, inServer: true };
    assert.equal(matchesMember(user, "fox"), true);
    assert.equal(matchesMember(user, "3456789"), true);
    assert.equal(matchesMember(user, "zzz"), false);
    assert.equal(matchesMember(user, "  "), true);
  });

  test("slicePage returns the requested window", () => {
    assert.deepEqual(slicePage([1, 2, 3, 4, 5], 2, 2), [3, 4]);
    assert.deepEqual(slicePage([1, 2, 3], 3, 2), []);
  });
});

describe("activityByDay", () => {
  const at = (iso: string) => infraction({ createdAt: new Date(iso) });

  test("has fourteen entries, oldest first, ending today", () => {
    const counts = activityByDay([at("2026-10-09T01:00:00Z"), at("2026-10-09T23:00:00Z"), at("2026-09-26T00:00:00Z")], NOW);
    assert.equal(counts.length, 14);
    assert.equal(counts[13], 2);
    assert.equal(counts[0], 1);
    assert.equal(counts.reduce((a, b) => a + b, 0), 3);
  });

  test("is all zeros with nothing on the record", () => {
    assert.deepEqual(activityByDay([], NOW), new Array(14).fill(0));
  });

  test("days are UTC: a second before midnight and a second after land on different days", () => {
    const counts = activityByDay([at("2026-10-08T23:59:59Z"), at("2026-10-09T00:00:01Z")], NOW);
    assert.equal(counts[12], 1);
    assert.equal(counts[13], 1);
  });

  test("anything older than the window or after today is left out", () => {
    const counts = activityByDay([at("2026-09-25T23:59:59Z"), at("2026-10-10T00:00:00Z")], NOW);
    assert.equal(counts.reduce((a, b) => a + b, 0), 0);
  });

  test("removed entries are not counted", () => {
    const counts = activityByDay([infraction({ voidedAt: NOW, createdAt: new Date("2026-10-08T00:00:00Z") })], NOW);
    assert.equal(counts.reduce((a, b) => a + b, 0), 0);
  });

  test("summarizeMember reports it for removed-free history only", () => {
    const { summary } = summarizeMember(
      ref("2"),
      [
        infraction({ id: 1, createdAt: new Date("2026-10-09T00:00:00Z") }),
        infraction({ id: 2, createdAt: new Date("2026-10-09T00:00:00Z"), voidedAt: NOW }),
      ],
      [],
      NOW,
    );
    assert.equal(summary.activity.length, 14);
    assert.equal(summary.activity[13], 1);
  });
});

describe("member filter and notes sort", () => {
  const entry = (id: string, over: Record<string, unknown>, touchedAt = 0) => ({
    summary: {
      user: { userId: id, name: id, avatarUrl: null, inServer: true },
      infractionCount: 0,
      warnCount: 0,
      timeoutCount: 0,
      banCount: 0,
      kickCount: 0,
      noteCount: 0,
      lastActionAt: null,
      hasActive: false,
      activity: [],
      ...over,
    },
    touchedAt,
  }) as any;
  const entries = [
    entry("a", { hasActive: true, lastActionAt: "2026-10-01T00:00:00.000Z" }),
    entry("b", { noteCount: 3 }, 50),
    entry("c", { lastActionAt: "2026-10-05T00:00:00.000Z", noteCount: 1 }, 10),
    entry("d", { noteCount: 5 }, 5),
  ];
  const ids = (list: any[]) => list.map((e) => e.summary.user.userId);

  test("parses known filters and falls back to all", () => {
    assert.equal(parseMemberFilter("active"), "active");
    assert.equal(parseMemberFilter("notes"), "notes");
    assert.equal(parseMemberFilter("recent"), "recent");
    assert.equal(parseMemberFilter("everyone"), "all");
    assert.equal(parseMemberFilter(null), "all");
  });

  test("active keeps members with a restriction in force", () => {
    assert.deepEqual(ids(filterMembers(entries, "active", NOW)), ["a"]);
  });

  test("notes keeps members with at least one live note", () => {
    assert.deepEqual(ids(filterMembers(entries, "notes", NOW)), ["b", "c", "d"]);
  });

  test("recent means actioned in the last seven days, and a note alone does not count", () => {
    assert.deepEqual(ids(filterMembers(entries, "recent", NOW)), ["c"]);
    const edge = [entry("e", { lastActionAt: "2026-10-02T12:00:00.000Z" }), entry("f", { lastActionAt: "2026-10-02T11:59:59.000Z" })];
    assert.deepEqual(ids(filterMembers(edge, "recent", NOW)), ["e"]);
  });

  test("all returns everything", () => {
    assert.equal(filterMembers(entries, "all", NOW).length, 4);
  });

  test("sort=notes puts the most notes first, then the most recent", () => {
    assert.equal(parseMemberSort("notes"), "notes");
    assert.deepEqual(ids(sortMembers(entries, "notes")), ["d", "b", "c", "a"]);
    const tied = [entry("x", { noteCount: 2 }, 1), entry("y", { noteCount: 2 }, 9)];
    assert.deepEqual(ids(sortMembers(tied, "notes")), ["y", "x"]);
  });
});

describe("infractionSnapshot", () => {
  test("lists the attached messages, and which version of an edited one is flagged", async () => {
    const { infractionSnapshot } = await import("../dist/control/mod/dto.js");
    const evidence = JSON.stringify([
      { id: "1", url: "https://discord.com/channels/1/2/1", versions: [{ content: "a", at: "x" }, { content: "b", at: "y" }], flagged: 0 },
      { id: "2", url: "https://discord.com/channels/1/2/2" },
    ]);
    const snapshot = infractionSnapshot(infraction({ evidence }));
    assert.deepEqual(snapshot.attachedMessages, [
      "https://discord.com/channels/1/2/1 (warned for version 1 of 2)",
      "https://discord.com/channels/1/2/2",
    ]);
  });
});

describe("automod cases in the member list", () => {
  test("are counted, so the Actions column does not say None for a member automod acted on", () => {
    const rows = [
      infraction({ action: "automod-warn", reason: "invites: Posted a Discord invite link" }),
      infraction({ id: 2, action: "automod-timeout", reason: "rateLimit: Sent 8 messages" }),
      infraction({ id: 3, action: "warn" }),
    ];
    const { summary } = summarizeMember(ref("200000000000000001"), rows, [], NOW);
    assert.equal(summary.automodCount, 2);
    assert.equal(summary.warnCount, 1);
  });
});

describe("most recent action order", () => {
  test("follows the action date the column shows, not a later note", () => {
    const old = summarizeMember(ref("1"), [infraction({ createdAt: new Date("2026-09-09T00:00:00Z") })], [
      { id: 1, guildId: "g", userId: "1", authorId: "2", content: "watch", createdAt: new Date("2026-10-09T00:00:00Z"), updatedAt: new Date("2026-10-09T00:00:00Z"), deletedAt: null, deletedBy: null },
    ], NOW);
    const newer = summarizeMember(ref("2"), [infraction({ createdAt: new Date("2026-10-04T00:00:00Z") })], [], NOW);
    const notesOnly = summarizeMember(ref("3"), [], [
      { id: 2, guildId: "g", userId: "3", authorId: "2", content: "hm", createdAt: new Date("2026-10-08T00:00:00Z"), updatedAt: new Date("2026-10-08T00:00:00Z"), deletedAt: null, deletedBy: null },
    ], NOW);
    const order = sortMembers([old, notesOnly, newer], "recent").map((entry) => entry.summary.user.userId);
    assert.deepEqual(order, ["2", "1", "3"]);
  });
});

describe("automod cases described for staff activity", () => {
  test("name the rule and the kind in words, never the keys they are stored under", () => {
    const text = describeCase(infraction({ action: "automod-timeout", caseNumber: 198, reason: "rateLimit: Sent 8 messages in 5s" }), ref("200000000000000001"));
    assert.equal(text, "automod timeout #198 for name-200000000000000001: Rate limit: Sent 8 messages in 5s");
  });
});

describe("listing what an edit changed", () => {
  test("joins the last two with and", () => {
    assert.equal(joinWords(["the reason"]), "the reason");
    assert.equal(joinWords(["the reason", "the attached messages"]), "the reason and the attached messages");
    assert.equal(joinWords(["the reason", "the length", "the attached messages"]), "the reason, the length and the attached messages");
  });
});

describe("removing and restoring a ban", () => {
  test("only a ban still in force is lifted in Discord, and needs the request to say so", () => {
    assert.equal(liftsBan(infraction({ action: "ban" }), NOW), true);
    assert.equal(liftsBan(infraction({ action: "ban", active: false }), NOW), false);
    assert.equal(liftsBan(infraction({ action: "ban", expiresAt: new Date("2026-10-01T00:00:00Z") }), NOW), false);
    assert.equal(liftsBan(infraction({ action: "kick" }), NOW), false);
  });

  test("a restored case is in force again only where Discord still holds the restriction", () => {
    assert.equal(restoredActive("ban", true, true), true);
    assert.equal(restoredActive("ban", true, false), false, "the removal lifted it, and a restore never bans again");
    assert.equal(restoredActive("timeout", true, true), false);
    assert.equal(restoredActive("automod-timeout", true, true), false);
    assert.equal(restoredActive("warn", true, true), true);
  });
});
