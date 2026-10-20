import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { AuditDto } from "@tier0/shared-moderation";
import {
  actionsApiParams,
  actionsExportHref,
  actionsHref,
  describeState,
  infractionState,
  moderatorOptions,
  parseActionsQuery,
} from "../app/guilds/[id]/mod/actions/params.ts";
import {
  auditApiParams,
  auditHref,
  auditVisual,
  groupByDay,
  narrowAudit,
  parseAuditQuery,
  utcStamp,
} from "../app/guilds/[id]/mod/audit/params.ts";
import {
  diffSnapshots,
  isProse,
  showValue,
  wordDiff,
} from "../app/guilds/[id]/mod/audit/diff.ts";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const by = { userId: "1234", name: "Ana", avatarUrl: null, inServer: true };

describe("parseActionsQuery", () => {
  test("defaults when nothing is given", () => {
    assert.deepEqual(parseActionsQuery({}), { action: "", state: "all", source: "all", moderatorId: "", q: "", page: 1 });
  });

  test("keeps valid filters and trims the search", () => {
    assert.deepEqual(
      parseActionsQuery({ action: "ban", state: "removed", moderatorId: "123456", q: " spam ", page: "2" }),
      { action: "ban", state: "removed", source: "all", moderatorId: "123456", q: "spam", page: 2 },
    );
  });

  test("reads the source and treats anything else as all", () => {
    assert.equal(parseActionsQuery({ source: "automod" }).source, "automod");
    assert.equal(parseActionsQuery({ source: "manual" }).source, "manual");
    assert.equal(parseActionsQuery({ source: "bot" }).source, "all");
    assert.equal(parseActionsQuery({ source: ["manual", "automod"] }).source, "manual");
  });

  test("drops an unknown action, a non-numeric moderator and a bad page", () => {
    const query = parseActionsQuery({ action: "explode", state: "weird", moderatorId: "abc", page: "0" });
    assert.deepEqual(query, { action: "", state: "all", source: "all", moderatorId: "", q: "", page: 1 });
  });
});

describe("actions urls", () => {
  test("leave defaults out", () => {
    assert.equal(actionsHref("1", {}), "/guilds/1/mod/actions");
    assert.equal(
      actionsHref("1", { action: "warn", state: "inforce", q: "a b", page: 3 }),
      "/guilds/1/mod/actions?action=warn&state=inforce&q=a+b&page=3",
    );
  });

  test("api params omit empty filters and pass the state through", () => {
    const params = actionsApiParams(parseActionsQuery({ action: "kick", state: "removed" }));
    assert.equal(params.action, "kick");
    assert.equal(params.moderatorId, undefined);
    assert.equal(params.q, undefined);
    assert.equal(params.state, "removed");
    assert.equal(actionsApiParams(parseActionsQuery({})).state, undefined);
  });


  test("the source reaches the page link, the api call and the export link only when it narrows", () => {
    const query = parseActionsQuery({ source: "automod", state: "removed" });
    assert.equal(actionsHref("1", query), "/guilds/1/mod/actions?state=removed&source=automod");
    assert.equal(actionsApiParams(query).source, "automod");
    assert.equal(actionsApiParams(parseActionsQuery({})).source, undefined);
    assert.equal(
      actionsExportHref("7", query),
      "/api/guilds/7/mod/infractions/export?state=removed&source=automod",
    );
    assert.equal(actionsHref("1", { source: "all" }), "/guilds/1/mod/actions");
  });

  test("the export link repeats the page's filters, state included, and never carries a page", () => {
    assert.equal(actionsExportHref("7", {}), "/api/guilds/7/mod/infractions/export");
    assert.equal(
      actionsExportHref("7", { action: "ban", state: "removed", q: "x y", page: 4 }),
      "/api/guilds/7/mod/infractions/export?action=ban&q=x+y&state=removed",
    );
  });
});

