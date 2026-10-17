import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type FieldDescriptor } from "@tier0/core";
import auditlog from "../dist/index.js";
import { channelFor, shouldIgnoreChannel, shouldLogMessageEvent } from "../dist/policy.js";

const MAIN = "100000000000000070";
const MESSAGES = "100000000000000071";
const BANS = "100000000000000072";

const categories = {
  messageDelete: true,
  messageEdit: true,
  memberJoin: true,
  memberLeave: true,
  nicknameChange: true,
  roleChange: true,
  channelCreate: true,
  channelDelete: true,
  roleCreate: true,
  roleDelete: true,
  banAdd: true,
  banRemove: true,
};

describe("where an entry goes", () => {
  test("to the channel set for its kind, else to the log channel", () => {
    const routes = { messages: MESSAGES, bans: BANS };
    assert.equal(channelFor("messageDelete", MAIN, routes), MESSAGES);
    assert.equal(channelFor("messageEdit", MAIN, routes), MESSAGES);
    assert.equal(channelFor("banRemove", MAIN, routes), BANS);
    assert.equal(channelFor("memberUpdate", MAIN, routes), MAIN);
    assert.equal(channelFor("roleCreate", MAIN, {}), MAIN);
  });

  test("nowhere when neither is set", () => {
    assert.equal(channelFor("memberJoin", undefined, { bans: BANS }), "");
  });
});

describe("what is never logged", () => {
  const settings = { logChannelId: MAIN, otherLogChannels: [MESSAGES], ignoreChannels: ["ignored"], includeBots: false, categories };

  test("anything in a channel the log writes to, so it never logs itself", () => {
    assert.equal(shouldIgnoreChannel(MAIN, settings), true);
    assert.equal(shouldIgnoreChannel(MESSAGES, settings), true);
    assert.equal(shouldIgnoreChannel("general", settings), false);
  });

  test("a message in a thread of an ignored channel", () => {
    assert.equal(shouldLogMessageEvent("messageDelete", settings, { channelId: "thread", parentId: "ignored", authorIsBot: false }), false);
    assert.equal(shouldLogMessageEvent("messageDelete", settings, { channelId: "thread", parentId: "general", authorIsBot: false }), true);
  });
});

describe("the settings", () => {
  const registry = new ModuleRegistry();
  registry.register(auditlog);
  const fields = registry.describe().find((entry) => entry.id === "auditlog")?.schema.fields as Record<string, FieldDescriptor>;

  test("a server that set one channel keeps logging everything to it", () => {
    const result = registry.resolveSettings("auditlog", { channel: MAIN });
    assert.ok(result.ok);
    assert.deepEqual((result.value as { channels: object }).channels, {});
  });

  test("offer a separate channel for each kind, in a group closed until opened", () => {
    assert.equal(fields.channels?.collapsible, true);
    assert.deepEqual(Object.keys(fields.channels?.fields as object), [
      "messages",
      "members",
      "server",
      "bans",
      "voice",
      "invites",
      "threads",
      "emojis",
      "settings",
    ]);
  });

  test("let voice and forum channels be ignored", () => {
    assert.deepEqual((fields.ignoreChannels?.of as FieldDescriptor).types, ["text", "voice", "forum"]);
  });
});
