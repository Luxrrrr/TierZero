import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchesChannelTypes } from "../lib/channel-types.ts";

const TEXT = 0;
const VOICE = 2;
const CATEGORY = 4;
const FORUM = 15;

describe("matchesChannelTypes", () => {
  test("accepts every channel when no types are requested", () => {
    assert.equal(matchesChannelTypes(TEXT, []), true);
    assert.equal(matchesChannelTypes(VOICE, []), true);
  });

  test("accepts a channel matching one of several requested types", () => {
    assert.equal(matchesChannelTypes(VOICE, ["text", "voice"]), true);
  });

  test("rejects a channel not among the requested types", () => {
    assert.equal(matchesChannelTypes(CATEGORY, ["text", "voice"]), false);
  });

  test("resolves each channel type name to its discord.js number", () => {
    assert.equal(matchesChannelTypes(TEXT, ["text"]), true);
    assert.equal(matchesChannelTypes(VOICE, ["voice"]), true);
    assert.equal(matchesChannelTypes(CATEGORY, ["category"]), true);
    assert.equal(matchesChannelTypes(FORUM, ["forum"]), true);
  });

  test("rejects a channel type not requested even when others are", () => {
    assert.equal(matchesChannelTypes(TEXT, ["voice", "forum"]), false);
  });

  test("ignores an unrecognized type name rather than matching everything", () => {
    assert.equal(matchesChannelTypes(TEXT, ["nonsense"]), false);
  });
});
