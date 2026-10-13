import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, applyVariables, applyVariablesToMessage, type FieldDescriptor, type MessageBody } from "@tier0/core";
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

interface Resolved {
  panel: { message: MessageBody; buttonLabel: string };
  transcript: { message: MessageBody };
  messages: Record<"opened" | "created" | "closing" | "added" | "removed" | "panelPosted", MessageBody>;
}

function resolve(stored: unknown): Resolved {
  const result = registry.resolveSettings("tickets", { category: CATEGORY, supportRoles: [ROLE_A], ...(stored as object) });
  assert.ok(result.ok, "settings should resolve");
  return result.value as Resolved;
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
    const values = openedValues(opener, { id: 7, subject: "Cannot log in" }, CHANNEL, [ROLE_A, ROLE_B]);
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
    assert.deepEqual(resolve({}).transcript.message, TRANSCRIPT_MESSAGE);
  });

  test("names the scheduled close rather than mentioning it", () => {
    const values = transcriptValues({ id: 12, subject: "Help", openerId: "42" }, { id: "auto-close", tag: "Auto-close" }, "ticket-ada");
    assert.equal(values.closedBy, "Auto-close");
    assert.equal(values.user, "<@42>");
    const person = transcriptValues({ id: 12, subject: null, openerId: "42" }, { id: "9", tag: "grace" }, "ticket-ada");
    assert.equal(person.closedBy, "<@9>");
  });

  test("a customised message and a legacy string both read", () => {
    const { transcript } = resolve({ transcript: { message: "Log for #{number} by {user}" } });
    assert.equal(transcript.message.content, "Log for #{number} by {user}");
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

  test("the opening message still pings the opener and the support roles from its text", () => {
    assert.equal(OPENED_MESSAGE.content, "{user} {supportRoles}");
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
  const names = (field: FieldDescriptor | undefined) => (field?.variables as { name: string }[]).map((variable) => variable.name);

  test("every message is a message field that cannot carry the module's own buttons", () => {
    const nested = Object.values(group("messages")).flatMap((field) =>
      field.kind === "object" ? Object.values(field.fields as Record<string, FieldDescriptor>) : [field],
    );
    for (const field of [group("panel").message, group("transcript").message, ...nested]) {
      assert.equal(field?.kind, "message");
      assert.equal(field?.components, false);
    }
  });

  test("the first message offers its variables", () => {
    assert.deepEqual(names(group("messages").opened), ["user", "username", "subject", "title", "number", "ticket", "supportRoles"]);
  });

  test("the replies only the member sees are delivered as direct-style messages", () => {
    assert.equal(group("messages").created?.delivery, "dm");
    assert.equal(group("messages").closing?.delivery, "channel");
  });
});
