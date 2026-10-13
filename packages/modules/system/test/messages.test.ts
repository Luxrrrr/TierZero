import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, applyVariables, type FieldDescriptor } from "@tier0/core";
import system, {
  LABEL_DEFAULTS,
  SYSTEM_INFO,
  SYSTEM_MESSAGES,
  SYSTEM_MESSAGE_KEYS,
  SYSTEM_VARIABLES,
  systemMessage,
  type SystemSettings,
} from "../dist/index.js";

const registry = new ModuleRegistry();
registry.register(system);

function resolve(stored: unknown): SystemSettings {
  const resolved = registry.resolveSettings("system", stored);
  assert.ok(resolved.ok, resolved.ok ? "" : resolved.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  return resolved.value as SystemSettings;
}

/** What the router and the component handlers said before any of it could be edited. */
const TODAY: Record<(typeof SYSTEM_MESSAGE_KEYS)[number], string> = {
  featureOff: "That feature is switched off on this server.",
  channelOff: "That command is turned off in this channel.",
  noRole: "You do not have a role that is allowed to use that command.",
  commandFailed: "That command did not finish. The server log has the details.",
  roleGone: "That role no longer exists.",
  roleTooHigh: "I can't change **{role}** because it sits above my own highest role. Ask an admin to move my role above it.",
  memberNotFound: "I couldn't find you on this server.",
  roleChangeFailed: "I couldn't change **{role}**. Check that I have Manage Roles.",
  roleGiven: "You now have **{role}**.",
  roleTaken: "**{role}** was taken off you.",
  notActive: "This message's buttons and menus are no longer active.",
  componentFailed: "That didn't work. The server log has the details.",
};

describe("the system module", () => {
  test("is always on", () => {
    const summary = registry.describe()[0];
    assert.equal(summary?.alwaysOn, true);
    assert.equal(summary?.id, "system");
  });

  test("starts unconfigured with every message at today's wording", () => {
    const settings = resolve({});
    for (const key of SYSTEM_MESSAGE_KEYS) {
      const message = systemMessage(settings, key);
      assert.equal(message.content, TODAY[key], key);
      assert.deepEqual(message.embeds, [], key);
    }
  });

  test("the defaults the router falls back on are the same text", () => {
    for (const key of SYSTEM_MESSAGE_KEYS) assert.equal(SYSTEM_MESSAGES[key].content, TODAY[key], key);
  });

  test("keeps the short labels at today's text", () => {
    const { labels } = resolve({});
    assert.equal(labels.unknownRole, "Unknown role");
    assert.equal(labels.unknownChannel, "# unknown channel");
    assert.equal(labels.webhookName, "TierZero messages");
    assert.equal(labels.defaultSender, "the dashboard");
    assert.equal(labels.timeoutRemovalReason, "Case #{case} removed by {actor}");
    assert.deepEqual(labels, LABEL_DEFAULTS);
  });

  test("uses an owner's wording", () => {
    const settings = resolve({
      replies: { commands: { featureOff: { content: "Not available here.", embeds: [], buttons: [], selects: [], reactions: [] } } },
    });
    assert.equal(systemMessage(settings, "featureOff").content, "Not available here.");
    assert.equal(systemMessage(settings, "channelOff").content, TODAY.channelOff);
  });

  test("reads wording stored as plain text, as the message fields do everywhere", () => {
    const settings = resolve({ replies: { buttons: { roleGiven: "Welcome to {role}!" } } });
    assert.equal(systemMessage(settings, "roleGiven").content, "Welcome to {role}!");
  });

  test("finds every message wherever the settings keep it", () => {
    const settings = resolve({});
    for (const key of SYSTEM_MESSAGE_KEYS) assert.ok(systemMessage(settings, key), key);
  });

  test("turns away a label past Discord's limit", () => {
    const tooLong = (field: string, length: number) => registry.resolveSettings("system", { labels: { [field]: "x".repeat(length) } });
    assert.equal(tooLong("unknownRole", 101).ok, false);
    assert.equal(tooLong("unknownRole", 100).ok, true);
    assert.equal(tooLong("webhookName", 81).ok, false);
    assert.equal(tooLong("defaultSender", 81).ok, false);
    assert.equal(tooLong("timeoutRemovalReason", 513).ok, false);
    assert.equal(tooLong("timeoutRemovalReason", 512).ok, true);
  });

  test("only accepts the placeholders the audit reason is filled in with", () => {
    assert.equal(registry.resolveSettings("system", { labels: { timeoutRemovalReason: "{case} by {actor}" } }).ok, true);
    assert.equal(registry.resolveSettings("system", { labels: { timeoutRemovalReason: "{who}" } }).ok, false);
  });
});

describe("what the dashboard is told", () => {
  const fields = (): Record<string, FieldDescriptor> => {
    const schema = registry.describe()[0]!.schema;
    const replies = (schema.fields as Record<string, FieldDescriptor>).replies!;
    const groups = replies.fields as Record<string, FieldDescriptor>;
    return {
      ...(groups.commands!.fields as Record<string, FieldDescriptor>),
      ...(groups.buttons!.fields as Record<string, FieldDescriptor>),
    };
  };

  test("lists every message once, compact, with when it is sent", () => {
    const described = fields();
    assert.deepEqual(Object.keys(described).sort(), [...SYSTEM_MESSAGE_KEYS].sort());
    for (const [key, field] of Object.entries(described)) {
      assert.equal(field.kind, "message", key);
      assert.equal(field.compact, true, key);
      assert.ok(typeof field.help === "string" && field.help.length > 20, `${key} says when it is sent`);
    }
  });

  test("groups are collapsible and labelled for owners", () => {
    const top = registry.describe()[0]!.schema.fields as Record<string, FieldDescriptor>;
    assert.equal(top.replies?.label, "Replies and errors");
    assert.equal(top.replies?.collapsible, true);
    assert.equal(top.labels?.label, "Labels and text");
    assert.equal(top.labels?.collapsible, true);
  });

  test("every variable a default uses is declared, so the editor offers it", () => {
    for (const key of SYSTEM_MESSAGE_KEYS) {
      const used = [...SYSTEM_MESSAGES[key].content.matchAll(/\{([\w.]+)\}/g)].map((match) => match[1]);
      const declared = SYSTEM_VARIABLES[key].map((variable) => variable.name);
      for (const name of used) assert.ok(declared.includes(name ?? ""), `${key} uses {${name}} without declaring it`);
    }
  });

  test("every declared variable has a description and a sample for the preview", () => {
    for (const key of SYSTEM_MESSAGE_KEYS) {
      for (const variable of SYSTEM_VARIABLES[key]) {
        assert.ok(variable.description.length > 0 && variable.sample.length > 0, `${key}.${variable.name}`);
      }
    }
  });

  test("a message the info table does not describe cannot exist", () => {
    for (const key of SYSTEM_MESSAGE_KEYS) assert.ok(SYSTEM_INFO[key].label.length > 0, key);
  });

  test("the audit reason default fills in the way the dashboard used to word it", () => {
    assert.equal(applyVariables(LABEL_DEFAULTS.timeoutRemovalReason, { case: "12", actor: "Ada" }), "Case #12 removed by Ada");
  });
});
