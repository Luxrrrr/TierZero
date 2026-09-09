import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { authorizedGuildIds, hasManageGuild } from "../lib/permissions.ts";

const MANAGE_GUILD = 0x20;
const ADMINISTRATOR = 0x8;
const SEND_MESSAGES = 0x800;

describe("hasManageGuild", () => {
  test("accepts a permission set carrying the bit", () => {
    assert.equal(hasManageGuild(String(MANAGE_GUILD)), true);
    assert.equal(hasManageGuild(String(MANAGE_GUILD | SEND_MESSAGES)), true);
  });

  test("rejects a permission set without it", () => {
    assert.equal(hasManageGuild(String(SEND_MESSAGES)), false);
    assert.equal(hasManageGuild(String(ADMINISTRATOR)), false);
    assert.equal(hasManageGuild("0"), false);
  });

  test("handles permissions beyond 32 bits, which Discord sends as strings", () => {
    const high = (1n << 40n) | BigInt(MANAGE_GUILD);
    assert.equal(hasManageGuild(high.toString()), true);
    assert.equal(hasManageGuild((1n << 40n).toString()), false);
  });

  test("refuses input that is not a number without throwing", () => {
    assert.equal(hasManageGuild("nonsense"), false);
    assert.equal(hasManageGuild(""), false);
    assert.equal(hasManageGuild("-1"), false);
  });
});

describe("authorizedGuildIds", () => {
  const managed = { id: "1", permissions: String(MANAGE_GUILD) };
  const unmanaged = { id: "2", permissions: String(SEND_MESSAGES) };

  test("authorizes a guild the user manages and the bot is in", () => {
    const result = authorizedGuildIds([managed], ["1"]);
    assert.deepEqual([...result], ["1"]);
  });

  test("refuses a guild the user manages but the bot is absent from", () => {
    assert.equal(authorizedGuildIds([managed], []).size, 0);
    assert.equal(authorizedGuildIds([managed], ["999"]).size, 0);
  });

  test("refuses a guild the bot is in but the user does not manage", () => {
    assert.equal(authorizedGuildIds([unmanaged], ["2"]).size, 0);
  });

  test("requires both conditions across a mixed list", () => {
    const result = authorizedGuildIds(
      [managed, unmanaged, { id: "3", permissions: String(MANAGE_GUILD) }],
      ["1", "2"],
    );
    assert.deepEqual([...result].sort(), ["1"]);
  });

  test("is empty when the user is in no guilds", () => {
    assert.equal(authorizedGuildIds([], ["1", "2"]).size, 0);
  });

  test("is empty when the bot is in no guilds", () => {
    assert.equal(authorizedGuildIds([managed], []).size, 0);
  });

  test("does not authorize on a malformed permission string", () => {
    assert.equal(authorizedGuildIds([{ id: "1", permissions: "junk" }], ["1"]).size, 0);
  });
});
