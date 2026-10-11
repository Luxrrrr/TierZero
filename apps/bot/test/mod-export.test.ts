import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCsv, buildExport, caseState, csvCell, csvRow, EXPORT_HEADER, exportFilename, exportRow } from "../dist/control/mod/csv.js";
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

  test("a lapsed or lifted case is expired, an open one is active", () => {
    assert.equal(caseState(infraction({ action: "timeout", expiresAt: new Date("2026-10-09T11:59:59Z") }), NOW), "expired");
    assert.equal(caseState(infraction({ action: "timeout", expiresAt: new Date("2026-10-09T12:00:00Z") }), NOW), "expired");
    assert.equal(caseState(infraction({ action: "ban", active: false }), NOW), "expired");
    assert.equal(caseState(infraction({ action: "timeout", expiresAt: new Date("2026-10-10T00:00:00Z") }), NOW), "active");
    assert.equal(caseState(infraction(), NOW), "active");
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
      "expired",
      "2026-10-02T00:00:00.000Z",
      null,
      null,
      null,
    ]);
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
