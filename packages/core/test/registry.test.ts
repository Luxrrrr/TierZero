import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, customId, defineModule, parseCustomId, s } from "../dist/index.js";

const CHANNEL = "123456789012345678";

function command(name: string) {
  return {
    name,
    description: `The ${name} command.`,
    // The registry never builds a command, so a stub keeps discord.js out of
    // these tests entirely.
    build: () => ({ toJSON: () => ({ name }) }),
    async run() {},
  };
}

function moduleWith(id: string, commands: string[] = []) {
  return defineModule({
    id,
    name: id,
    summary: `The ${id} module.`,
    settings: s.object({
      channel: s.channel({ optional: true }),
      limit: s.integer({ default: 5 }),
    }),
    commands: commands.map(command),
    requires: ["ManageRoles"],
  });
}

describe("registration", () => {
  test("holds a registered module", () => {
    const registry = new ModuleRegistry();
    registry.register(moduleWith("utility"));
    assert.equal(registry.get("utility")?.id, "utility");
    assert.equal(registry.all().length, 1);
  });

  test("rejects a duplicate module id", () => {
    const registry = new ModuleRegistry();
    registry.register(moduleWith("utility"));
    assert.throws(() => registry.register(moduleWith("utility")), /Duplicate module id/);
  });

  test("rejects two modules claiming the same command", () => {
    const registry = new ModuleRegistry();
    registry.register(moduleWith("utility", ["ping"]));
    assert.throws(
      () => registry.register(moduleWith("tools", ["ping"])),
      /claimed by both utility and tools/,
    );
  });

  test("leaves the registry untouched when a registration is rejected", () => {
    const registry = new ModuleRegistry();
    registry.register(moduleWith("utility", ["ping"]));
    assert.throws(() => registry.register(moduleWith("tools", ["ping"])));
    assert.equal(registry.get("tools"), undefined);
    assert.equal(registry.all().length, 1);
  });

  test("returns undefined for an unknown module", () => {
    assert.equal(new ModuleRegistry().get("nope"), undefined);
  });
});

describe("ownerOf", () => {
  test("names the module a command belongs to", () => {
    const registry = new ModuleRegistry();
    registry.register(moduleWith("utility", ["ping", "serverinfo"]));
    registry.register(moduleWith("welcome", ["greet"]));
    assert.equal(registry.ownerOf("serverinfo"), "utility");
    assert.equal(registry.ownerOf("greet"), "welcome");
  });

  test("returns undefined for a command no module owns", () => {
    const registry = new ModuleRegistry();
    registry.register(moduleWith("utility", ["ping"]));
    assert.equal(registry.ownerOf("nothing"), undefined);
  });
});

describe("describe", () => {
  test("carries what the dashboard needs to render a module", () => {
    const registry = new ModuleRegistry();
    registry.register(moduleWith("utility", ["ping"]));
    const [described] = registry.describe();

    assert.equal(described?.id, "utility");
    assert.deepEqual(described?.requires, ["ManageRoles"]);
    assert.deepEqual(described?.commands, [
      { name: "ping", description: "The ping command." },
    ]);
    assert.equal(described?.schema.kind, "object");
  });

  test("reports an empty requires list rather than omitting it", () => {
    const registry = new ModuleRegistry();
    registry.register(
      defineModule({
        id: "bare",
        name: "Bare",
        summary: "No permissions needed.",
        settings: s.object({}),
      }),
    );
    assert.deepEqual(registry.describe()[0]?.requires, []);
  });
});

describe("resolveSettings", () => {
  const registry = new ModuleRegistry();
  registry.register(moduleWith("utility"));

  test("fills defaults for keys absent from storage", () => {
    const resolved = registry.resolveSettings("utility", {});
    assert.equal(resolved.ok, true);
    assert.deepEqual(resolved.ok && resolved.value, { limit: 5 });
  });

  test("treats null storage as empty rather than failing", () => {
    assert.equal(registry.resolveSettings("utility", null).ok, true);
  });

  test("reports the offending field when stored settings no longer validate", () => {
    const resolved = registry.resolveSettings("utility", { channel: "bad" });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.ok === false && resolved.errors[0]?.path, "channel");
  });

  test("fails for a module that is not registered", () => {
    const resolved = registry.resolveSettings("ghost", {});
    assert.equal(resolved.ok, false);
    assert.match(String(resolved.ok === false && resolved.errors[0]?.message), /Unknown module/);
  });

  test("keeps a stored value that still validates", () => {
    const resolved = registry.resolveSettings("utility", { channel: CHANNEL, limit: 9 });
    assert.deepEqual(resolved.ok && resolved.value, { channel: CHANNEL, limit: 9 });
  });
});

describe("custom ids", () => {
  test("round trips a module, action and payload", () => {
    assert.deepEqual(parseCustomId(customId("tickets", "close", "42")), {
      moduleId: "tickets",
      action: "close",
      rest: "42",
    });
  });

  test("round trips without a payload", () => {
    assert.deepEqual(parseCustomId(customId("roles", "toggle")), {
      moduleId: "roles",
      action: "toggle",
      rest: "",
    });
  });

  test("keeps colons that appear inside the payload", () => {
    const parsed = parseCustomId(customId("roles", "toggle", "a:b:c"));
    assert.equal(parsed?.rest, "a:b:c");
  });

  test("refuses an id that is not namespaced", () => {
    assert.equal(parseCustomId("toggle"), null);
    assert.equal(parseCustomId(":toggle"), null);
    assert.equal(parseCustomId("roles:"), null);
    assert.equal(parseCustomId(""), null);
  });
});
