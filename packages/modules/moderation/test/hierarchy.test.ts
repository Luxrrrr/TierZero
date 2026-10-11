import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkHierarchy, checkStanding, NOT_IN_SERVER } from "../dist/hierarchy.js";

function base() {
  return {
    actorTopRole: 10,
    targetTopRole: 5,
    botTopRole: 20,
    targetIsOwner: false,
    actorIsOwner: false,
    requiresDiscordAction: true,
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

describe("actions that do not ask Discord for anything", () => {
  test("a warning is not blocked by the bot's own position", () => {
    const result = checkHierarchy({
      ...base(),
      targetTopRole: 30,
      actorTopRole: 40,
      botTopRole: 20,
      requiresDiscordAction: false,
    });
    assert.deepEqual(result, { allowed: true });
  });

  test("a warning still respects the moderator's own position", () => {
    const result = checkHierarchy({
      ...base(),
      targetTopRole: 30,
      actorTopRole: 10,
      requiresDiscordAction: false,
    });
    assert.equal(result.allowed, false);
  });

  test("a warning still cannot target the owner", () => {
    const result = checkHierarchy({
      ...base(),
      targetIsOwner: true,
      requiresDiscordAction: false,
    });
    assert.equal(result.allowed, false);
  });
});

describe("checkStanding for a dashboard actor", () => {
  function standing() {
    return {
      actor: { topRole: 10, isServerOwner: false } as { topRole: number; isServerOwner: boolean } | null,
      actorIsInstanceOwner: false,
      target: { topRole: 5, isServerOwner: false },
      botTopRole: 20,
      requiresDiscordAction: true,
    };
  }

  test("weighs a staff member in the server by their real roles", () => {
    assert.deepEqual(checkStanding(standing()), { allowed: true });
    const result = checkStanding({ ...standing(), actor: { topRole: 5, isServerOwner: false } });
    assert.equal(result.allowed, false);
    assert.equal(result.allowed === false ? result.rule : "", "actor-rank");
  });

  test("weighs the instance owner by their real roles when they are in the server", () => {
    const result = checkStanding({
      ...standing(),
      actorIsInstanceOwner: true,
      actor: { topRole: 3, isServerOwner: false },
    });
    assert.equal(result.allowed, false);
  });

  test("refuses staff who are not in the server", () => {
    const result = checkStanding({ ...standing(), actor: null });
    assert.deepEqual(result, { allowed: false, reason: NOT_IN_SERVER, rule: "actor-rank" });
  });

  test("trusts the instance owner who is not in the server past the actor comparison", () => {
    const result = checkStanding({
      ...standing(),
      actor: null,
      actorIsInstanceOwner: true,
      target: { topRole: 15, isServerOwner: false },
    });
    assert.deepEqual(result, { allowed: true });
  });

  test("still holds the instance owner to the bot's own position", () => {
    const result = checkStanding({
      ...standing(),
      actor: null,
      actorIsInstanceOwner: true,
      target: { topRole: 25, isServerOwner: false },
    });
    assert.equal(result.allowed === false ? result.rule : "", "bot-rank");
  });

  test("never lets the instance owner act on the server owner", () => {
    const result = checkStanding({
      ...standing(),
      actor: null,
      actorIsInstanceOwner: true,
      target: { topRole: 0, isServerOwner: true },
      requiresDiscordAction: false,
    });
    assert.equal(result.allowed === false ? result.rule : "", "server-owner");
  });
});
