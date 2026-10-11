import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  automodActionLabel,
  isAutomodAction,
  parseAutomodReason,
  ruleLabel,
} from "../components/mod/automod.ts";

describe("isAutomodAction", () => {
  test("matches the three automod kinds and nothing else", () => {
    for (const action of ["automod-warn", "automod-timeout", "automod-delete"]) assert.equal(isAutomodAction(action), true);
    for (const action of ["warn", "timeout", "ban", "automod", "xautomod-warn", ""]) assert.equal(isAutomodAction(action), false);
  });
});

describe("automodActionLabel", () => {
  test("names the known kinds in words", () => {
    assert.equal(automodActionLabel("automod-warn"), "Automod warn");
    assert.equal(automodActionLabel("automod-timeout"), "Automod timeout");
    assert.equal(automodActionLabel("automod-delete"), "Automod message delete");
  });

  test("tidies a kind it has not seen and ignores manual actions", () => {
    assert.equal(automodActionLabel("automod-kick"), "Automod kick");
    assert.equal(automodActionLabel("automod-"), "Automod");
    assert.equal(automodActionLabel("warn"), null);
  });
});

describe("parseAutomodReason", () => {
  test("splits a rule from its detail at the first colon", () => {
    assert.deepEqual(parseAutomodReason("links: example.com/a: b"), { rule: "links", detail: "example.com/a: b" });
  });

  test("a bare rule has no detail and the case is folded", () => {
    assert.deepEqual(parseAutomodReason("bannedWords"), { rule: "bannedwords", detail: null });
    assert.deepEqual(parseAutomodReason("Invites:   "), { rule: "invites", detail: null });
  });

  test("empty and missing reasons have neither", () => {
    for (const value of ["", "   ", null, undefined]) assert.deepEqual(parseAutomodReason(value), { rule: null, detail: null });
  });

  test("free text is kept whole instead of being mistaken for a rule", () => {
    assert.deepEqual(parseAutomodReason("Message removed for spam"), { rule: null, detail: "Message removed for spam" });
    assert.deepEqual(parseAutomodReason(": detail only"), { rule: null, detail: ": detail only" });
    const long = `${"a".repeat(40)}: text`;
    assert.deepEqual(parseAutomodReason(long), { rule: null, detail: long });
  });
});

describe("ruleLabel", () => {
  test("labels the rules the bot ships", () => {
    assert.equal(ruleLabel("repeatedtext"), "Repeated text");
    assert.equal(ruleLabel("bannedWords"), "Banned words");
    assert.equal(ruleLabel("ratelimit"), "Message rate");
    assert.equal(ruleLabel("other"), "Other rules");
    assert.equal(ruleLabel("unknown"), "Unknown rule");
  });

  test("makes a readable name from one it does not know", () => {
    assert.equal(ruleLabel("zalgoText"), "Zalgo text");
    assert.equal(ruleLabel("mass-emoji"), "Mass emoji");
    assert.equal(ruleLabel(""), "Unknown rule");
  });
});
