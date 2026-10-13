import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { clickGuildId, ephemeralFlag } from "../dist/runtime/message-components.js";

const row = { guildId: "100000000000000001" };

describe("clickGuildId", () => {
  test("is the stored server for a click in a direct message", () => {
    assert.equal(clickGuildId(null, row), row.guildId);
  });

  test("is the server for a click in the server the message was stored for", () => {
    assert.equal(clickGuildId(row.guildId, row), row.guildId);
  });

  test("refuses a row stored for a different server", () => {
    assert.equal(clickGuildId("999999999999999999", row), null);
  });

  test("refuses a message nothing was stored for", () => {
    assert.equal(clickGuildId(null, null), null);
  });
});

describe("ephemeralFlag", () => {
  test("hides a reply in a server and says nothing in a direct message", () => {
    assert.deepEqual(ephemeralFlag({ inGuild: () => true } as never), { flags: MessageFlags.Ephemeral });
    assert.deepEqual(ephemeralFlag({ inGuild: () => false } as never), {});
  });

  test("leaves a reply public when the action asked for that", () => {
    assert.deepEqual(ephemeralFlag({ inGuild: () => true } as never, false), {});
  });
});
