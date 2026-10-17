import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { APPEAL_LIMITS, type AppealDto } from "@tier0/core";
import {
  APPEAL_FILTERS,
  appealPreview,
  appealsApiParams,
  appealsHref,
  bannedText,
  decisionBody,
  emptyAppealsTitle,
  parseAppealsQuery,
  readDecision,
  responseProblem,
} from "../lib/mod-appeals.ts";

describe("parseAppealsQuery", () => {
  test("opens on pending appeals, page one, nothing open", () => {
    assert.deepEqual(parseAppealsQuery({}), { status: "pending", page: 1, appeal: null });
  });

  test("reads every status the filter offers", () => {
    for (const chip of APPEAL_FILTERS) assert.equal(parseAppealsQuery({ status: chip.value }).status, chip.value);
  });

  test("falls back on anything it does not know", () => {
    assert.deepEqual(parseAppealsQuery({ status: "spam", page: "-3", appeal: "abc" }), { status: "pending", page: 1, appeal: null });
    assert.deepEqual(parseAppealsQuery({ page: "0", appeal: "0" }), { status: "pending", page: 1, appeal: null });
    assert.equal(parseAppealsQuery({ page: "2.5" }).page, 1);
  });

  test("reads the open appeal from the link the bot posts", () => {
    assert.equal(parseAppealsQuery({ appeal: "42" }).appeal, 42);
    assert.equal(parseAppealsQuery({ appeal: ["7", "8"] }).appeal, 7);
  });

  test("asks the bot for the filter and page", () => {
    assert.deepEqual(appealsApiParams(parseAppealsQuery({ status: "all", page: "3" })), { status: "all", page: 3, pageSize: 25 });
  });
});

describe("appealsHref", () => {
  test("leaves the defaults out", () => {
    assert.equal(appealsHref("9", {}), "/guilds/9/mod/appeals");
    assert.equal(appealsHref("9", { status: "pending", page: 1 }), "/guilds/9/mod/appeals");
  });

  test("keeps the filter and page when an appeal is opened", () => {
    assert.equal(appealsHref("9", { status: "denied", page: 2, appeal: 5 }), "/guilds/9/mod/appeals?status=denied&page=2&appeal=5");
  });

  test("matches the link in the bot's channel post", () => {
    assert.equal(appealsHref("9", { appeal: 12 }), "/guilds/9/mod/appeals?appeal=12");
  });
});

describe("appealPreview", () => {
  test("shows the first line that has text", () => {
    assert.equal(appealPreview("\n  \nI was not spamming, the macro bugged out.\nPlease unban."), "I was not spamming, the macro bugged out.");
  });

  test("cuts a long line", () => {
    const text = appealPreview("a".repeat(300), 20);
    assert.equal(text.length, 20);
    assert.ok(text.endsWith("…"));
  });

  test("says when there is nothing to show", () => {
    assert.equal(appealPreview("   "), "No text.");
  });
});

describe("the decision", () => {
  test("a response is optional and capped", () => {
    assert.equal(responseProblem(""), null);
    assert.equal(responseProblem("x".repeat(APPEAL_LIMITS.response)), null);
    assert.match(responseProblem("x".repeat(APPEAL_LIMITS.response + 1)) ?? "", /1000 characters/);
  });

  test("an empty response is left out of the request", () => {
    assert.deepEqual(decisionBody("   "), {});
    assert.deepEqual(decisionBody("  Welcome back, keep the lobby clean.  "), { response: "Welcome back, keep the lobby clean." });
  });

  test("reads the bot's reply, dropping empty notes", () => {
    const appeal = { id: 3 } as AppealDto;
    assert.deepEqual(readDecision({ appeal, notes: ["The direct message could not be delivered.", " ", 4] }), {
      appeal,
      notes: ["The direct message could not be delivered."],
    });
    assert.deepEqual(readDecision(null), { appeal: null, notes: [] });
    assert.deepEqual(readDecision({ appeal: { id: "x" } }), { appeal: null, notes: [] });
  });
});

describe("wording", () => {
  test("says whether Discord still has them banned", () => {
    assert.equal(bannedText(true), "Still banned in Discord.");
    assert.equal(bannedText(false), "No longer banned in Discord.");
    assert.match(bannedText(null), /could not be asked/);
  });

  test("the empty list names the filter", () => {
    assert.equal(emptyAppealsTitle("pending"), "No appeals waiting");
    assert.equal(emptyAppealsTitle("denied"), "No denied appeals");
    assert.equal(emptyAppealsTitle("all"), "No appeals yet");
  });
});
