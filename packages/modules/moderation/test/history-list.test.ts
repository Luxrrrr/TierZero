import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { historyList, HISTORY_LIST_MAX, HISTORY_REASON_MAX } from "../dist/history-list.js";
import { actionLabel, clip, moderatorName, noticeValues } from "../dist/modlog.js";
import { formatModLogEntry } from "./legacy-view.ts";

const record = (n: number, reason: string | null, action = "warn", active = true) => ({
  caseNumber: n,
  action,
  active,
  reason,
  createdAt: new Date("2026-10-01T12:00:00Z"),
});

describe("historyList", () => {
  test("lists a short record in full, one line a case", () => {
    const list = historyList([record(3, "Spam"), record(2, null, "ban", false)]);
    const lines = list.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^\*\*#3\*\* Warned - Spam - <t:\d+:d>$/);
    assert.match(lines[1]!, /Banned \(reversed\) - No reason given/);
  });

  test("fits 25 cases with 500-character reasons under the embed limit and says how many were left off", () => {
    const records = Array.from({ length: 25 }, (_, i) => record(25 - i, "x".repeat(500)));
    const list = historyList(records);
    assert.ok(list.length <= HISTORY_LIST_MAX, `list is ${list.length} characters`);
    assert.ok(list.length < 4096);
    const last = list.split("\n").at(-1)!;
    const left = Number(/^\.\.\.and (\d+) more\.$/.exec(last)?.[1]);
    assert.ok(left > 0 && left < 25, "the closing line counts the cases left off");
    assert.equal(list.split("\n").length - 1 + left, 25);
  });

  test("shortens each reason and keeps it to one line", () => {
    const list = historyList([record(1, `line one\n\nline two ${"y".repeat(400)}`)]);
    assert.equal(list.split("\n").length, 1);
    assert.ok(list.includes("..."));
    assert.ok(list.length < HISTORY_REASON_MAX + 120);
  });

  test("a whole record that fits has no closing line", () => {
    const list = historyList(Array.from({ length: 25 }, (_, i) => record(i + 1, "short")));
    assert.ok(!list.includes("more."));
    assert.equal(list.split("\n").length, 25);
  });
});

describe("case labels", () => {
  test("names what automod writes, as the dashboard does", () => {
    assert.equal(actionLabel("automod-delete"), "Automod message delete");
    assert.equal(actionLabel("automod-warn"), "Automod warn");
    assert.equal(actionLabel("automod-timeout"), "Automod timeout");
    assert.equal(actionLabel("automod-slowmode"), "Automod slowmode");
    assert.equal(actionLabel("ban"), "Banned");
    assert.equal(actionLabel("mystery"), "mystery");
  });

  test("shows automod rather than the bot as the moderator", () => {
    assert.equal(moderatorName("automod-delete", "999", "999"), "Automod");
    assert.equal(moderatorName("automod-delete", "111", "999"), undefined);
    assert.equal(moderatorName("unban", "999", "999"), undefined);

    const entry = {
      caseNumber: 4,
      action: "automod-delete",
      targetId: "1",
      moderatorId: "999",
      moderatorName: "Automod",
      reason: "invites",
      expiresAt: null,
    };
    const view = formatModLogEntry(entry);
    assert.equal(view.title, "Case #4 - Automod message delete");
    assert.equal(view.fields.find((f) => f.name === "Moderator")?.value, "Automod");
    assert.equal(noticeValues(entry).moderator, "Automod");
  });
});

describe("a long reason in a case", () => {
  test("is cut to fit an embed field", () => {
    const view = formatModLogEntry({
      caseNumber: 1,
      action: "ban",
      targetId: "1",
      moderatorId: "2",
      reason: "z".repeat(5000),
      expiresAt: null,
    });
    assert.ok(view.fields.find((f) => f.name === "Reason")!.value.length <= 1024);
    assert.equal(clip("short", 10), "short");
  });
});
