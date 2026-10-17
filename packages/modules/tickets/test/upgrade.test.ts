import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_PANEL_ID, LEGACY_TYPE_ID, ModuleRegistry, embedReply, type MessageBody } from "@tier0/core";
import tickets from "../dist/index.js";
import { derivedId, upgradeSettings } from "../dist/upgrade.js";
import { OPENED_MESSAGE, PANEL_MESSAGE, REPLIES, TRANSCRIPT_MESSAGE } from "../dist/messages.js";
import {
  effectiveAutoClose,
  effectiveChannelName,
  effectiveLimit,
  effectiveTranscriptChannel,
  legacyButtonType,
  pingRolesOf,
  staffRolesOf,
  typeLabel,
} from "../dist/resolve.js";
import type { TicketSettings } from "../dist/settings.js";

const PANEL_CHANNEL = "123456789012345678";
const CATEGORY = "223456789012345678";
const ROLE_A = "323456789012345678";
const ROLE_B = "423456789012345678";
const LOG_CHANNEL = "523456789012345678";

const registry = new ModuleRegistry();
registry.register(tickets);

function parse(stored: unknown): TicketSettings {
  const result = registry.resolveSettings("tickets", stored);
  assert.ok(result.ok, result.ok ? "" : result.errors.map((e) => `${e.path} ${e.message}`).join("; "));
  return result.value as TicketSettings;
}

const custom = (text: string): MessageBody => ({ ...embedReply(text, "info"), embeds: [{ ...embedReply(text, "info").embeds[0]!, color: "#123456" }] });

/**
 * Settings as the dashboard saved them before panels had types: the parsed
 * value of that schema, with every group present and durations in
 * milliseconds, and an owner who changed a little of everything.
 */
const SAVED_BEFORE_TYPES = {
  panel: {
    channel: PANEL_CHANNEL,
    message: custom("Press the button for help"),
    buttonLabel: "Get help",
    buttonEmoji: "🎫",
  },
  category: CATEGORY,
  supportRoles: [ROLE_A, ROLE_B],
  ticketLimit: 3,
  transcript: { enabled: true, channel: LOG_CHANNEL, message: custom("Log for #{number}") },
  messages: {
    opened: custom("Welcome {user}, {supportRoles} will be with you"),
    created: custom("Made {ticket}"),
    closing: custom("Bye{ending}"),
    added: custom("Hi {member}"),
    removed: custom("Bye {member}"),
    panelPosted: custom("Posted in {panelChannel}"),
    refusals: { notStaff: custom("Staff only"), cannotClose: REPLIES.cannotClose.starting },
    opening: { limitMany: custom("{openCount} of {limit}") },
    panel: { panelFailed: custom("No luck") },
  },
  autoClose: { enabled: true, after: 2 * 3_600_000, notice: true },
  labels: {
    modalTitle: "Talk to us",
    modalQuestion: "What's wrong?",
    closeButton: "Done",
    channelName: "help-{username}",
    topicWithSubject: "{username}: {subject}",
    transcript: { fileName: "case-{number}.txt" },
  },
};

/** Older still: the panel had a title and a body instead of a message, and nothing else was ever changed. */
const SAVED_WITH_TITLE_AND_BODY = {
  panel: { channel: PANEL_CHANNEL, title: "Support", body: "Click below" },
  category: CATEGORY,
  supportRoles: [ROLE_A],
};

