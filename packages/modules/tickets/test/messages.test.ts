import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_VARIABLES, ModuleRegistry, REPLY_COLOR, applyVariables, applyVariablesToMessage, type FieldDescriptor, type MessageBody } from "@tier0/core";
import tickets from "../dist/index.js";
import {
  ADDED_MESSAGE,
  CLOSING_MESSAGE,
  CREATED_MESSAGE,
  OPENED_MESSAGE,
  PANEL_MESSAGE,
  PANEL_POSTED_MESSAGE,
  REMOVED_MESSAGE,
  TRANSCRIPT_MESSAGE,
  closingValues,
  openedValues,
  transcriptValues,
  upgradePanel,
} from "../dist/messages.js";

const CHANNEL = "123456789012345678";
const CATEGORY = "223456789012345678";
const ROLE_A = "323456789012345678";
const ROLE_B = "423456789012345678";

const registry = new ModuleRegistry();
registry.register(tickets);

interface Stored {
  panels: { message: MessageBody; types: { welcome: MessageBody; appearance: { buttonLabel?: string } }[] }[];
  transcripts: { message: MessageBody };
  messages: Record<"created" | "closing" | "added" | "removed" | "panelPosted", MessageBody>;
}

interface Resolved extends Stored {
  panel: Stored["panels"][number];
  messages: Stored["messages"] & { opened: MessageBody };
}

/** Settings saved before panels had types, read through the upgrade into the current shape. */
function resolve(stored: unknown): Resolved {
  const result = registry.resolveSettings("tickets", { category: CATEGORY, supportRoles: [ROLE_A], ...(stored as object) });
  assert.ok(result.ok, "settings should resolve");
  const value = result.value as Stored;
  const panel = value.panels[0]!;
  return { ...value, panel, messages: { ...value.messages, opened: panel.types[0]!.welcome } };
}

const fill = (body: MessageBody, values: Record<string, string | number>) =>
  applyVariablesToMessage(body, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])));

describe("the panel", () => {
  test("is by default the embed the panel has always been", () => {
    const { panel } = resolve({});
    const embed = panel.message.embeds[0];
    assert.equal(panel.message.content, "");
    assert.equal(embed?.title, "Need help?");
    assert.equal(embed?.description, "Press the button below to open a ticket and the support team will be with you.");
    assert.equal(embed?.color, "#5865f2");
    assert.deepEqual(panel.message, PANEL_MESSAGE);
  });

  test("carries a saved title and body over, in the same colour", () => {
    const { panel } = resolve({ panel: { title: "Talk to us", body: "Click below" } });
    assert.equal(panel.message.embeds[0]?.title, "Talk to us");
    assert.equal(panel.message.embeds[0]?.description, "Click below");
    assert.equal(panel.message.embeds[0]?.color, "#5865f2");
  });

  test("keeps the default for whichever of the two was never changed", () => {
    const { panel } = resolve({ panel: { title: "Talk to us" } });
    assert.equal(panel.message.embeds[0]?.title, "Talk to us");
    assert.equal(panel.message.embeds[0]?.description, PANEL_MESSAGE.embeds[0]?.description);
  });

  test("a message written in the dashboard wins over an old title", () => {
    const { panel } = resolve({ panel: { title: "Old", message: { content: "Hello", embeds: [] } } });
    assert.equal(panel.message.content, "Hello");
    assert.deepEqual(panel.message.embeds, []);
  });

  test("never carries buttons, because the module owns the one that opens a ticket", () => {
    const button = { label: "x", style: "primary", action: { type: "none" } };
    const { panel } = resolve({ panel: { message: { content: "Hi", buttons: [button] } } });
    assert.deepEqual(panel.message.buttons, []);
  });

  test("the upgrade is idempotent", () => {
    const once = upgradePanel({ channel: CHANNEL, title: "T", body: "B", buttonLabel: "Open" });
    assert.deepEqual(upgradePanel(once), once);
    assert.equal(once.title, undefined);
    assert.equal(once.buttonLabel, "Open");
  });
});