describe("infractionState", () => {
  // The bot sets active on every new entry, warns and kicks included.
  const row = (action: string, expiresAt: string | null, extra: object = {}) => ({
    action,
    active: true,
    expiresAt,
    voided: null,
    ...extra,
  });

  test("a removal outranks everything", () => {
    assert.equal(
      infractionState(row("ban", null, { voided: { at: "2026-01-01", by, reason: null } }), NOW),
      "removed",
    );
  });

  test("a timeout is in force until its end and expired after", () => {
    assert.equal(infractionState(row("timeout", "2026-10-11T00:00:00Z"), NOW), "active");
    assert.equal(infractionState(row("timeout", "2026-10-10T11:00:00Z"), NOW), "expired");
  });

  test("an automod timeout follows the same rule", () => {
    assert.equal(infractionState(row("automod-timeout", "2026-10-11T00:00:00Z"), NOW), "active");
    assert.equal(infractionState(row("automod-timeout", "2026-10-01T00:00:00Z"), NOW), "expired");
  });

  test("a ban with no end is in force until it is lifted", () => {
    assert.equal(infractionState(row("ban", null), NOW), "active");
    assert.equal(infractionState(row("ban", null, { active: false }), NOW), "recorded");
  });

  test("warns, kicks and reversals are on record even though the flag is set", () => {
    for (const action of ["warn", "kick", "unban", "timeout-clear"]) {
      assert.equal(infractionState(row(action, null), NOW), "recorded", action);
    }
  });
});

describe("describeState", () => {
  const base = { action: "timeout", voided: null, active: true, expiresAt: null };

  test("names who removed an entry and keeps the reason in the detail", () => {
    const view = describeState({ ...base, voided: { at: "2026-10-09T10:00:00Z", by, reason: "mistake" } }, NOW);
    assert.equal(view.tone, "removed");
    assert.equal(view.label, "Removed by Ana");
    assert.match(view.detail, /mistake/);
    assert.match(view.detail, /UTC/);
  });

  test("an unnamed remover is still identifiable", () => {
    const view = describeState(
      { ...base, voided: { at: "2026-10-09T10:00:00Z", by: { ...by, name: null }, reason: null } },
      NOW,
    );
    assert.equal(view.label, "Removed by User 1234");
  });

  test("in force says until when, in UTC", () => {
    const view = describeState({ ...base, expiresAt: "2026-10-11T15:30:00Z" }, NOW);
    assert.equal(view.tone, "active");
    assert.equal(view.label, "In force until Oct 11, 15:30 UTC");
  });

  test("a ban with no end is simply in force", () => {
    assert.equal(describeState({ ...base, action: "ban" }, NOW).label, "In force");
  });

  test("an expired timeout says when it ended", () => {
    const view = describeState({ ...base, expiresAt: "2026-10-01T08:05:00Z" }, NOW);
    assert.equal(view.tone, "expired");
    assert.equal(view.label, "Expired Oct 1, 08:05 UTC");
  });

  test("a warn, however its flag reads, is on record", () => {
    const plain = describeState({ ...base, action: "warn" }, NOW);
    assert.equal(plain.tone, "neutral");
    assert.equal(plain.label, "On record");
  });

  test("a reversal is on record", () => {
    assert.equal(describeState({ ...base, action: "unban" }, NOW).label, "On record");
  });
});

describe("moderatorOptions", () => {
  test("merges staff with moderators seen, once each, preferring a known name", () => {
    const options = moderatorOptions(
      [{ userId: "2", name: null, avatarUrl: null, inServer: true }],
      [
        { userId: "2", name: "Zed", avatarUrl: null, inServer: true },
        { userId: "1", name: "Amy", avatarUrl: null, inServer: true },
      ],
      "",
    );
    assert.deepEqual(options.map((o) => o.name), ["Amy", "Zed"]);
  });

  test("keeps a selected moderator who is in neither list", () => {
    assert.equal(moderatorOptions([], [], "99").length, 1);
  });
});

