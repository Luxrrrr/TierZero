import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rememberOwnMessage, takeOwnMessage } from "../dist/runtime/own-messages.js";

describe("the bot's own messages", () => {
  test("a remembered message is reported once, then forgotten", () => {
    rememberOwnMessage("1100000000000000001");
    assert.equal(takeOwnMessage("1100000000000000001"), true);
    assert.equal(takeOwnMessage("1100000000000000001"), false);
  });

  test("a message nobody remembered is not reported", () => {
    assert.equal(takeOwnMessage("1100000000000000002"), false);
  });

  test("only the most recent ones are kept", () => {
    for (let i = 0; i < 600; i++) rememberOwnMessage(`2${String(i).padStart(18, "0")}`);
    assert.equal(takeOwnMessage(`2${String(0).padStart(18, "0")}`), false, "the oldest was dropped");
    assert.equal(takeOwnMessage(`2${String(599).padStart(18, "0")}`), true, "the newest is still there");
  });
});
