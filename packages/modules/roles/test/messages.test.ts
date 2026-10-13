import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, applyVariables, plainReply, type FieldDescriptor, type MessageBody } from "@tier0/core";
import roles from "../dist/index.js";
import { GAVE_MESSAGE, PUBLISHED_MESSAGE, REMOVED_MESSAGE, upgradeMenu } from "../dist/messages.js";

const CHANNEL = "123456789012345678";
const ROLE = "223456789012345678";

const registry = new ModuleRegistry();
registry.register(roles);

interface Menu {
  name: string;
  message: MessageBody;
  options: unknown[];
}
interface Resolved {
  menus: Menu[];
  replies: { gave: MessageBody; removed: MessageBody; published: MessageBody };
}

function resolve(stored: unknown): Resolved {
  const result = registry.resolveSettings("roles", stored);
  assert.ok(result.ok, "settings should resolve");
  return result.value as Resolved;
}

const option = { label: "Gamer", role: ROLE };

describe("a menu saved with a title and description", () => {
  test("posts the same embed as before: that title and description, no colour", () => {
    const { menus } = resolve({
      menus: [{ name: "Pings", channel: CHANNEL, title: "Choose pings", description: "Pick what you want", options: [option] }],
    });
    const message = menus[0]?.message;
    assert.equal(message?.content, "");
    assert.equal(message?.embeds.length, 1);
    assert.equal(message?.embeds[0]?.title, "Choose pings");
    assert.equal(message?.embeds[0]?.description, "Pick what you want");
    assert.equal(message?.embeds[0]?.color, "");
  });

  test("with no description keeps just the title", () => {
    const { menus } = resolve({ menus: [{ name: "Pings", channel: CHANNEL, title: "Choose pings", options: [option] }] });
    assert.equal(menus[0]?.message.embeds[0]?.title, "Choose pings");
    assert.equal(menus[0]?.message.embeds[0]?.description, "");
  });

  test("a menu with a message of its own is not overwritten by an old title", () => {
    const own = { content: "Pick one", embeds: [] };
    const { menus } = resolve({ menus: [{ name: "Pings", channel: CHANNEL, title: "Old", message: own, options: [option] }] });
    assert.equal(menus[0]?.message.content, "Pick one");
    assert.deepEqual(menus[0]?.message.embeds, []);
  });

  test("a new menu starts from the default embed", () => {
    const { menus } = resolve({ menus: [{ name: "Pings", channel: CHANNEL, options: [option] }] });
    assert.equal(menus[0]?.message.embeds[0]?.title, "Pick your roles");
  });

  test("the upgrade is idempotent", () => {
    const once = upgradeMenu({ name: "Pings", title: "T", description: "D" });
    assert.deepEqual(upgradeMenu(once), once);
  });
});

describe("the menu message", () => {
  test("cannot carry buttons or menus, since the module owns the role buttons", () => {
    const button = { label: "x", style: "primary", action: { type: "reply", reply: { content: "hi", embeds: [], ephemeral: true } } };
    const { menus } = resolve({
      menus: [{ name: "Pings", channel: CHANNEL, message: { content: "Hello", buttons: [button] }, options: [option] }],
    });
    assert.deepEqual(menus[0]?.message.buttons, []);
  });

  test("offers the menu name as a variable", () => {
    const summary = registry.describe().find((entry) => entry.id === "roles");
    const menus = (summary?.schema.fields as Record<string, FieldDescriptor>).menus;
    const row = menus?.of as FieldDescriptor;
    const field = (row.fields as Record<string, FieldDescriptor>).message;
    assert.equal(field?.kind, "message");
    assert.equal(field?.components, false);
    assert.deepEqual((field?.variables as { name: string }[]).map((variable) => variable.name), ["menu"]);
  });
});

describe("the replies", () => {
  test("say what they always have", () => {
    const { replies } = resolve({});
    assert.equal(applyVariables(replies.gave.content, { role: "Gamers" }), "Gave you **Gamers**.");
    assert.equal(applyVariables(replies.removed.content, { role: "Gamers" }), "Removed **Gamers**.");
    assert.equal(
      applyVariables(replies.published.content, { menu: "Pings", menuChannel: `<#${CHANNEL}>` }),
      `Published "Pings" in <#${CHANNEL}>.`,
    );
    assert.deepEqual(replies.gave, GAVE_MESSAGE);
    assert.deepEqual(replies.removed, REMOVED_MESSAGE);
    assert.deepEqual(replies.published, PUBLISHED_MESSAGE);
  });

  test("use the owner's wording once it is written", () => {
    const { replies } = resolve({ replies: { gave: "You now have {role}!" } });
    assert.equal(replies.gave.content, "You now have {role}!");
    assert.deepEqual(replies.removed, REMOVED_MESSAGE);
  });

  test("an embed reply is kept", () => {
    const { replies } = resolve({ replies: { removed: { content: "", embeds: [{ description: "Bye {role}" }] } } });
    assert.equal(replies.removed.embeds[0]?.description, "Bye {role}");
    assert.deepEqual(plainReply("").embeds, []);
  });
});
