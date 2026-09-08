import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ticketChannelName } from "../dist/naming.js";

describe("ticketChannelName", () => {
  test("lowercases and prefixes a plain username", () => {
    assert.equal(ticketChannelName("Alex"), "ticket-alex");
  });

  test("collapses characters Discord does not allow into hyphens", () => {
    assert.equal(ticketChannelName("Alex Smith!!"), "ticket-alex-smith");
  });

  test("falls back to a generic name when nothing usable is left", () => {
    assert.equal(ticketChannelName("!!!"), "ticket-member");
  });

  test("stays under the length Discord accepts", () => {
    const name = ticketChannelName("a".repeat(200));
    assert.ok(name.length <= 90);
  });
});
