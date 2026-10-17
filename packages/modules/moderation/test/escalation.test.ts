import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { automaticFacts, countedWarnings, pickRule, ruleKey, ruleName, standingBlocks } from "../dist/escalation.js";

const DAY = 86_400_000;
const NOW = new Date("2026-10-17T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let caseCounter = 0;
function warn(days: number, patch: Record<string, unknown> = {}) {
  caseCounter += 1;
  return { caseNumber: caseCounter, action: "warn", createdAt: ago(days), removed: false, escalates: true, ...patch };
}

function rule(patch: Record<string, unknown> = {}) {
  return { id: "r1", enabled: true, name: undefined, warns: 3, windowDays: 30, action: "timeout", timeoutDuration: 3_600_000, banDuration: undefined, ...patch } as never;
}

describe("countedWarnings", () => {
  test("counts warnings inside the window, newest first", () => {
    const rows = [warn(40), warn(20), warn(5), warn(1)];
    const counted = countedWarnings(rows, { windowDays: 30 }, NOW, null);
    assert.equal(counted.length, 3);
    assert.deepEqual(counted.map((row) => row.createdAt.getTime()), [ago(1), ago(5), ago(20)].map((d) => d.getTime()));
  });

  test("a window of 0 counts every warning on the record", () => {
    assert.equal(countedWarnings([warn(400), warn(1)], { windowDays: 0 }, NOW, null).length, 2);
  });

  test("a removed warning and an automod warning that does not escalate are left out", () => {
    const rows = [warn(1, { removed: true }), warn(2, { action: "automod-warn", escalates: false }), warn(3, { action: "automod-warn" }), warn(4)];
    assert.equal(countedWarnings(rows, { windowDays: 30 }, NOW, null).length, 2);
  });

  test("expired warnings stop counting, the same as in the member's total", () => {
    const rows = [warn(2), warn(10), warn(20)];
    assert.equal(countedWarnings(rows, { windowDays: 30 }, NOW, 15 * DAY).length, 2);
    assert.equal(countedWarnings(rows, { windowDays: 30 }, NOW, null).length, 3);
  });

  test("the window and the expiry both apply, whichever is shorter", () => {
    const rows = [warn(5), warn(12)];
    assert.equal(countedWarnings(rows, { windowDays: 7 }, NOW, 30 * DAY).length, 1);
    assert.equal(countedWarnings(rows, { windowDays: 30 }, NOW, 7 * DAY).length, 1);
  });
});

describe("pickRule", () => {
  test("nothing happens below the number of warnings", () => {
    assert.equal(pickRule([rule()], [warn(1), warn(2)], [], NOW, null), null);
  });

  test("a rule is reached at its number and counts the newest warnings", () => {
    const pick = pickRule([rule()], [warn(9), warn(3), warn(2), warn(1)], [], NOW, null);
    assert.ok(pick);
    assert.equal(pick.counted.length, 3);
  });

  test("a rule that is off, or whose window the warnings fall outside, is not reached", () => {
    assert.equal(pickRule([rule({ enabled: false })], [warn(1), warn(2), warn(3)], [], NOW, null), null);
    assert.equal(pickRule([rule({ windowDays: 7 })], [warn(1), warn(2), warn(20)], [], NOW, null), null);
  });

  test("warnings that expired do not reach a rule", () => {
    assert.equal(pickRule([rule()], [warn(1), warn(2), warn(20)], [], NOW, 10 * DAY), null);
  });

  test("a rule fires once for a run of warnings, then waits for new ones", () => {
    const rows = [warn(3), warn(2), warn(1)];
    assert.ok(pickRule([rule()], rows, [], NOW, null));
    // It fired just after the third warning, so the same three do not set it off again.
    const fired = [{ ruleId: "r1", createdAt: ago(0.9) }];
    assert.equal(pickRule([rule()], rows, fired, NOW, null), null);
    // Three more warnings after that fire it again.
    const more = [...rows, warn(0.5), warn(0.4), warn(0.3)];
    assert.ok(pickRule([rule()], more, fired, NOW, null));
  });

  test("a case that fired before the oldest warning of the run does not stop it", () => {
    const rows = [warn(3), warn(2), warn(1)];
    assert.ok(pickRule([rule()], rows, [{ ruleId: "r1", createdAt: ago(10) }], NOW, null));
  });

  test("a case another rule made does not stop this one", () => {
    const rows = [warn(3), warn(2), warn(1)];
    assert.ok(pickRule([rule()], rows, [{ ruleId: "other", createdAt: ago(0.5) }], NOW, null));
  });

  test("the rule needing the most warnings wins, then the first listed", () => {
    const rows = [warn(5), warn(4), warn(3), warn(2), warn(1)];
    const timeout = rule({ id: "a", warns: 3 });
    const ban = rule({ id: "b", warns: 5, action: "ban" });
    assert.equal(pickRule([timeout, ban], rows, [], NOW, null)?.rule.id, "b");
    const tie = rule({ id: "c", warns: 5, action: "kick" });
    assert.equal(pickRule([ban, tie], rows, [], NOW, null)?.rule.id, "b");
  });

  test("once the heavier rule has fired, the lighter one is still held by its own record", () => {
    const rows = [warn(5), warn(4), warn(3), warn(2), warn(1)];
    const timeout = rule({ id: "a", warns: 3 });
    const ban = rule({ id: "b", warns: 5, action: "ban" });
    const fired = [{ ruleId: "b", createdAt: ago(0.5) }];
    assert.equal(pickRule([timeout, ban], rows, fired, NOW, null)?.rule.id, "a");
  });

  test("a rule saved without an id is known by its place", () => {
    assert.equal(ruleKey({ id: "" }, 1), "rule-2");
    assert.equal(ruleKey({ id: "x" }, 1), "x");
    const rows = [warn(3), warn(2), warn(1)];
    assert.equal(pickRule([rule({ id: "" })], rows, [{ ruleId: "rule-1", createdAt: ago(0.5) }], NOW, null), null);
  });
});

describe("what the case says", () => {
  test("a rule is named by its owner, or by what it does", () => {
    assert.equal(ruleName(rule({ name: "Three strikes" })), "Three strikes");
    assert.equal(ruleName(rule({ name: "  " })), "3 warnings in 30 days, then time out");
    assert.equal(ruleName(rule({ windowDays: 0, action: "ban", warns: 5 })), "5 warnings, then ban");
    assert.equal(ruleName(rule({ windowDays: 1, action: "kick" })), "3 warnings in 1 day, then kick");
  });

  test("the facts kept on the case name the rule, the count and the newest warning", () => {
    const counted = [warn(1), warn(2), warn(3)];
    const facts = automaticFacts(rule(), 0, counted);
    assert.equal(facts.ruleId, "r1");
    assert.equal(facts.warns, 3);
    assert.equal(facts.windowMs, 30 * DAY);
    assert.equal(facts.fromCase, counted[0]!.caseNumber);
    assert.equal(automaticFacts(rule({ windowDays: 0 }), 0, counted).windowMs, null);
  });
});

describe("standingBlocks", () => {
  const free = {
    isBot: false,
    isServerOwner: false,
    isStaff: false,
    hasExemptRole: false,
    isAdministrator: false,
    botCanAct: true,
    inServer: true,
    timedOutUntil: null,
    banned: false,
  };

  test("an ordinary member is acted on", () => {
    for (const action of ["timeout", "kick", "ban"] as const) assert.equal(standingBlocks(action, free, new Date(NOW.getTime() + 3_600_000)), null);
  });

  test("the bot, the owner, staff, exempt roles and administrators are never escalated", () => {
    for (const patch of [{ isBot: true }, { isServerOwner: true }, { isStaff: true }, { hasExemptRole: true }, { isAdministrator: true }]) {
      assert.ok(standingBlocks("ban", { ...free, ...patch }, null), JSON.stringify(patch));
    }
  });

  test("a member the bot's role cannot act on is left alone", () => {
    assert.ok(standingBlocks("kick", { ...free, botCanAct: false }, null));
  });

  test("a member who left cannot be timed out or kicked, but can still be banned", () => {
    const gone = { ...free, inServer: false, botCanAct: null };
    assert.ok(standingBlocks("timeout", gone, null));
    assert.ok(standingBlocks("kick", gone, null));
    assert.equal(standingBlocks("ban", gone, null), null);
  });

  test("an action that would change nothing is skipped", () => {
    assert.ok(standingBlocks("ban", { ...free, banned: true }, null));
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    const sooner = new Date(NOW.getTime() + 3_600_000);
    assert.ok(standingBlocks("timeout", { ...free, timedOutUntil: later }, sooner));
    assert.equal(standingBlocks("timeout", { ...free, timedOutUntil: sooner }, later), null);
  });
});
