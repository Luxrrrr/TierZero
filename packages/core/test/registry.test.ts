import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ModuleRegistry,
  customId,
  defineModule,
  isRoleAssignable,
  parseCustomId,
  s,
} from "../dist/index.js";

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

function menu(name: string, kind: "user" | "message") {
  return {
    name,
    description: `The ${name} entry.`,
    kind,
    build: () => ({ toJSON: () => ({ name }) }) as never,
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

  test("finds the owner of a right-click entry too", () => {
    const registry = new ModuleRegistry();
    registry.register(
      defineModule({
        id: "menus",
        name: "Menus",
        summary: "Has a right-click entry.",
        settings: s.object({}),
        contextCommands: [menu("Warn member", "user")],
      }),
    );
    assert.equal(registry.ownerOf("Warn member"), "menus");
  });

  test("rejects a right-click entry that reuses a command name", () => {
    const registry = new ModuleRegistry();
    registry.register(moduleWith("utility", ["ping"]));
    assert.throws(
      () =>
        registry.register(
          defineModule({
            id: "menus",
            name: "Menus",
            summary: "Clashes.",
            settings: s.object({}),
            contextCommands: [menu("ping", "user")],
          }),
        ),
      /claimed by both utility and menus/,
    );
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
      {
        name: "ping",
        description: "The ping command.",
        kind: "slash",
        defaultPermissions: null,
        privateByDefault: true,
        repliesVary: false,
        response: null,
      },
    ]);
    assert.equal(described?.schema.kind, "object");
  });

  test("lists right-click entries beside slash commands, marked by what they act on", () => {
    const registry = new ModuleRegistry();
    registry.register(
      defineModule({
        id: "menus",
        name: "Menus",
        summary: "Has right-click entries.",
        settings: s.object({}),
        commands: [command("ping")],
        contextCommands: [menu("Warn member", "user"), menu("Warn author", "message")],
      }),
    );
    assert.deepEqual(
      registry.describe()[0]?.commands.map((c) => [c.name, c.kind]),
      [
        ["ping", "slash"],
        ["Warn member", "user"],
        ["Warn author", "message"],
      ],
    );
  });

  test("reports an empty requires list, never omits the key", () => {
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

  test("treats null storage as empty and still succeeds", () => {
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

describe("isRoleAssignable", () => {
  test("allows a role below the bot's own", () => {
    assert.equal(isRoleAssignable(3, 5), true);
  });

  test("refuses a role above the bot's own", () => {
    assert.equal(isRoleAssignable(7, 5), false);
  });

  test("refuses an equal position, which Discord also refuses", () => {
    assert.equal(isRoleAssignable(5, 5), false);
  });
});

describe("reply templates", () => {
  test("plainReply is a message that is only a sentence", async () => {
    const { plainReply } = await import("../dist/index.js");
    assert.deepEqual(plainReply("Hi {user}"), { content: "Hi {user}", embeds: [], buttons: [], selects: [], reactions: [] });
  });

  test("describe reports a command's template and default permissions", () => {
    const registry = new ModuleRegistry();
    registry.register(
      defineModule({
        id: "t",
        name: "t",
        summary: "t",
        settings: s.object({}),
        commands: [
          {
            ...command("hello"),
            response: {
              starting: { content: "Hello {user}", embeds: [], buttons: [], reactions: [] },
              placeholders: [{ name: "user", description: "who", sample: "Ada" }],
            },
            build: () => ({ toJSON: () => ({ name: "hello", default_member_permissions: "4" }) }) as never,
          },
          command("plain"),
        ],
      }),
    );
    const [hello, plain] = registry.describe()[0]!.commands;
    assert.equal(hello!.response?.starting.content, "Hello {user}");
    assert.equal(hello!.defaultPermissions, "4");
    assert.equal(plain!.response, null);
    assert.equal(plain!.defaultPermissions, null);
  });
});

describe("built-in modules", () => {
  const builtIn = () =>
    defineModule({
      id: "system",
      name: "Bot messages",
      summary: "What the bot says itself.",
      alwaysOn: true,
      settings: s.object({ note: s.string({ default: "hello" }) }),
    });

  test("describe says which modules cannot be switched off", () => {
    const registry = new ModuleRegistry();
    registry.register(builtIn());
    registry.register(moduleWith("utility"));
    const [system, utility] = registry.describe();
    assert.equal(system?.alwaysOn, true);
    assert.equal(utility?.alwaysOn, false);
  });

  test("a module that does not say is not always on", () => {
    assert.equal(moduleWith("utility").alwaysOn, undefined);
  });

  test("its settings still resolve from nothing stored", () => {
    const registry = new ModuleRegistry();
    registry.register(builtIn());
    const resolved = registry.resolveSettings("system", undefined);
    assert.deepEqual(resolved, { ok: true, value: { note: "hello" } });
  });
});
