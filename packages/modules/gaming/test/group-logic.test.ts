import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GAME_MAX, announces, pingRoleOf, GROUP_PLACEHOLDERS, cleanGame, countdown, groupName, joinDeadline, mayManageGroup, renamedForGame, shouldEnd } from "../dist/group-logic.js";

const values = { user: "Ada", username: "ada", game: "Valorant", number: 3 };

describe("groupName", () => {
  test("fills in the owner, the game and the number", () => {
    assert.equal(groupName("{user}'s {game} group #{number}", values), "Ada's Valorant group #3");
  });

  test("falls back to the owner's name when the template leaves nothing", () => {
    assert.equal(groupName("{game}", { ...values, game: "" }), "Ada");
    assert.equal(groupName("", { ...values, game: "" }), "Ada");
  });

  test("adds a game the template has no place for to the end", () => {
    assert.equal(groupName("{user}'s group", values), "Ada's group - Valorant");
    assert.equal(groupName("{user}'s group", { ...values, game: "" }), "Ada's group");
  });

  test("lets the rest of the name give way when the game would not fit", () => {
    const name = groupName("{user}", { ...values, user: "x".repeat(300), game: "Valorant" });
    assert.equal(Array.from(name).length, 100);
    assert.ok(name.endsWith(" - Valorant"));
  });

  test("cuts a name to Discord's limit after the values are in", () => {
    assert.equal(Array.from(groupName("{user}", { ...values, user: "x".repeat(300) })).length, 100);
  });

  test("lists the placeholders a template may use", () => {
    assert.deepEqual(GROUP_PLACEHOLDERS, ["user", "username", "game", "number"]);
  });
});

describe("cleanGame", () => {
  test("tidies spaces and control characters", () => {
    assert.equal(cleanGame("  Deep \n Rock\t Galactic "), "Deep Rock Galactic");
  });

  test("is empty when nothing is left, and never longer than the limit", () => {
    assert.equal(cleanGame(" \n "), "");
    assert.equal(Array.from(cleanGame("g".repeat(200))).length, GAME_MAX);
  });
});

describe("renamedForGame", () => {
  test("swaps the old game where it sits", () => {
    assert.equal(renamedForGame("Ada's group - Valorant", "Valorant", "Apex"), "Ada's group - Apex");
    assert.equal(renamedForGame("Valorant night", "Valorant", "Apex"), "Apex night");
  });

  test("adds the game when the name no longer holds the old one", () => {
    assert.equal(renamedForGame("Ranked grind", "Valorant", "Apex"), "Ranked grind - Apex");
    assert.equal(renamedForGame("Ranked grind", "", "Apex"), "Ranked grind - Apex");
  });

  test("stays inside Discord's limit", () => {
    const name = renamedForGame("x".repeat(100), "", "Valorant");
    assert.equal(Array.from(name).length, 100);
    assert.ok(name.endsWith(" - Valorant"));
  });
});

describe("announces", () => {
  test("an option follows the panel unless it says always or never", () => {
    assert.equal(announces({ announce: true }, { announceMode: "panel" }), true);
    assert.equal(announces({ announce: false }, { announceMode: "panel" }), false);
    assert.equal(announces({ announce: false }, { announceMode: "always" }), true);
    assert.equal(announces({ announce: true }, { announceMode: "never" }), false);
  });

  test("the option picks the role to ping, else the panel does", () => {
    assert.equal(pingRoleOf({ pingRole: "1" }, { pingRole: "2" }), "2");
    assert.equal(pingRoleOf({ pingRole: "1" }, {}), "1");
    assert.equal(pingRoleOf({}, { pingRole: null }), null);
  });
});

describe("the time to join", () => {
  test("runs from now for as long as the owner chose", () => {
    assert.equal(joinDeadline(1_000_000, 60_000).getTime(), 1_060_000);
  });

  test("is shown as a countdown that Discord keeps counting", () => {
    assert.equal(countdown(new Date(1_700_000_000_000)), "<t:1700000000:R>");
  });

  test("rounds down to the second", () => {
    assert.equal(countdown(new Date(1_700_000_000_999)), "<t:1700000000:R>");
  });
});

describe("mayManageGroup", () => {
  const OWNER = "100000000000000001";
  const other = { id: "100000000000000002", roleIds: [] as string[], hasManagementPermission: false };

  test("the person who started the group may", () => {
    assert.equal(mayManageGroup(OWNER, { ...other, id: OWNER }, []), true);
  });

  test("someone with a management permission may, with no role listed", () => {
    assert.equal(mayManageGroup(OWNER, { ...other, hasManagementPermission: true }, []), true);
  });

  test("someone with a listed role may", () => {
    assert.equal(mayManageGroup(OWNER, { ...other, roleIds: ["r1", "r2"] }, ["r2"]), true);
  });

  test("anyone else may not", () => {
    assert.equal(mayManageGroup(OWNER, { ...other, roleIds: ["r3"] }, ["r2"]), false);
    assert.equal(mayManageGroup(OWNER, other, []), false);
  });
});

describe("shouldEnd", () => {
  const made = new Date(1_000_000);

  test("an active group with nobody in it ends once it has had time to fill", () => {
    assert.equal(shouldEnd({ status: "active", createdAt: made }, 0, made.getTime() + 61_000, 60_000), true);
  });

  test("not before it has had that time", () => {
    assert.equal(shouldEnd({ status: "active", createdAt: made }, 0, made.getTime() + 30_000, 60_000), false);
  });

  test("not while anyone is in it", () => {
    assert.equal(shouldEnd({ status: "active", createdAt: made }, 1, made.getTime() + 600_000, 60_000), false);
  });

  test("never a group still waiting for its owner, which has its own deadline", () => {
    assert.equal(shouldEnd({ status: "waiting", createdAt: made }, 0, made.getTime() + 600_000, 60_000), false);
  });
});