describe("settings saved before ticket types", () => {
  const settings = parse(SAVED_BEFORE_TYPES);
  const panel = settings.panels[0]!;
  const type = panel.types[0]!;

  test("become one panel with one Support type", () => {
    assert.equal(settings.panels.length, 1);
    assert.equal(panel.types.length, 1);
    assert.equal(panel.id, LEGACY_PANEL_ID);
    assert.equal(type.id, LEGACY_TYPE_ID);
    assert.equal(type.name, "Support");
  });

  test("keep the panel's channel, message, button text and emoji", () => {
    assert.equal(panel.channel, PANEL_CHANNEL);
    assert.deepEqual(panel.message, SAVED_BEFORE_TYPES.panel.message);
    assert.equal(panel.style, "buttons");
    assert.equal(typeLabel(type), "Get help");
    assert.equal(type.emoji, "🎫");
    assert.equal(type.appearance.buttonStyle, "primary");
  });

  test("carry the category and the support roles onto the type", () => {
    assert.equal(type.opening.mode, "channel");
    assert.equal(type.opening.category, CATEGORY);
    assert.deepEqual(type.handlers, [ROLE_A, ROLE_B]);
    assert.deepEqual(pingRolesOf(type), [ROLE_A, ROLE_B]);
    assert.deepEqual(staffRolesOf(settings, type), [ROLE_A, ROLE_B]);
  });

  test("ask the same one optional question, and show the answer only as the subject", () => {
    assert.deepEqual(type.form, [{ label: "What's wrong?", style: "paragraph", required: false, maxLength: 200 }]);
    assert.equal(type.showAnswers, false);
    assert.equal(settings.labels.modalTitle, "Talk to us");
    assert.equal((settings.labels as Record<string, unknown>).modalQuestion, undefined);
  });

  test("keep the first message, limit and channel name", () => {
    assert.deepEqual(type.welcome, SAVED_BEFORE_TYPES.messages.opened);
    assert.equal(effectiveLimit(settings, type), 3);
    assert.equal(effectiveChannelName(settings, type), "help-{username}");
    assert.equal(type.rules.openerCanClose, true);
    assert.equal(type.rules.claim, true);
  });

  test("keep the transcript and the inactivity settings", () => {
    assert.equal(settings.transcripts.postFile, true);
    assert.equal(effectiveTranscriptChannel(settings, type), LOG_CHANNEL);
    assert.deepEqual(settings.transcripts.message, SAVED_BEFORE_TYPES.transcript.message);
    assert.deepEqual(effectiveAutoClose(settings, type), { enabled: true, after: 2 * 3_600_000, notice: true });
  });

  test("keep every reworded message and label", () => {
    assert.deepEqual(settings.messages.created, SAVED_BEFORE_TYPES.messages.created);
    assert.deepEqual(settings.messages.closing, SAVED_BEFORE_TYPES.messages.closing);
    assert.deepEqual(settings.messages.panelPosted, SAVED_BEFORE_TYPES.messages.panelPosted);
    assert.deepEqual(settings.messages.refusals.notStaff, SAVED_BEFORE_TYPES.messages.refusals.notStaff);
    assert.deepEqual(settings.messages.opening.limitMany, SAVED_BEFORE_TYPES.messages.opening.limitMany);
    assert.deepEqual(settings.messages.panel.panelFailed, SAVED_BEFORE_TYPES.messages.panel.panelFailed);
    assert.equal(settings.labels.closeButton, "Done");
    assert.equal(settings.labels.topicWithSubject, "{username}: {subject}");
    assert.equal(settings.labels.transcript.fileName, "case-{number}.txt");
    assert.equal((settings.messages as Record<string, unknown>).opened, undefined);
  });

  test("start everything new switched off or at its old equivalent", () => {
    assert.equal(settings.general.closeBehaviour, "delete");
    assert.deepEqual(settings.general.adminRoles, []);
    assert.equal(settings.general.claimLock, false);
    assert.equal(settings.transcripts.dmOpener, false);
    assert.equal(settings.transcripts.summary, false);
    assert.equal(settings.ratings.enabled, false);
    assert.equal(settings.automation.reminder.enabled, false);
    assert.deepEqual(settings.general.blocklist.members, []);
  });

  test("a transcript that was switched off stays off", () => {
    const off = parse({ ...SAVED_BEFORE_TYPES, transcript: { enabled: false, channel: LOG_CHANNEL } });
    assert.equal(off.transcripts.postFile, false);
  });

  test("a panel with a title and a body still reads, in the old colour", () => {
    const old = parse(SAVED_WITH_TITLE_AND_BODY);
    const message = old.panels[0]!.message;
    assert.equal(message.embeds[0]?.title, "Support");
    assert.equal(message.embeds[0]?.description, "Click below");
    assert.equal(message.embeds[0]?.color, PANEL_MESSAGE.embeds[0]?.color);
    assert.equal(typeLabel(old.panels[0]!.types[0]!), "Open a ticket", "the old default button text");
    assert.deepEqual(old.panels[0]!.types[0]!.welcome, OPENED_MESSAGE);
    assert.deepEqual(old.transcripts.message, TRANSCRIPT_MESSAGE);
    assert.equal(old.transcripts.postFile, true, "transcripts were on by default");
  });

  test("an old panel's button opens the type it became", () => {
    assert.equal(legacyButtonType(settings)?.type.id, LEGACY_TYPE_ID);
  });
});

