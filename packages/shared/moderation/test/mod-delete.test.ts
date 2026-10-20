import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MOD_ACTION_KINDS, canDeleteWithAction, deletedMessagesText } from "../dist/mod.js";

describe("deleting the attached messages with an action", () => {
  test("only a warning, timeout, kick or ban can", () => {
    assert.deepEqual(MOD_ACTION_KINDS.filter(canDeleteWithAction), ["warn", "timeout", "kick", "ban"]);
  });

  test("the case says how many the action deleted", () => {
    assert.equal(deletedMessagesText([]), null);
    assert.equal(deletedMessagesText([{}, { deletedWithAction: false }]), null);
    assert.equal(deletedMessagesText([{ deletedWithAction: true }]), "Deleted 1 message");
    assert.equal(deletedMessagesText([{ deletedWithAction: true }, { deletedWithAction: true }, {}]), "Deleted 2 messages");
  });
});
