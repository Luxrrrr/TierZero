import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ROOM_NAME_MAX, bitrateFor, lowestFree, roomName, sanitiseRoomName } from "../dist/naming.js";

describe("a room name", () => {
  test("fills the placeholders", () => {
    assert.equal(roomName("{user}'s room", { user: "Ada", username: "ada", number: 1 }), "Ada's room");
    assert.equal(roomName("Squad {number} ({username})", { user: "Ada", username: "ada", number: 3 }), "Squad 3 (ada)");
  });

  test("leaves an unknown placeholder as written", () => {
    assert.equal(roomName("{game} room", { user: "Ada", username: "ada", number: 1 }), "{game} room");
  });

  test("is cut to Discord's limit after filling, so a long nickname cannot push it over", () => {
    const name = roomName("{user}'s room", { user: "a".repeat(200), username: "a", number: 1 });
    assert.ok([...name].length <= ROOM_NAME_MAX);
  });

  test("falls back to the owner's name when the template makes nothing", () => {
    assert.equal(roomName("   ", { user: "Ada", username: "ada", number: 1 }), "Ada");
  });
});

describe("sanitising", () => {
  test("drops control characters and line breaks and collapses spaces", () => {
    assert.equal(sanitiseRoomName("  Late\nnight\t\u0007  crew  "), "Late night crew");
  });

  test("keeps emoji together", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467} family";
    assert.equal(sanitiseRoomName(family), family);
  });

  test("replaces an empty name", () => {
    assert.equal(sanitiseRoomName("\n\n"), "Voice room");
    assert.equal(sanitiseRoomName("", "Ada"), "Ada");
  });

  test("counts characters, not code units", () => {
    const name = sanitiseRoomName("\u{1F600}".repeat(150));
    assert.equal([...name].length, ROOM_NAME_MAX);
  });
});

describe("room numbers", () => {
  test("take the lowest one free", () => {
    assert.equal(lowestFree([]), 1);
    assert.equal(lowestFree([1, 2, 4]), 3);
    assert.equal(lowestFree(new Set([2, 3])), 1);
  });
});

describe("bitrate", () => {
  test("is kept inside what the server allows", () => {
    assert.equal(bitrateFor(64, 96_000), 64_000);
    assert.equal(bitrateFor(256, 96_000), 96_000);
  });

  test("is left to Discord when not set", () => {
    assert.equal(bitrateFor(undefined, 96_000), undefined);
    assert.equal(bitrateFor(0, 96_000), undefined);
  });
});
