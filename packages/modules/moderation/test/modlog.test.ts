import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatModLogEntry, actionLabel, describeLength, lengthBetween, noticeValues } from "../dist/modlog.js";

const TARGET = "111111111111111111";
const MODERATOR = "222222222222222222";

describe("actionLabel", () => {
  test("maps every known action to a human label", () => {
    assert.equal(actionLabel("warn"), "Warned");
    assert.equal(actionLabel("timeout"), "Timed out");
    assert.equal(actionLabel("timeout-clear"), "Timeout cleared");
    assert.equal(actionLabel("kick"), "Kicked");
    assert.equal(actionLabel("ban"), "Banned");
    assert.equal(actionLabel("unban"), "Unbanned");
  });

  test("falls back to the raw value for an unrecognized action", () => {
    assert.equal(actionLabel("something-new"), "something-new");
  });
});

describe("formatModLogEntry", () => {
  test("titles the case with its number and action label", () => {
    const view = formatModLogEntry({
      caseNumber: 7,
      action: "warn",
      targetId: TARGET,
      moderatorId: MODERATOR,
      reason: "Spamming",
      expiresAt: null,
    });
    assert.equal(view.title, "Case #7 - Warned");
  });

  test("mentions the member and moderator by id, without needing a cached username", () => {
    const view = formatModLogEntry({
      caseNumber: 1,
      action: "kick",
      targetId: TARGET,
      moderatorId: MODERATOR,
      reason: null,
      expiresAt: null,
    });
    const member = view.fields.find((f) => f.name === "Member");
    const moderator = view.fields.find((f) => f.name === "Moderator");
    assert.equal(member?.value, `<@${TARGET}> (${TARGET})`);
    assert.equal(moderator?.value, `<@${MODERATOR}> (${MODERATOR})`);
  });

  test("falls back to a placeholder when no reason was given", () => {
    const view = formatModLogEntry({
      caseNumber: 2,
      action: "warn",
      targetId: TARGET,
      moderatorId: MODERATOR,
      reason: null,
      expiresAt: null,
    });
    const reason = view.fields.find((f) => f.name === "Reason");
    assert.equal(reason?.value, "No reason given");
  });

  test("carries the given reason through untouched", () => {
    const view = formatModLogEntry({
      caseNumber: 3,
      action: "warn",
      targetId: TARGET,
      moderatorId: MODERATOR,
      reason: "Broke rule 4",
      expiresAt: null,
    });
    const reason = view.fields.find((f) => f.name === "Reason");
    assert.equal(reason?.value, "Broke rule 4");
  });

  test("omits the expiry field when there is no expiry", () => {
    const view = formatModLogEntry({
      caseNumber: 4,
      action: "kick",
      targetId: TARGET,
      moderatorId: MODERATOR,
      reason: null,
      expiresAt: null,
    });
    assert.equal(view.fields.some((f) => f.name === "Expires"), false);
  });

  test("adds an expiry field with an absolute and a relative timestamp", () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    const view = formatModLogEntry({
      caseNumber: 5,
      action: "timeout",
      targetId: TARGET,
      moderatorId: MODERATOR,
      reason: null,
      expiresAt,
    });
    const expires = view.fields.find((f) => f.name === "Expires");
    const seconds = Math.floor(expiresAt.getTime() / 1000);
    assert.equal(expires?.value, `<t:${seconds}:f> (<t:${seconds}:R>)`);
  });
});

describe("describeLength", () => {
  test("uses the largest unit that divides the length exactly", () => {
    assert.equal(describeLength(10 * 60_000), "10 minutes");
    assert.equal(describeLength(60_000), "1 minute");
    assert.equal(describeLength(2 * 3_600_000), "2 hours");
    assert.equal(describeLength(90 * 60_000), "90 minutes");
    assert.equal(describeLength(7 * 86_400_000), "7 days");
    assert.equal(describeLength(30_000), "30 seconds");
  });
});

describe("lengthBetween", () => {
  test("rounds a stored length over a minute to the minute, so it reads as it was typed", () => {
    const from = new Date("2030-01-01T00:00:00.400Z");
    const to = new Date("2030-01-01T00:10:00.000Z");
    assert.equal(describeLength(lengthBetween(from, to)), "10 minutes");
  });

  test("keeps a short length to the second", () => {
    const from = new Date("2030-01-01T00:00:00.000Z");
    assert.equal(lengthBetween(from, new Date("2030-01-01T00:00:30.000Z")), 30_000);
  });
});

describe("noticeValues", () => {
  const expiresAt = new Date("2030-01-01T00:00:00.000Z");
  const seconds = Math.floor(expiresAt.getTime() / 1000);

  test("leaves the optional parts empty when there is no reason and nothing expires", () => {
    const values = noticeValues({ action: "kick", reason: null, expiresAt: null });
    assert.equal(values.action, "kicked");
    assert.equal(values.actionTitle, "Kicked");
    assert.equal(values.reason, "No reason given");
    assert.equal(values.reasonNote, "");
    assert.equal(values.expires, "");
    assert.equal(values.expiryNote, "");
    assert.equal(values.duration, "");
  });

  test("words the reason and the expiry so they follow a sentence", () => {
    const values = noticeValues({ action: "ban", reason: "Repeated spam", expiresAt, durationMs: 3 * 86_400_000 });
    assert.equal(values.reasonNote, " Reason: Repeated spam");
    assert.equal(values.expiryNote, ` This expires <t:${seconds}:R>.`);
    assert.equal(values.expires, `<t:${seconds}:f> (<t:${seconds}:R>)`);
    assert.equal(values.expiresRelative, `<t:${seconds}:R>`);
    assert.equal(values.duration, "3 days");
  });

  test("names the moderator and the member only when it is told who they are", () => {
    const bare = noticeValues({ action: "warn", reason: null, expiresAt: null });
    assert.equal("moderator" in bare, false);
    assert.equal("case" in bare, false);
    const full = noticeValues({ action: "warn", reason: null, expiresAt: null, moderatorId: MODERATOR, targetId: TARGET, caseNumber: 9 });
    assert.equal(full.moderator, `<@${MODERATOR}>`);
    assert.equal(full.member, `<@${TARGET}>`);
    assert.equal(full.case, 9);
  });
});