describe("the first message in a ticket", () => {
  const opener = { id: "42", username: "ada" };

  test("reads the same as before when there is a subject", () => {
    const values = { ...openedValues(opener, { id: 7, subject: "Cannot log in" }, CHANNEL, [ROLE_A, ROLE_B]), pingRoles: `<@&${ROLE_A}> <@&${ROLE_B}>` };
    const message = fill(OPENED_MESSAGE, values);
    assert.equal(message.content.trim(), `<@42> <@&${ROLE_A}> <@&${ROLE_B}>`);
    assert.equal(message.embeds[0]?.title, "Cannot log in");
    assert.equal(message.embeds[0]?.description, "Opened by <@42>");
    assert.equal(message.embeds[0]?.color, "#5865f2");
  });

  test("falls back to New ticket without a subject", () => {
    const message = fill(OPENED_MESSAGE, openedValues(opener, { id: 7, subject: null }, CHANNEL, [ROLE_A]));
    assert.equal(message.embeds[0]?.title, "New ticket");
  });

  test("is the default setting, and a customised one is used", () => {
    assert.deepEqual(resolve({}).messages.opened, OPENED_MESSAGE);
    const custom = resolve({ messages: { opened: "Hello {user}, ticket #{number}" } });
    assert.equal(custom.messages.opened.content, "Hello {user}, ticket #{number}");
    assert.equal(
      applyVariables(custom.messages.opened.content, { user: "<@42>", number: "7" }),
      "Hello <@42>, ticket #7",
    );
  });

  test("lists the support roles so they are pinged", () => {
    const values = openedValues(opener, { id: 7, subject: null }, CHANNEL, [ROLE_A, ROLE_B]);
    assert.equal(values.supportRoles, `<@&${ROLE_A}> <@&${ROLE_B}>`);
    assert.equal(values.ticket, `<#${CHANNEL}>`);
  });
});

describe("closing", () => {
  const ticket = { id: 7, subject: null };

  test("says Closing this ticket. with no reason", () => {
    const message = fill(CLOSING_MESSAGE, closingValues({ id: "9" }, ticket, null));
    assert.equal(message.embeds[0]?.description, "Closing this ticket.");
  });

  test("says Closing this ticket: reason when one was given", () => {
    const message = fill(CLOSING_MESSAGE, closingValues({ id: "9" }, ticket, "Solved"));
    assert.equal(message.embeds[0]?.description, "Closing this ticket: Solved");
  });

  test("a customised message is used", () => {
    const { messages } = resolve({ messages: { closing: "Bye, closed by {closedBy}" } });
    assert.equal(
      fill(messages.closing, closingValues({ id: "9" }, ticket, null)).content,
      "Bye, closed by <@9>",
    );
  });
});

describe("the transcript post", () => {
  test("says Transcript for ticket #N by default", () => {
    const values = transcriptValues({ id: 12, subject: null, openerId: "42" }, { id: "9", tag: "grace" }, "ticket-ada");
    assert.equal(fill(TRANSCRIPT_MESSAGE, values).embeds[0]?.description, "Transcript for ticket #12");
    assert.deepEqual(resolve({}).transcripts.message, TRANSCRIPT_MESSAGE);
  });

  test("names the scheduled close rather than mentioning it", () => {
    const values = transcriptValues({ id: 12, subject: "Help", openerId: "42" }, { id: "auto-close", tag: "Auto-close" }, "ticket-ada");
    assert.equal(values.closedBy, "Auto-close");
    assert.equal(values.user, "<@42>");
    const person = transcriptValues({ id: 12, subject: null, openerId: "42" }, { id: "9", tag: "grace" }, "ticket-ada");
    assert.equal(person.closedBy, "<@9>");
  });

  test("a customised message and a legacy string both read", () => {
    const { transcripts } = resolve({ transcript: { message: "Log for #{number} by {user}" } });
    assert.equal(transcripts.message.content, "Log for #{number} by {user}");
  });
});

describe("the default look", () => {
  test("confirmations are success embeds and the closing and transcript posts are info embeds", () => {
    for (const body of [CREATED_MESSAGE, PANEL_POSTED_MESSAGE, ADDED_MESSAGE, REMOVED_MESSAGE]) {
      assert.equal(body.content, "");
      assert.equal(body.embeds[0]?.color, REPLY_COLOR.success);
    }
    for (const body of [CLOSING_MESSAGE, TRANSCRIPT_MESSAGE]) {
      assert.equal(body.content, "");
      assert.equal(body.embeds[0]?.color, REPLY_COLOR.info);
    }
  });

  test("the opening message names the opener and the roles picked to ping", () => {
    assert.equal(OPENED_MESSAGE.content, "{user} {pingRoles}");
    assert.equal(OPENED_MESSAGE.embeds.length, 1);
  });
});

