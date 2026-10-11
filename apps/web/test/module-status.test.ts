import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isBlank, missingEssentials, moduleStatus } from "../lib/module-status.ts";

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
