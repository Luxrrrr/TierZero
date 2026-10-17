import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCsv,
  buildExport,
  buildStatsExport,
  caseState,
  csvCell,
  csvRow,
  EXPORT_HEADER,
  exportFilename,
  exportRow,
  STATS_EXPORT_HEADER,
  statsExportFilename,
} from "../dist/control/mod/csv.js";
import { rawHeaders } from "../dist/control/mod/types.js";

const NOW = new Date("2026-10-09T12:00:00Z");

function infraction(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    caseNumber: 7,
    guildId: "100000000000000001",
    userId: "200000000000000001",
    moderatorId: "300000000000000001",
    action: "warn",
    reason: "spam",
    createdAt: new Date("2026-10-01T08:00:00Z"),
    expiresAt: null,
    active: true,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    evidence: "[]",
    ...over,
  } as any;
}

const names = (id: string) => ({ "200000000000000001": "Member", "300000000000000001": "Mod" })[id] ?? null;

describe("csvCell", () => {
  test("leaves plain text alone", () => {
    assert.equal(csvCell("hello world"), "hello world");
    assert.equal(csvCell(12), "12");
  });

  test("null and undefined become empty cells", () => {
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
  });

  test("quotes cells with commas, quotes and line breaks, doubling inner quotes", () => {
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("one\ntwo"), '"one\ntwo"');
    assert.equal(csvCell("one\r\ntwo"), '"one\r\ntwo"');
  });

  test("keeps unicode as it is", () => {
    assert.equal(csvCell("Zoë \u{1F600} 日本語"), "Zoë \u{1F600} 日本語");
  });

  test("defuses every formula prefix", () => {
    assert.equal(csvCell("=1+1"), "'=1+1");
    assert.equal(csvCell("+1"), "'+1");
    assert.equal(csvCell("-1"), "'-1");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell("\tcmd"), "'\tcmd");
    assert.equal(csvCell("\rcmd"), '"\'\rcmd"');
  });

  test("a defused cell is still quoted when it needs to be", () => {
    assert.equal(csvCell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
  });

  test("only a leading character counts", () => {
    assert.equal(csvCell("a=b"), "a=b");
    assert.equal(csvCell("2026-10-09T00:00:00.000Z"), "2026-10-09T00:00:00.000Z");
    assert.equal(csvCell(" =1"), " =1");
  });
});

describe("buildCsv", () => {
  test("has a header, CRLF rows and a trailing break", () => {
    assert.equal(buildCsv(["a", "b"], [[1, "x,y"], [2, null]]), 'a,b\r\n1,"x,y"\r\n2,\r\n');
  });

  test("a header with no rows is still valid", () => {
    assert.equal(buildCsv(["a"], []), "a\r\n");
    assert.equal(csvRow(["a", "b"]), "a,b");
  });
});

describe("caseState", () => {
  test("removed beats everything", () => {
    assert.equal(caseState(infraction({ voidedAt: NOW, active: false }), NOW), "removed");
  });

  test("uses the words Member actions shows, by the shared in-force rule", () => {
    assert.equal(caseState(infraction({ action: "timeout", expiresAt: new Date("2026-10-09T11:59:59Z") }), NOW), "expired");
    assert.equal(caseState(infraction({ action: "timeout", expiresAt: new Date("2026-10-09T12:00:00Z") }), NOW), "expired");
    assert.equal(caseState(infraction({ action: "timeout", expiresAt: new Date("2026-10-10T00:00:00Z") }), NOW), "in force");
    assert.equal(caseState(infraction({ action: "ban", active: true }), NOW), "in force");
    assert.equal(caseState(infraction({ action: "ban", active: false }), NOW), "on record");
    assert.equal(caseState(infraction(), NOW), "on record");
    assert.equal(caseState(infraction({ action: "kick" }), NOW), "on record");
  });

  test("an automod warn reads as on record, as on the page, whatever its stored flag", () => {
    assert.equal(caseState(infraction({ action: "automod-warn", active: false }), NOW), "on record");
  });
});

describe("exportRow reasons", () => {
  test("an automod case names its rule, never the key it is stored under", () => {
    const row = exportRow(infraction({ action: "automod-delete", reason: "bannedWords: Used a banned word or phrase (matched `free nitro`)" }), NOW, names);
    assert.equal(row[5], "Banned words: Used a banned word or phrase (matched free nitro)");
  });
});

describe("exportRow", () => {
  test("lays columns out in the documented order", () => {
    const row = exportRow(infraction({ expiresAt: new Date("2026-10-02T00:00:00Z") }), NOW, names);
    assert.equal(row.length, EXPORT_HEADER.length);
    assert.deepEqual(row, [
      7,
      "2026-10-01T08:00:00.000Z",
      "200000000000000001",
      "Member",
      "warn",
      "spam",
      "300000000000000001",
      "Mod",
      "on record",
      "2026-10-02T00:00:00.000Z",
      null,
      null,
      null,
      null,
    ]);
  });

  test("lists the links of attached messages, and nothing else from them", () => {
    const evidence = JSON.stringify([{ id: "1", url: "https://discord.com/channels/1/2/3", content: "secret words" }, { id: "4", url: "https://discord.com/channels/1/2/4", content: "more" }]);
    const row = exportRow(infraction({ evidence }), NOW, names);
    assert.equal(row[13], "https://discord.com/channels/1/2/3 https://discord.com/channels/1/2/4");
    assert.ok(!row.includes("secret words"));
  });

  test("a removed case carries who, when and why, falling back to the id for an unknown remover", () => {
    const row = exportRow(
      infraction({ voidedAt: new Date("2026-10-03T00:00:00Z"), voidedBy: "400000000000000001", voidReason: "mistake" }),
      NOW,
      names,
    );
    assert.equal(row[8], "removed");
    assert.equal(row[10], "2026-10-03T00:00:00.000Z");
    assert.equal(row[11], "400000000000000001");
    assert.equal(row[12], "mistake");
  });

  test("unknown names are blank", () => {
    const row = exportRow(infraction({ userId: "999999999999999999" }), NOW, names);
    assert.equal(row[3], null);
  });
});

