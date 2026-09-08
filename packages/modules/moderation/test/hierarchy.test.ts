import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkHierarchy } from "../dist/hierarchy.js";

function base() {
  return {
    actorTopRole: 10,
    targetTopRole: 5,
    botTopRole: 20,
    targetIsOwner: false,
    actorIsOwner: false,
  };
}

describe("checkHierarchy", () => {
  test("allows a moderator to action someone below them", () => {
    const result = checkHierarchy(base());
    assert.deepEqual(result, { allowed: true });
  });

  test("refuses the server owner as a target regardless of position", () => {
    const result = checkHierarchy({ ...base(), targetIsOwner: true, targetTopRole: 0 });
    assert.equal(result.allowed, false);
    assert.match(result.allowed === false ? result.reason : "", /owner/i);
  });

  test("refuses the owner even when the actor also outranks the bot", () => {
    const result = checkHierarchy({
      ...base(),
      targetIsOwner: true,
      actorTopRole: 100,
      botTopRole: 1,
    });
    assert.equal(result.allowed, false);
  });

  test("refuses a target whose role is strictly above the actor's", () => {
    const result = checkHierarchy({ ...base(), actorTopRole: 5, targetTopRole: 10 });
    assert.equal(result.allowed, false);
    assert.match(result.allowed === false ? result.reason : "", /equal to or higher/);
  });

  test("refuses a target whose role exactly equals the actor's", () => {
    const result = checkHierarchy({ ...base(), actorTopRole: 5, targetTopRole: 5 });
    assert.equal(result.allowed, false);
  });

  test("refuses a target whose role is above the bot's own", () => {
    const result = checkHierarchy({ ...base(), targetTopRole: 25, actorTopRole: 30 });
    assert.equal(result.allowed, false);
    assert.match(result.allowed === false ? result.reason : "", /my highest role/i);
  });

  test("refuses a target whose role exactly equals the bot's", () => {
    const result = checkHierarchy({ ...base(), targetTopRole: 20, actorTopRole: 30 });
    assert.equal(result.allowed, false);
  });

  test("lets the owner act on someone whose role outranks the owner's own top role", () => {
    const result = checkHierarchy({
      ...base(),
      actorIsOwner: true,
      actorTopRole: 0,
      targetTopRole: 15,
      botTopRole: 20,
    });
    assert.deepEqual(result, { allowed: true });
  });

  test("still blocks the owner's action when the bot itself cannot outrank the target", () => {
    const result = checkHierarchy({
      ...base(),
      actorIsOwner: true,
      actorTopRole: 0,
      targetTopRole: 15,
      botTopRole: 10,
    });
    assert.equal(result.allowed, false);
    assert.match(result.allowed === false ? result.reason : "", /my highest role/i);
  });

  test("allows the boundary case where actor and target differ by exactly one position", () => {
    const result = checkHierarchy({ ...base(), actorTopRole: 6, targetTopRole: 5 });
    assert.deepEqual(result, { allowed: true });
  });

  test("treats a target at position zero the same as any other", () => {
    const result = checkHierarchy({ ...base(), targetTopRole: 0, actorTopRole: 1 });
    assert.deepEqual(result, { allowed: true });
  });

  test("owner targeting owner is impossible in practice but still refused", () => {
    const result = checkHierarchy({ ...base(), targetIsOwner: true, actorIsOwner: true });
    assert.equal(result.allowed, false);
  });
});
