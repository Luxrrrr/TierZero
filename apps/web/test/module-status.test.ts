import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isBlank, isSetForGroup, joinOr, missingEssentials, missingSentence, moduleStatus } from "../lib/module-status.ts";

/**
 * The schema arrives from the bot as plain JSON, so the fixtures here are
 * written as plain JSON too rather than built with the schema builders.
 */
const ticketsSchema = {
  kind: "object",
  fields: {
    panel: {
      kind: "object",
      label: "The panel members press",
      fields: {
        channel: { kind: "channel", label: "Panel channel", essential: true },
        title: { kind: "string", label: "Panel title" },
      },
    },
    category: { kind: "channel", label: "Ticket category", essential: true },
    supportRoles: { kind: "array", label: "Support roles", of: { kind: "role" } },
  },
} as never;

describe("isBlank", () => {
  test("treats nothing at all as blank", () => {
    assert.equal(isBlank(undefined), true);
    assert.equal(isBlank(null), true);
    assert.equal(isBlank(""), true);
    assert.equal(isBlank("   "), true);
    assert.equal(isBlank([]), true);
  });

  test("treats false and zero as answers, because they are", () => {
    assert.equal(isBlank(false), false);
    assert.equal(isBlank(0), false);
  });

  test("treats a filled value as filled", () => {
    assert.equal(isBlank("123456789012345678"), false);
    assert.equal(isBlank(["a"]), false);
  });
});

describe("missingEssentials", () => {
  test("names every essential setting nobody has filled in", () => {
    const missing = missingEssentials(ticketsSchema, {});
    assert.deepEqual(missing, [
      { path: "panel.channel", label: "Panel channel" },
      { path: "category", label: "Ticket category" },
    ]);
  });

  test("reaches into nested groups for the path", () => {
    const missing = missingEssentials(ticketsSchema, {
      category: "123456789012345678",
    });
    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.path, "panel.channel");
  });

  test("finds nothing once the settings are complete", () => {
    const missing = missingEssentials(ticketsSchema, {
      panel: { channel: "123456789012345678" },
      category: "223456789012345678",
    });
    assert.deepEqual(missing, []);
  });

  test("ignores fields that are merely optional", () => {
    const schema = {
      kind: "object",
      fields: { note: { kind: "string", label: "Note", optional: true } },
    } as never;
    assert.deepEqual(missingEssentials(schema, {}), []);
  });

  test("does not walk into the rows of an array", () => {
    const schema = {
      kind: "object",
      fields: {
        menus: {
          kind: "array",
          of: {
            kind: "object",
            fields: { channel: { kind: "channel", label: "Channel", essential: true } },
          },
        },
      },
    } as never;
    assert.deepEqual(missingEssentials(schema, { menus: [{}] }), []);
  });

  test("falls back to the key when a field carries no label", () => {
    const schema = {
      kind: "object",
      fields: { logChannel: { kind: "channel", essential: true } },
    } as never;
    assert.equal(missingEssentials(schema, {})[0]?.label, "Log channel");
  });
});