describe("buildExport", () => {
  test("a hostile reason and name cannot start a formula", () => {
    const csv = buildExport(
      [infraction({ reason: '=cmd|" /C calc"!A0' })],
      NOW,
      () => "@evil",
    );
    const [header, body] = csv.split("\r\n");
    assert.equal(header, EXPORT_HEADER.join(","));
    assert.ok(body!.includes("'@evil"));
    assert.ok(body!.includes(`"'=cmd|"" /C calc""!A0"`));
  });

  test("multi-line reasons stay inside one quoted cell", () => {
    const csv = buildExport([infraction({ reason: "line one\nline two, with comma" })], NOW, names);
    assert.ok(csv.includes('"line one\nline two, with comma"'));
  });

  test("names the file after the server and the day", () => {
    assert.equal(exportFilename("123", NOW), "tier0-actions-123-2026-10-09.csv");
  });
});

describe("rawHeaders", () => {
  test("sets the type and an attachment name", () => {
    const headers = rawHeaders({ contentType: "text/csv; charset=utf-8", text: "", filename: "a.csv" });
    assert.equal(headers["content-type"], "text/csv; charset=utf-8");
    assert.equal(headers["content-disposition"], 'attachment; filename="a.csv"');
  });

  test("no filename means no attachment header", () => {
    assert.equal(rawHeaders({ contentType: "text/plain", text: "" })["content-disposition"], undefined);
  });

  test("a hostile file name cannot break out of the header", () => {
    const disposition = rawHeaders({ contentType: "text/csv", text: "", filename: 'x"\r\nSet-Cookie: a=b' })["content-disposition"]!;
    assert.ok(!/[\r\n]/.test(disposition));
    assert.equal(disposition.split('"').length, 3);
  });
});

describe("stats export", () => {
  const stats = {
    days: 3,
    since: "2026-10-07T00:00:00.000Z",
    until: "2026-10-09",
    range: "custom" as const,
    bucket: "day" as const,
    totals: {
      actions: 6,
      warns: 3,
      timeouts: 1,
      kicks: 0,
      bans: 1,
      unbans: 1,
      voided: 2,
      notes: 4,
      membersWithRecord: 5,
      activeNow: 1,
    },
    previous: null,
    perDay: [
      { date: "2026-10-07", warn: 2, timeout: 0, kick: 0, ban: 0, other: 0 },
      { date: "2026-10-08", warn: 0, timeout: 1, kick: 0, ban: 1, other: 1 },
      { date: "2026-10-09", warn: 1, timeout: 0, kick: 0, ban: 0, other: 0 },
    ],
    byAction: [],
    moderators: [
      { userId: "300000000000000001", total: 5, warn: 3, timeout: 1, kick: 0, ban: 1, notes: 4, voided: 2, lastActionAt: null },
    ],
    topMembers: [],
    byHour: new Array(24).fill(0),
    repeatRate: null,
    automod: { total: 0, previousTotal: null, byRule: [] },
  };

  test("has one row per point, a range row, then one row per moderator", () => {
    const lines = buildStatsExport(stats, () => "=HYPERLINK(\"x\")").split("\r\n");
    assert.equal(lines[0], STATS_EXPORT_HEADER.join(","));
    assert.equal(lines[1], "day,2026-10-07,2026-10-07,,,2,0,0,0,0,2,,");
    assert.equal(lines[2], "day,2026-10-08,2026-10-08,,,0,1,0,1,1,3,,");
    assert.equal(lines[4], "range,2026-10-07,2026-10-09,,,3,1,0,1,1,6,4,2");
    assert.equal(lines[5], `moderator,2026-10-07,2026-10-09,300000000000000001,"'=HYPERLINK(""x"")",3,1,0,1,0,5,4,2`);
    assert.equal(lines[6], "");
  });

  test("week and month points carry their last day", () => {
    const text = buildStatsExport(
      { ...stats, bucket: "week", perDay: [{ date: "2026-10-01", end: "2026-10-04", warn: 1, timeout: 0, kick: 0, ban: 0, other: 0 }] },
      () => null,
    );
    assert.equal(text.split("\r\n")[1], "week,2026-10-01,2026-10-04,,,1,0,0,0,0,1,,");
  });

  test("the file name says which days it covers", () => {
    assert.equal(statsExportFilename("100000000000000001", stats), "tier0-mod-stats-100000000000000001-2026-10-07-to-2026-10-09.csv");
  });
});
