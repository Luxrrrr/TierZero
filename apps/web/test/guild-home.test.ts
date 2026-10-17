import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { guildHome, guildRoleLabel } from "../lib/guild-home.ts";

const access = {
  managed: new Set(["1"]),
  staff: new Map([["1", "owner"], ["2", "mod"]]),
  tickets: new Set(["3"]),
};

describe("guildHome", () => {
  test("a server someone configures opens on its overview", () => {
    assert.equal(guildHome("1", access), "/guilds/1");
  });

  test("staff land in Moderation and ticket handlers in Tickets", () => {
    assert.equal(guildHome("2", access), "/guilds/2/mod");
    assert.equal(guildHome("3", access), "/guilds/3/tickets");
  });
});

describe("guildRoleLabel", () => {
  test("names the one area someone was given, and nothing for a manager", () => {
    assert.equal(guildRoleLabel("1", access), null);
    assert.equal(guildRoleLabel("2", access), "Moderation");
    assert.equal(guildRoleLabel("3", access), "Tickets");
  });
});