describe("essential sets", () => {
  /** Welcome-shaped: any one of a channel, roles or a switched-on DM gives it something to do. */
  const welcomeSchema = {
    kind: "object",
    fields: {
      join: {
        kind: "object",
        fields: {
          channel: { kind: "channel", label: "Channel to greet in", essential: "target" },
          roles: { kind: "array", label: "Roles to give", of: { kind: "role" }, essential: "target" },
          sendDm: { kind: "boolean", label: "Direct message", default: false, essential: "target" },
        },
      },
      leave: {
        kind: "object",
        fields: { channel: { kind: "channel", label: "Farewell channel", essential: "target" } },
      },
    },
  } as never;

  test("names the whole set once when none of it is filled in", () => {
    const missing = missingEssentials(welcomeSchema, { join: { roles: [], sendDm: false }, leave: {} });
    assert.equal(missing.length, 1);
    assert.equal(missing[0]?.path, "join.channel");
    assert.deepEqual(missing[0]?.anyOf, ["Channel to greet in", "Roles to give", "Direct message", "Farewell channel"]);
    assert.equal(missing[0]?.label, "Channel to greet in, Roles to give, Direct message or Farewell channel");
  });

  test("is satisfied by any one member, wherever it sits", () => {
    assert.deepEqual(missingEssentials(welcomeSchema, { leave: { channel: "123456789012345678" } }), []);
    assert.deepEqual(missingEssentials(welcomeSchema, { join: { roles: ["223456789012345678"] } }), []);
  });

  test("counts a switch only while it is on", () => {
    assert.deepEqual(missingEssentials(welcomeSchema, { join: { sendDm: true } }), []);
    assert.equal(missingEssentials(welcomeSchema, { join: { sendDm: false } }).length, 1);
    assert.equal(isSetForGroup(false), false);
    assert.equal(isSetForGroup(true), true);
    assert.equal(isSetForGroup(0), true);
  });

  test("keeps separate sets apart and alongside single essentials", () => {
    const schema = {
      kind: "object",
      fields: {
        log: { kind: "channel", label: "Log channel", essential: true },
        news: { kind: "array", label: "News feeds", essential: "feeds" },
        steam: { kind: "array", label: "Steam games", essential: "feeds" },
        menus: { kind: "array", label: "Role menus", essential: "menus" },
      },
    } as never;
    const missing = missingEssentials(schema, { news: [{}] });
    assert.deepEqual(missing.map((entry) => entry.label), ["Log channel", "Role menus"]);
    assert.equal(missingSentence(missing), "Log channel, and one of Role menus");
  });

  test("words the sentence for one set and for single settings", () => {
    assert.equal(joinOr(["A"]), "A");
    assert.equal(joinOr(["A", "B"]), "A or B");
    assert.equal(missingSentence([{ path: "a", label: "Log channel" }, { path: "b", label: "Category" }]), "Log channel, Category");
    assert.equal(missingSentence([{ path: "a", label: "A or B", anyOf: ["A", "B"] }]), "one of A or B");
  });
});

describe("moduleStatus", () => {
  test("is off whatever is missing, while the module is off", () => {
    assert.equal(moduleStatus(false, []), "off");
    assert.equal(moduleStatus(false, [{ path: "channel", label: "Log channel" }]), "off");
  });

  test("wants attention when it is on but cannot work yet", () => {
    assert.equal(moduleStatus(true, [{ path: "channel", label: "Log channel" }]), "attention");
  });

  test("is on when it is on and configured", () => {
    assert.equal(moduleStatus(true, []), "on");
  });
});

describe("essential sets of group switches", () => {
  test("names each group by its own label rather than its switch's", () => {
    const schema = {
      kind: "object",
      fields: {
        invites: { kind: "object", label: "Invite links", fields: { enabled: { kind: "boolean", label: "On", essential: "rules" } } },
        links: { kind: "object", label: "Links", fields: { enabled: { kind: "boolean", label: "On", essential: "rules" } } },
      },
    } as never;
    const [missing] = missingEssentials(schema, { invites: { enabled: false }, links: { enabled: false } });
    assert.equal(missing?.label, "Invite links or Links");
    assert.deepEqual(missingEssentials(schema, { invites: { enabled: true } }), []);
  });
});

describe("missingEssentials in a list the feature runs on", () => {
  const schema = {
    kind: "object",
    fields: {
      panels: {
        kind: "array",
        label: "Panels",
        essential: true,
        of: {
          kind: "object",
          fields: {
            channel: { kind: "channel", label: "Channel", essential: true },
            opening: {
              kind: "object",
              fields: {
                mode: { kind: "choice", default: "channel" },
                category: { kind: "channel", label: "Category", essential: true, when: { field: "mode", equals: "channel" } },
              },
            },
          },
        },
      },
    },
  } as never;

  test("a row nobody finished leaves the feature needing setup, once per setting", () => {
    const missing = missingEssentials(schema, { panels: [{}, {}] });
    assert.deepEqual(
      missing.map((entry) => entry.label),
      ["Panels: Channel", "Panels: Category"],
    );
    assert.equal(moduleStatus(true, missing), "attention");
  });

  test("leaves out a setting whose condition is not met", () => {
    const missing = missingEssentials(schema, { panels: [{ channel: "123456789012345678", opening: { mode: "thread" } }] });
    assert.deepEqual(missing, []);
  });

  test("is set up once every row is filled in", () => {
    const row = { channel: "123456789012345678", opening: { mode: "channel", category: "223456789012345678" } };
    assert.deepEqual(missingEssentials(schema, { panels: [row] }), []);
  });
});
