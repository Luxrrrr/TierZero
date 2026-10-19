import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { entryLine, exportText, listLines, meetsRoles, mentionedIds, placementFor, promotions, teamOf } from "../dist/signup-logic.js";

const A = "100000000000000001";
const B = "100000000000000002";
const C = "100000000000000003";
const D = "100000000000000004";

describe("placement", () => {
  test("registers while there are places", () => {
    assert.equal(placementFor(0, 8, true), "registered");
    assert.equal(placementFor(7, 8, false), "registered");
  });

  test("waits or refuses once full", () => {
    assert.equal(placementFor(8, 8, true), "waitlist");
    assert.equal(placementFor(8, 8, false), "full");
  });

  test("has no limit at 0", () => {
    assert.equal(placementFor(500, 0, false), "registered");
  });
});

describe("promotion", () => {
  test("fills the free places from the front of the line", () => {
    assert.deepEqual(promotions(6, 8, ["x", "y", "z"]), ["x", "y"]);
    assert.deepEqual(promotions(7, 8, ["x", "y", "z"]), ["x"]);
  });

  test("promotes nobody while still full", () => {
    assert.deepEqual(promotions(8, 8, ["x"]), []);
    assert.deepEqual(promotions(9, 8, ["x"]), []);
  });

  test("promotes everyone when there is no limit", () => {
    assert.deepEqual(promotions(3, 0, ["x", "y"]), ["x", "y"]);
  });
});

describe("naming teammates", () => {
  test("reads mentions and bare ids once each, in the order written", () => {
    assert.deepEqual(mentionedIds(`<@${B}>, <@!${C}> ${B} and ${D}`), [B, C, D]);
  });

  test("ignores short numbers and words", () => {
    assert.deepEqual(mentionedIds("123 and some words"), []);
  });
});

describe("a team", () => {
  test("is the captain and then the teammates", () => {
    assert.deepEqual(teamOf(A, `<@${B}> <@${C}>`, 3, true), { ok: true, members: [A, B, C] });
  });

  test("does not count the captain naming themselves", () => {
    assert.deepEqual(teamOf(A, `<@${A}> <@${B}>`, 2, true), { ok: true, members: [A, B] });
  });

  test("refuses too many", () => {
    assert.deepEqual(teamOf(A, `<@${B}> <@${C}> <@${D}>`, 3, true), { ok: false, code: "tooMany" });
  });

  test("refuses too few only when full teams are asked for", () => {
    assert.deepEqual(teamOf(A, `<@${B}>`, 3, true), { ok: false, code: "tooFew" });
    assert.deepEqual(teamOf(A, `<@${B}>`, 3, false), { ok: true, members: [A, B] });
    assert.deepEqual(teamOf(A, "", 3, false), { ok: true, members: [A] });
  });
});

describe("required roles", () => {
  test("any one of them is enough", () => {
    assert.equal(meetsRoles(["r1"], ["r1", "r2"]), true);
    assert.equal(meetsRoles(["r3"], ["r1", "r2"]), false);
  });

  test("none asked for means anyone", () => {
    assert.equal(meetsRoles([], []), true);
  });
});

describe("listing", () => {
  test("a solo entry is its mention", () => {
    assert.equal(entryLine({ captainId: A, teamName: "", members: [A] }, 1), `<@${A}>`);
  });

  test("a team shows its name before its people", () => {
    assert.equal(entryLine({ captainId: A, teamName: "Red", members: [A, B] }, 2), `**Red** <@${A}> <@${B}>`);
    assert.equal(entryLine({ captainId: A, teamName: "", members: [A, B] }, 2), `<@${A}> <@${B}>`);
  });

  test("lines that fit are kept whole", () => {
    assert.equal(listLines(["a", "b"], 100), "a\nb");
  });

  test("lines that do not fit are cut with a count of what is left out", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line number ${i}`);
    const text = listLines(lines, 200);
    assert.ok(text.length <= 200);
    assert.match(text, /…\+\d+$/);
  });
});

describe("the exported list", () => {
  test("numbers registered entries, then the waitlist, with names and ids", () => {
    const names: Record<string, string> = { [A]: "Ada", [B]: "Grace", [C]: "Linus", [D]: "Mal" };
    const text = exportText(
      "Friday scrims",
      2,
      [{ captainId: A, teamName: "Red", members: [A, B] }],
      [{ captainId: C, teamName: "", members: [C, D] }],
      (id) => names[id] ?? id,
      "Waitlist",
    );
    assert.equal(text, ["Friday scrims", "", `1. Red: Ada (${A}), Grace (${B})`, "", "Waitlist", `1. Linus (${C}), Mal (${D})`].join("\n"));
  });

  test("leaves the waitlist out when nobody waits", () => {
    const text = exportText("T", 1, [{ captainId: A, teamName: "", members: [A] }], [], () => "Ada", "Waitlist");
    assert.ok(!text.includes("Waitlist"));
  });
});