describe("the upgrade", () => {
  test("is idempotent on raw stored values", () => {
    for (const stored of [SAVED_BEFORE_TYPES, SAVED_WITH_TITLE_AND_BODY, {}]) {
      const once = upgradeSettings(structuredClone(stored));
      assert.deepEqual(upgradeSettings(structuredClone(once)), once);
    }
  });

  test("leaves what it reads alone when saved and read again", () => {
    for (const stored of [SAVED_BEFORE_TYPES, SAVED_WITH_TITLE_AND_BODY, {}]) {
      const first = parse(stored);
      assert.deepEqual(parse(JSON.parse(JSON.stringify(first))), first);
    }
  });

  test("does not change the stored object it is given", () => {
    const stored = structuredClone(SAVED_BEFORE_TYPES);
    upgradeSettings(stored);
    assert.deepEqual(stored, SAVED_BEFORE_TYPES);
  });

  test("gives a new server one panel to fill in", () => {
    const fresh = parse({});
    assert.equal(fresh.panels.length, 1);
    assert.equal(fresh.panels[0]!.types.length, 1);
    assert.equal(fresh.panels[0]!.channel, undefined);
    assert.equal(fresh.panels[0]!.types[0]!.opening.category, undefined);
    assert.deepEqual(fresh.panels[0]!.types[0]!.handlers, []);
  });

  test("does not bring back panels the owner removed", () => {
    assert.deepEqual(parse({ panels: [] }).panels, []);
  });

  test("lets a current value win over a leftover old key", () => {
    const settings = parse({ panels: [], ticketLimit: 5, general: { ticketLimit: 2 } });
    assert.equal(settings.general.ticketLimit, 2);
    const mixed = parse({ ticketLimit: 5, general: { ticketLimit: 2 } });
    assert.equal(mixed.general.ticketLimit, 2);
  });

  test("fills a missing id from the row's place and name, the same way every time", () => {
    const stored = { panels: [{ name: "Help", types: [{ name: "Billing" }, { name: "Bugs", id: "bugs" }] }] };
    const first = parse(stored);
    const second = parse(stored);
    assert.equal(first.panels[0]!.id, derivedId("panel:0", 0, "Help"));
    assert.equal(first.panels[0]!.types[0]!.id, derivedId("type:0:0", 0, "Billing"));
    assert.equal(first.panels[0]!.types[1]!.id, "bugs");
    assert.deepEqual(second, first);
    assert.match(first.panels[0]!.id, /^[0-9a-f]{8}$/);
  });

  test("keeps type ids unique across panels, keeping the first", () => {
    const settings = parse({
      panels: [
        { id: "main", name: "A", types: [{ id: "same", name: "One" }] },
        { id: "main", name: "B", types: [{ id: "same", name: "Two" }, { id: "bad id!", name: "Three" }] },
      ],
    });
    const panelIds = settings.panels.map((panel) => panel.id);
    const typeIds = settings.panels.flatMap((panel) => panel.types.map((type) => type.id));
    assert.equal(panelIds[0], "main");
    assert.notEqual(panelIds[1], "main");
    assert.equal(typeIds[0], "same");
    assert.equal(new Set(typeIds).size, 3);
    for (const id of typeIds) assert.match(id, /^[A-Za-z0-9_-]{1,32}$/);
  });

  test("leaves a value it cannot read for validation to refuse", () => {
    assert.equal(registry.resolveSettings("tickets", { panels: "nope" }).ok, false);
    assert.equal(registry.resolveSettings("tickets", { panels: [{ name: "No types", types: [] }] }).ok, false);
  });
});
