import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed } from "@tier0/core";
import { comesFromVariable, mentionTokens, unknownVariables } from "../lib/message-variables.ts";

const message = (content: string, extra: Partial<Parameters<typeof unknownVariables>[0]> = {}) => ({
  content,
  embeds: [],
  buttons: [],
  selects: [],
  ...extra,
});

describe("unknownVariables", () => {
  test("names braces the message does not know, once each", () => {
    assert.deepEqual(unknownVariables(message("Hi {server} {nosuchvar} {nosuchvar}"), ["server"]), ["nosuchvar"]);
  });

  test("looks in embeds and buttons too", () => {
    const found = unknownVariables(
      message("", { embeds: [{ ...emptyEmbed(), title: "{raidboss}" }], buttons: [{ label: "{loot}", style: "link", url: "https://example.com" }] }),
      ["server"],
    );
    assert.deepEqual(found, ["raidboss", "loot"]);
  });

  test("leaves alone braces that are not a variable at all", () => {
    assert.deepEqual(unknownVariables(message("Use {} or { spaced } or {1st}"), []), []);
  });
});

describe("mentionTokens", () => {
  test("finds channel, role and member mentions", () => {
    assert.deepEqual(mentionTokens("See <#1200000000000000008> and <@&1200000000000000011>, <@1200000000000000012> <#1200000000000000008>"), [
      { token: "<#1200000000000000008>", kind: "channel", id: "1200000000000000008" },
      { token: "<@&1200000000000000011>", kind: "role", id: "1200000000000000011" },
      { token: "<@1200000000000000012>", kind: "user", id: "1200000000000000012" },
    ]);
  });

  test("ignores things that only look close", () => {
    assert.deepEqual(mentionTokens("<#general> <@everyone>"), []);
  });
});

describe("comesFromVariable", () => {
  test("is true for an address a variable fills in", () => {
    assert.equal(comesFromVariable("{user.avatar}"), true);
    assert.equal(comesFromVariable("https://cdn.example/{image}"), true);
    assert.equal(comesFromVariable("https://cdn.example/banner.png"), false);
  });
});
