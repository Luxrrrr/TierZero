import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, type FieldDescriptor, type MessageBody } from "@tier0/core";
import leveling from "../dist/index.js";

const CHANNEL = "123456789012345678";

const registry = new ModuleRegistry();
registry.register(leveling);

function announce(stored: unknown): MessageBody {
  const resolved = registry.resolveSettings("leveling", stored);
  assert.ok(resolved.ok, "settings should resolve");
  return (resolved.value as { announce: { message: MessageBody } }).announce.message;
}

describe("the level-up message", () => {
  test("is an info embed until the owner writes another, with the mention kept above it so it pings", () => {
    const message = announce({});
    assert.equal(message.content, "{user}");
    assert.equal(message.embeds.length, 1);
    assert.equal(message.embeds[0]?.description, "Reached level {level}!");
    assert.equal(message.embeds[0]?.color, REPLY_COLOR.info);
  });

  test("still reads a plain string saved before it was a whole message", () => {
    const message = announce({ announce: { channel: CHANNEL, message: "Congrats {user}, level {level}" } });
    assert.equal(message.content, "Congrats {user}, level {level}");
    assert.deepEqual(message.buttons, []);
  });

  test("reads a message with an embed", () => {
    const message = announce({
      announce: { channel: CHANNEL, message: { content: "", embeds: [{ title: "Level {level}", description: "{user}" }] } },
    });
    assert.equal(message.embeds[0]?.title, "Level {level}");
  });

  test("offers its own variables to the editor", () => {
    const summary = registry.describe().find((entry) => entry.id === "leveling");
    const group = (summary?.schema.fields as Record<string, FieldDescriptor>).announce;
    const field = (group?.fields as Record<string, FieldDescriptor>).message;
    assert.equal(field?.kind, "message");
    assert.deepEqual(
      (field?.variables as { name: string }[]).map((variable) => variable.name),
      ["user", "level"],
    );
  });
});