describe("parseAuditQuery", () => {
  test("accepts known kinds and numeric ids only", () => {
    const query = parseAuditQuery({ kind: "note.edit", actorId: "42", targetUserId: "x" });
    assert.equal(query.kind, "note.edit");
    assert.equal(query.actorId, "42");
    assert.equal(query.targetUserId, "");
    assert.equal(parseAuditQuery({ kind: "bogus" }).kind, "");
  });

  test("accepts automod as an actor, which is not a user id", () => {
    assert.equal(parseAuditQuery({ actorId: "automod" }).actorId, "automod");
    assert.equal(parseAuditQuery({ actorId: "moderator" }).actorId, "");
  });

  test("gives an automod case the colour of the plain action", () => {
    assert.equal(auditVisual("action.take", null, { action: "automod-warn" }).tone, "warn");
    assert.equal(auditVisual("action.take", null, { action: "ban" }).tone, "ban");
  });

  test("accepts real calendar days only and puts a backwards range in order", () => {
    assert.equal(parseAuditQuery({ since: "2026-02-30" }).since, "");
    assert.equal(parseAuditQuery({ since: "yesterday" }).since, "");
    const range = parseAuditQuery({ since: "2026-10-09", until: "2026-10-01" });
    assert.equal(range.since, "2026-10-01");
    assert.equal(range.until, "2026-10-09");
  });

  test("builds short links", () => {
    assert.equal(auditHref("9", {}), "/guilds/9/mod/audit");
    assert.equal(
      auditHref("9", { kind: "staff.add", since: "2026-10-01", q: "a b", page: 2 }),
      "/guilds/9/mod/audit?kind=staff.add&since=2026-10-01&q=a+b&page=2",
    );
  });

  test("api bounds cover whole days", () => {
    const params = auditApiParams(parseAuditQuery({ since: "2026-10-01", until: "2026-10-02" }));
    assert.equal(params.since, "2026-10-01T00:00:00.000Z");
    assert.equal(params.until, "2026-10-02T23:59:59.999Z");
    assert.equal(auditApiParams(parseAuditQuery({})).since, undefined);
  });
});

function entry(id: number, at: string, summary = "did a thing", kind: AuditDto["kind"] = "note.add"): AuditDto {
  return {
    id,
    at,
    actor: { userId: "1", name: "Ana", role: "mod" },
    kind,
    label: "Added a note",
    summary,
    targetUser: null,
    infractionId: null,
    noteId: null,
    before: null,
    after: null,
  };
}

describe("narrowAudit", () => {
  const items = [
    entry(3, "2026-10-10T08:00:00Z", "Added a note about spam"),
    entry(2, "2026-10-05T08:00:00Z"),
    entry(1, "2026-09-01T08:00:00Z"),
  ];

  test("applies the range inclusively and the text case-insensitively", () => {
    const range = parseAuditQuery({ since: "2026-10-01", until: "2026-10-05" });
    assert.deepEqual(narrowAudit(items, range).map((e) => e.id), [2]);
    assert.deepEqual(narrowAudit(items, parseAuditQuery({ q: "SPAM" })).map((e) => e.id), [3]);
  });

  test("no filters keeps everything", () => {
    assert.equal(narrowAudit(items, parseAuditQuery({})).length, 3);
  });
});

describe("groupByDay", () => {
  test("starts a group when the day changes and labels today and yesterday", () => {
    const groups = groupByDay(
      [
        entry(4, "2026-10-10T09:00:00Z"),
        entry(3, "2026-10-10T01:00:00Z"),
        entry(2, "2026-10-09T23:00:00Z"),
        entry(1, "2026-10-01T10:00:00Z"),
      ],
      "UTC",
      NOW,
    );
    assert.deepEqual(groups.map((g) => [g.key, g.items.length]), [
      ["2026-10-10", 2],
      ["2026-10-09", 1],
      ["2026-10-01", 1],
    ]);
    assert.match(groups[0]?.label ?? "", /^Today, /);
    assert.match(groups[1]?.label ?? "", /^Yesterday, /);
    assert.match(groups[2]?.label ?? "", /^Thursday, October 1, 2026$/);
  });

  test("no entries, no groups", () => {
    assert.deepEqual(groupByDay([], "UTC", NOW), []);
  });
});

describe("auditVisual", () => {
  test("notes share one colour and removals borrow the action's", () => {
    assert.deepEqual(auditVisual("note.edit", null, null), { icon: "pencil", tone: "note" });
    assert.deepEqual(auditVisual("infraction.void", { action: "ban" }, { action: "ban" }), {
      icon: "trash",
      tone: "ban",
    });
    assert.deepEqual(auditVisual("staff.add", null, { role: "mod" }), { icon: "user", tone: "" });
  });
});

