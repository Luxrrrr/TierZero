import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, type FieldDescriptor, type MessageBody, type MessageVariable } from "@tier0/core";
import gaming from "../dist/index.js";
import { LFG_CLOSED, LFG_EXPIRED, LFG_FULL, LFG_POST, LFG_READY, LFG_REFUSALS, LFG_REPLIES, LFG_VARIABLES, ROOM_REFUSALS, ROOM_REPLIES, SIGNUP_CLOSED, SIGNUP_NOTICE_VARIABLES, SIGNUP_POST, SIGNUP_PROMOTED, SIGNUP_REFUSALS, SIGNUP_REMINDER, SIGNUP_REPLIES, SIGNUP_VARIABLES } from "../dist/messages.js";

const registry = new ModuleRegistry();
registry.register(gaming);

/** The placeholders every message offers besides the module's own. */
const SHARED = new Set(["server", "members", "channel", "channel.name", "date", "time", "now", "sender", "bot", "server.icon"]);

function texts(body: MessageBody): string[] {
  return [
    body.content,
    ...body.embeds.flatMap((embed) => [embed.title, embed.description, embed.footerText, embed.authorName, ...embed.fields.flatMap((f) => [f.name, f.value])]),
  ];
}

function placeholdersIn(body: MessageBody): string[] {
  return texts(body).flatMap((text) => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9.]*)\}/g)].map((match) => match[1] ?? ""));
}

describe("the settings", () => {
  test("resolve from nothing stored, with every feature off", () => {
    const result = registry.resolveSettings("gaming", {});
    assert.ok(result.ok, result.ok ? "" : result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
    assert.equal(result.value.voice.enabled, false);
    assert.equal(result.value.lfg.enabled, false);
    assert.equal(result.value.signups.enabled, false);
    assert.deepEqual(result.value.voice.hubs, []);
    assert.equal(result.value.timeZone, "UTC");
  });

  test("hold a hub with the defaults a room needs", () => {
    const result = registry.resolveSettings("gaming", { voice: { enabled: true, hubs: [{ channel: "110000000000000001" }] } });
    assert.ok(result.ok);
    const [hub] = result.value.voice.hubs;
    assert.equal(hub?.name, "{user}'s room");
    assert.equal(hub?.userLimit, 0);
    assert.equal(hub?.ownerLeaves, "claim");
    assert.equal(hub?.category, undefined);
  });

  test("refuse a room name with a placeholder the module does not fill", () => {
    const result = registry.resolveSettings("gaming", { voice: { hubs: [{ channel: "110000000000000001", name: "{game} room" }] } });
    assert.ok(!result.ok);
  });

  test("refuse a user limit past Discord's", () => {
    const result = registry.resolveSettings("gaming", { voice: { hubs: [{ channel: "110000000000000001", userLimit: 100 }] } });
    assert.ok(!result.ok);
  });

  test("refuse a button label past Discord's limit", () => {
    const result = registry.resolveSettings("gaming", { labels: { lfgJoin: "x".repeat(81) } });
    assert.ok(!result.ok);
  });

  test("refuse a form title past Discord's limit of 45", () => {
    const result = registry.resolveSettings("gaming", { labels: { formTitle: "x".repeat(46) } });
    assert.ok(!result.ok);
  });

  test("give each of the three features a switch as the first setting of its group", () => {
    const schema = registry.describe().find((entry) => entry.id === "gaming")?.schema;
    const fields = (schema?.fields ?? {}) as Record<string, FieldDescriptor>;
    for (const key of ["voice", "lfg", "signups"]) {
      const group = fields[key]?.fields as Record<string, FieldDescriptor>;
      assert.equal(Object.keys(group)[0], "enabled", `${key} does not start with its switch`);
      assert.equal(group.enabled?.kind, "boolean");
    }
  });
});

describe("the wording", () => {
  const replies = { ...ROOM_REPLIES, ...ROOM_REFUSALS, ...LFG_REPLIES, ...LFG_REFUSALS, ...SIGNUP_REPLIES, ...SIGNUP_REFUSALS };

  test("uses only placeholders its message declares or every message has", () => {
    for (const [key, definition] of Object.entries(replies)) {
      const declared = new Set([...SHARED, ...definition.variables.map((v: MessageVariable) => v.name)]);
      for (const name of placeholdersIn(definition.starting)) {
        assert.ok(declared.has(name), `${key} uses {${name}}, which it does not declare`);
      }
    }
  });

  test("uses only the placeholders of the posts and notices", () => {
    const posts: [string, MessageBody, MessageVariable[]][] = [
      ["lfg post", LFG_POST, LFG_VARIABLES],
      ["lfg full", LFG_FULL, LFG_VARIABLES],
      ["lfg ready", LFG_READY, LFG_VARIABLES],
      ["lfg closed", LFG_CLOSED, LFG_VARIABLES],
      ["lfg expired", LFG_EXPIRED, LFG_VARIABLES],
      ["signup post", SIGNUP_POST, SIGNUP_VARIABLES],
      ["signup closed", SIGNUP_CLOSED, SIGNUP_VARIABLES],
      ["signup promoted", SIGNUP_PROMOTED, SIGNUP_NOTICE_VARIABLES],
      ["signup reminder", SIGNUP_REMINDER, SIGNUP_NOTICE_VARIABLES],
    ];
    for (const [name, body, variables] of posts) {
      const declared = new Set([...SHARED, ...variables.map((v) => v.name)]);
      for (const placeholder of placeholdersIn(body)) assert.ok(declared.has(placeholder), `${name} uses {${placeholder}}`);
    }
  });

  test("does not redefine a placeholder every message already has", () => {
    const all = [...LFG_VARIABLES, ...SIGNUP_VARIABLES, ...SIGNUP_NOTICE_VARIABLES, ...Object.values(replies).flatMap((definition) => definition.variables)];
    for (const variable of all) assert.ok(!SHARED.has(variable.name), `{${variable.name}} is already offered to every message`);
  });

  test("says when each message is sent", () => {
    for (const [key, definition] of Object.entries(replies)) {
      assert.ok(definition.help.length > 0, `${key} has no help`);
      assert.ok(definition.label.length > 0, `${key} has no label`);
    }
  });

  test("keeps each default embed inside Discord's limits", () => {
    for (const [key, definition] of Object.entries(replies)) {
      for (const embed of definition.starting.embeds) {
        assert.ok(embed.description.length <= 4096 && embed.title.length <= 256, key);
      }
    }
    for (const body of [LFG_POST, LFG_FULL, LFG_CLOSED, LFG_EXPIRED, SIGNUP_POST, SIGNUP_CLOSED]) {
      for (const embed of body.embeds) assert.ok(embed.fields.length <= 25);
    }
  });
});
