import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatModLogEntry, formatDirectMessage, actionLabel } from "../dist/modlog.js";

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

describe("formatDirectMessage", () => {
  test("uses the lowercased action label in a sentence", () => {
    const message = formatDirectMessage("Test Server", {
      action: "warn",
      reason: null,
      expiresAt: null,
    });
    assert.equal(message, "You were warned in Test Server.");
  });

  test("appends the reason when one was given", () => {
    const message = formatDirectMessage("Test Server", {
      action: "kick",
      reason: "Broke rule 4",
      expiresAt: null,
    });
    assert.equal(message, "You were kicked in Test Server. Reason: Broke rule 4");
  });

  test("appends an expiry note when there is one", () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    const message = formatDirectMessage("Test Server", {
      action: "timeout",
      reason: null,
      expiresAt,
    });
    const seconds = Math.floor(expiresAt.getTime() / 1000);
    assert.equal(
      message,
      `You were timed out in Test Server. This expires <t:${seconds}:R>.`,
    );
  });

  test("combines a reason and an expiry note", () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    const message = formatDirectMessage("Test Server", {
      action: "ban",
      reason: "Repeated spam",
      expiresAt,
    });
    const seconds = Math.floor(expiresAt.getTime() / 1000);
    assert.equal(
      message,
      `You were banned in Test Server. Reason: Repeated spam This expires <t:${seconds}:R>.`,
    );
  });
});