describe("the other replies", () => {
  test("say what they always have", () => {
    const { messages } = resolve({});
    assert.equal(applyVariables(messages.created.embeds[0]?.description ?? "", { ticket: `<#${CHANNEL}>` }), `Your ticket has been created: <#${CHANNEL}>`);
    assert.equal(applyVariables(messages.panelPosted.embeds[0]?.description ?? "", { panelChannel: `<#${CHANNEL}>` }), `Panel posted in <#${CHANNEL}>.`);
    assert.equal(applyVariables(messages.added.embeds[0]?.description ?? "", { member: "<@42>" }), "Added <@42> to this ticket.");
    assert.equal(applyVariables(messages.removed.embeds[0]?.description ?? "", { member: "<@42>" }), "Removed <@42> from this ticket.");
    assert.deepEqual(messages.created, CREATED_MESSAGE);
    assert.deepEqual(messages.panelPosted, PANEL_POSTED_MESSAGE);
    assert.deepEqual(messages.added, ADDED_MESSAGE);
    assert.deepEqual(messages.removed, REMOVED_MESSAGE);
  });

  test("use the owner's wording when it is written", () => {
    const { messages } = resolve({ messages: { added: { content: "", embeds: [{ description: "Welcome {member}" }] } } });
    assert.equal(messages.added.embeds[0]?.description, "Welcome {member}");
  });
});

describe("what the dashboard is told", () => {
  const summary = registry.describe().find((entry) => entry.id === "tickets");
  const fields = summary?.schema.fields as Record<string, FieldDescriptor>;
  const group = (name: string) => fields[name]?.fields as Record<string, FieldDescriptor>;
  const panelFields = (fields.panels?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
  const typeFields = (panelFields.types?.of as FieldDescriptor).fields as Record<string, FieldDescriptor>;
  const names = (field: FieldDescriptor | undefined) => (field?.variables as { name: string }[]).map((variable) => variable.name);

  test("every message is a message field that cannot carry the module's own buttons", () => {
    const nested = Object.values(group("messages")).flatMap((field) =>
      field.kind === "object" ? Object.values(field.fields as Record<string, FieldDescriptor>) : [field],
    );
    for (const field of [panelFields.message, typeFields.welcome, group("transcripts").message, ...nested]) {
      assert.equal(field?.kind, "message");
      assert.equal(field?.components, false);
    }
  });

  test("the first message offers the variables it always had, then the ones types brought", () => {
    const offered = names(typeFields.welcome);
    assert.deepEqual(offered.slice(0, 7), ["user", "username", "subject", "title", "number", "ticket", "supportRoles"]);
    for (const name of ["type", "priority", "answers", "answer1", "answer5", "claimedBy", "handlers", "pingRoles"]) {
      assert.ok(offered.includes(name), name);
    }
  });

  test("the replies only the member sees are delivered as direct-style messages", () => {
    assert.equal(group("messages").created?.delivery, "dm");
    assert.equal(group("messages").closing?.delivery, "channel");
  });
});

describe("every message the module can send", () => {
  const summary = registry.describe().find((entry) => entry.id === "tickets");
  const found: { path: string; field: FieldDescriptor }[] = [];
  const walk = (field: FieldDescriptor, path: string) => {
    if (field.kind === "message") found.push({ path, field });
    if (field.kind === "object") {
      for (const [key, child] of Object.entries(field.fields as Record<string, FieldDescriptor>)) walk(child, path ? path + "." + key : key);
    }
    if (field.kind === "array") walk(field.of as FieldDescriptor, path + "[]");
  };
  walk(summary!.schema, "");
  const shared = MESSAGE_VARIABLES.map((variable) => variable.name as string);

  test("is found by walking the schema, as the Bot messages page does", () => {
    for (const path of ["panels[].message", "panels[].types[].welcome", "messages.closeRequest", "messages.claimed", "ratings.message", "ratings.thanks", "ratings.rated", "automation.reminder.message", "transcripts.summaryMessage", "transcripts.dmMessage", "general.blocklist.message", "messages.opening.cooldown"]) {
      assert.ok(found.some((entry) => entry.path === path), path);
    }
  });

  test("only uses variables it offers", () => {
    for (const { path, field } of found) {
      const offered = new Set([...shared, ...(field.variables as { name: string }[]).map((variable) => variable.name)]);
      const text = JSON.stringify(field.starting);
      for (const match of text.matchAll(/\{([a-zA-Z][a-zA-Z0-9.]*)\}/g)) {
        assert.ok(offered.has(match[1]!), path + " uses {" + match[1] + "} without offering it");
      }
    }
  });

  test("has a sample for every variable it offers", () => {
    for (const { path, field } of found) {
      for (const variable of field.variables as { name: string; description: string; sample: string }[]) {
        assert.ok(variable.description.length > 0, path + " {" + variable.name + "}");
        assert.equal(typeof variable.sample, "string");
      }
    }
  });

  test("is written without dashes standing in for punctuation", () => {
    for (const { path, field } of found) {
      assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(field.starting)), path);
    }
  });

  test("that the bot answers through its own buttons cannot carry others", () => {
    for (const { path, field } of found) {
      if (path === "transcripts.summaryMessage") {
        assert.equal(field.components, true, "the summary carries its own link button");
        continue;
      }
      assert.equal(field.components, false, path);
    }
  });
});
