import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DELETION_NOTE_LIMIT,
  DELETION_NOTE_TTL_MS,
  clearDeletionNotes,
  noteDeletion,
  takeDeletionNote,
} from "../dist/index.js";

describe("deletion notes", () => {
  beforeEach(() => clearDeletionNotes());

  test("a note is handed back once", () => {
    noteDeletion("1", { by: "automod" }, 1000);
    assert.deepEqual(takeDeletionNote("1", 1500), { by: "automod" });
    assert.equal(takeDeletionNote("1", 1500), null);
  });

  test("a message nobody noted has no note", () => {
    assert.equal(takeDeletionNote("nothing"), null);
  });

  test("a note expires after about a minute", () => {
    noteDeletion("1", { by: "automod" }, 0);
    assert.equal(takeDeletionNote("1", DELETION_NOTE_TTL_MS), null);
    noteDeletion("2", { by: "bot" }, 0);
    assert.deepEqual(takeDeletionNote("2", DELETION_NOTE_TTL_MS - 1), { by: "bot" });
  });

  test("an expired note is removed, not kept until it is asked for", () => {
    noteDeletion("old", { by: "automod" }, 0);
    noteDeletion("new", { by: "automod" }, DELETION_NOTE_TTL_MS + 1);
    assert.equal(takeDeletionNote("old", 1), null);
  });

  test("noting again replaces the earlier note", () => {
    noteDeletion("1", { by: "automod" }, 0);
    noteDeletion("1", { by: "bot" }, 10);
    assert.deepEqual(takeDeletionNote("1", 20), { by: "bot" });
  });

  test("the store is bounded and drops the oldest first", () => {
    for (let i = 0; i < DELETION_NOTE_LIMIT + 5; i++) noteDeletion(String(i), { by: "automod" }, 1);
    assert.equal(takeDeletionNote("0", 2), null);
    assert.equal(takeDeletionNote("4", 2), null);
    assert.deepEqual(takeDeletionNote("5", 2), { by: "automod" });
    assert.deepEqual(takeDeletionNote(String(DELETION_NOTE_LIMIT + 4), 2), { by: "automod" });
  });
});