describe("diffSnapshots", () => {
  test("flags only the fields that differ", () => {
    const rows = diffSnapshots({ content: "old", pinned: false }, { content: "new", pinned: false });
    assert.deepEqual(
      rows.map((row) => [row.path, row.changed]),
      [
        ["content", true],
        ["pinned", false],
      ],
    );
  });

  test("flattens nested objects to dotted paths", () => {
    const rows = diffSnapshots({ voided: { reason: "a" } }, { voided: { reason: "b" } });
    assert.equal(rows[0]?.path, "voided.reason");
    assert.equal(rows[0]?.changed, true);
  });

  test("a field present on one side only counts as changed when both sides exist", () => {
    const rows = diffSnapshots({ a: 1 }, { a: 1, b: 2 });
    assert.equal(rows.find((row) => row.path === "b")?.changed, true);
    assert.equal(rows.find((row) => row.path === "b")?.hasBefore, false);
  });

  test("a single snapshot is listed without marking anything changed", () => {
    const rows = diffSnapshots({ content: "gone" }, null);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.changed, false);
    assert.equal(rows[0]?.hasAfter, false);
  });

  test("nothing recorded gives no rows", () => {
    assert.deepEqual(diffSnapshots(null, undefined), []);
  });

  test("a scalar snapshot is shown under a generic name", () => {
    assert.equal(diffSnapshots("x", "y")[0]?.path, "value");
  });
});

describe("display helpers", () => {
  test("labels read as words", () => {
    const labels = diffSnapshots({ targetUserId: "1", voided: { by_name: "a" }, voidedAt: null }, null).map(
      (row) => row.label,
    );
    assert.deepEqual(labels, ["Target user id", "Voided / By name", "Removed at"]);
  });

  test("dates are written in UTC and say so", () => {
    assert.equal(showValue("2026-10-10T04:54:32.605Z").text, "Oct 10, 2026, 04:54 UTC");
  });

  test("shows each kind of value in its own way", () => {
    assert.deepEqual(showValue(null), { kind: "none", text: "None" });
    assert.deepEqual(showValue(true), { kind: "bool", text: "Yes" });
    assert.deepEqual(showValue(""), { kind: "empty", text: "Empty" });
    assert.equal(showValue("810000000000000011").kind, "id");
    assert.equal(showValue("2026-10-10T04:54:32.605Z").kind, "date");
    assert.equal(showValue("hello").kind, "text");
  });
});

describe("wordDiff", () => {
  const joined = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

  test("identical text is one unchanged segment", () => {
    assert.deepEqual(wordDiff("a b", "a b"), [{ text: "a b", kind: "same" }]);
  });

  test("marks only the words that changed", () => {
    const segments = wordDiff("spoke to them in DMs", "spoke to them on Discord");
    assert.equal(joined(segments.filter((s) => s.kind !== "add")), "spoke to them in DMs");
    assert.equal(joined(segments.filter((s) => s.kind !== "del")), "spoke to them on Discord");
    assert.equal(segments[0]?.kind, "same");
    assert.ok(segments.some((s) => s.kind === "del" && s.text.includes("DMs")));
    assert.ok(segments.some((s) => s.kind === "add" && s.text.includes("Discord")));
  });

  test("empty on one side is a pure addition or removal", () => {
    assert.deepEqual(wordDiff("", "new"), [{ text: "new", kind: "add" }]);
    assert.deepEqual(wordDiff("old", ""), [{ text: "old", kind: "del" }]);
  });

  test("very long text falls back to a replacement instead of stalling", () => {
    const long = "word ".repeat(1000);
    const segments = wordDiff(long, `${long}x`);
    assert.deepEqual(segments.map((s) => s.kind), ["del", "add"]);
  });
});

describe("isProse", () => {
  const row = (before: unknown, after: unknown, path = "x") =>
    ({ path, label: path, before, after, hasBefore: true, hasAfter: true, changed: true }) as const;

  test("free-text fields and long strings qualify; ids, dates and numbers do not", () => {
    assert.equal(isProse(row("a", "b", "content")), true);
    assert.equal(isProse(row("x".repeat(60), "y", "other")), true);
    assert.equal(isProse(row("short", "text", "other")), false);
    assert.equal(isProse(row("810000000000000011", "810000000000000012", "content")), false);
    assert.equal(isProse(row("2026-10-10T04:54:32Z", "2026-10-11T04:54:32Z", "content")), false);
    assert.equal(isProse(row(1, 2, "content")), false);
  });
});

describe("utcStamp", () => {
  test("writes a short UTC time that tells similar entries apart", () => {
    assert.equal(utcStamp("2026-10-10T04:54:32.605Z"), "Oct 10, 04:54 UTC");
  });
});
