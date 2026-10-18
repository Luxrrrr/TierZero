import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed, type TicketMessageDto, type TicketTemplateDto } from "@tier0/core";
import { embedProblems } from "../lib/ticket-embeds.ts";
import { filledTemplate, groupTemplates, insertTemplate as insert, leftOutNote, matchTemplates, templateValues } from "../lib/ticket-templates.ts";
import { canReplyTo, latestToReplyTo, replyTargetOf } from "../lib/ticket-reply-to.ts";
import { shortcutFor, TICKET_SHORTCUTS } from "../lib/ticket-shortcuts.ts";
import { messageEntries } from "../lib/person-menu.ts";

const embed = (over: Partial<ReturnType<typeof emptyEmbed>> = {}) => ({ ...emptyEmbed(), ...over });
const template = (over: Partial<TicketTemplateDto> = {}): TicketTemplateDto => ({
  id: 1,
  name: "Refund steps",
  folder: null,
  content: "",
  embeds: [],
  leftOut: [],
  ...over,
});

const ticket = {
  id: 7,
  number: 42,
  typeName: "Billing",
  channelId: "310000000000000001",
  channelName: "billing-0042",
  opener: { userId: "130000000000000001", name: "Ada" },
} as never;
const server = { server: "Northwind", members: "2,431", bot: "TierZero", "server.icon": "https://cdn.example/i.png" };
const values = templateValues(ticket, "130000000000000002", server, new Date("2026-10-18T12:00:00Z"));

describe("what a template's variables become in a ticket", () => {
  test("the ones saved replies fill, the server's, and the channel", () => {
    assert.equal(values.user, "<@130000000000000001>");
    assert.equal(values.staff, "<@130000000000000002>");
    assert.equal(values.number, "42");
    assert.equal(values.type, "Billing");
    assert.equal(values.ticket, "<#310000000000000001>");
    assert.equal(values.server, "Northwind");
    assert.equal(values.members, "2,431");
    assert.equal(values.channel, "<#310000000000000001>");
    assert.equal(values["channel.name"], "billing-0042");
    assert.match(values.date!, /^<t:\d+:D>$/);
  });

  test("a template is filled in text and embeds, and an unknown name is left as typed", () => {
    const filled = filledTemplate(
      template({ content: "Hi {user}, ticket #{number} in {server} {nonsense}", embeds: [embed({ title: "Ticket {number}", footerText: "{server}" })] }),
      values,
    );
    assert.equal(filled.content, "Hi <@130000000000000001>, ticket #42 in Northwind {nonsense}");
    assert.equal(filled.embeds[0]!.title, "Ticket 42");
    assert.equal(filled.embeds[0]!.footerText, "Northwind");
  });
});

describe("finding a template", () => {
  const list = [
    template({ id: 1, name: "Refund steps", folder: "Billing", content: "Open Billing" }),
    template({ id: 2, name: "Password reset", folder: "Accounts", embeds: [embed({ description: "Use the refund link" })] }),
    template({ id: 3, name: "Apology", folder: null }),
    template({ id: 4, name: "Billing hours", folder: "Billing" }),
  ];

  test("an empty search keeps the order", () => {
    assert.deepEqual(matchTemplates(list, "  ").map((t) => t.id), [1, 2, 3, 4]);
  });

  test("names come first, then folders, then what the template says", () => {
    assert.deepEqual(matchTemplates(list, "refund").map((t) => t.id), [1, 2]);
    assert.deepEqual(matchTemplates(list, "billing").map((t) => t.id), [4, 1]);
    assert.deepEqual(matchTemplates(list, "accounts").map((t) => t.id), [2]);
    assert.deepEqual(matchTemplates(list, "zzz"), []);
  });

  test("groups put unfiled first and folders in order, each keeping its order", () => {
    const groups = groupTemplates(list);
    assert.deepEqual(groups.map((g) => g.folder), [null, "Accounts", "Billing"]);
    assert.deepEqual(groups[2]!.templates.map((t) => t.id), [1, 4]);
    assert.deepEqual(groupTemplates([]), []);
  });
});

const insertTemplate = (...args: [TicketTemplateDto, Record<string, string>, never[] | ReturnType<typeof embed>[], boolean]) => insert(...args, embedProblems);

describe("adding a template to a reply", () => {
  test("its embeds join the reply, with the name cleared and variables filled", () => {
    const result = insertTemplate(template({ embeds: [embed({ name: "internal", title: "Ticket {number}" })] }), values, [], false);
    assert.ok(result.ok);
    assert.equal(result.value.embeds[0]!.title, "Ticket 42");
    assert.equal(result.value.embeds[0]!.name, "");
    assert.equal(result.value.text, "");
  });

  test("its text comes along only when asked", () => {
    const t = template({ content: "Hi {user}", embeds: [embed({ title: "x" })] });
    const without = insertTemplate(t, values, [], false);
    const withText = insertTemplate(t, values, [], true);
    assert.ok(without.ok && withText.ok);
    assert.equal(without.value.text, "");
    assert.equal(withText.value.text, "Hi <@130000000000000001>");
  });

  test("a template with only text and no box ticked has nothing to add", () => {
    const result = insertTemplate(template({ content: "Sorry" }), values, [], false);
    assert.equal(result.ok, false);
    assert.equal(insertTemplate(template({ content: "Sorry" }), values, [], true).ok, true);
  });

  test("buttons, menus and reactions are named as left out", () => {
    const result = insertTemplate(template({ embeds: [embed({ title: "x" })], leftOut: ["buttons", "reactions"] }), values, [], false);
    assert.ok(result.ok);
    assert.deepEqual(result.value.notes, ["Its buttons and reactions are left out, because a reply cannot carry them."]);
    assert.equal(leftOutNote([]), null);
    assert.equal(leftOutNote(["menus"]), "Its menus are left out, because a reply cannot carry them.");
  });

  test("the limit of three embeds holds, and the ones that do not fit say so", () => {
    const four = template({ embeds: [1, 2, 3, 4].map((n) => embed({ title: `E${n}` })) });
    const result = insertTemplate(four, values, [embed({ title: "mine" })], false);
    assert.ok(result.ok);
    assert.deepEqual(result.value.embeds.map((e) => e.title), ["E1", "E2"]);
    assert.equal(result.value.notes.length, 2);
    assert.match(result.value.notes[0]!, /Embed 3 was left out: a reply can carry 3 embeds/);
  });

  test("the character allowance holds too", () => {
    const big = embed({ description: "x".repeat(4000) });
    const result = insertTemplate(template({ embeds: [embed({ title: "small" }), big] }), values, [embed({ description: "y".repeat(3000) })], false);
    assert.ok(result.ok);
    assert.deepEqual(result.value.embeds.map((e) => e.title), ["small"]);
    assert.match(result.value.notes[0]!, /Embed 2 was left out: .*6,000/);
  });

  test("an embed a reply would refuse is left out, not sent", () => {
    const refused = insertTemplate(template({ embeds: [embed({ title: "bad", url: "javascript:alert(1)" })] }), values, [], false);
    assert.equal(refused.ok, false);
    const mixed = insertTemplate(template({ embeds: [embed({ title: "ok" }), embed({ title: "bad", url: "javascript:alert(1)" })] }), values, [], false);
    assert.ok(mixed.ok);
    assert.deepEqual(mixed.value.embeds.map((e) => e.title), ["ok"]);
  });
});

const message = (over: Partial<TicketMessageDto> = {}): TicketMessageDto =>
  ({
    id: 1,
    messageId: "140000000000000001",
    author: { userId: "130000000000000001", name: "Ada", avatarUrl: null, isStaff: false },
    content: "I **cannot** log in",
    attachments: [],
    embeds: [],
    createdAt: "2026-10-18T12:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    edits: 0,
    source: "discord",
    ...over,
  }) as TicketMessageDto;

describe("picking a message to reply to", () => {
  test("the bar names the author and quotes the start of the message", () => {
    assert.deepEqual(replyTargetOf(message()), { messageId: "140000000000000001", name: "Ada", snippet: "I cannot log in" });
  });

  test("a deleted message or one without a real id cannot be answered", () => {
    assert.equal(canReplyTo(message()), true);
    assert.equal(canReplyTo(message({ deletedAt: "2026-10-18T13:00:00.000Z" })), false);
    assert.equal(canReplyTo(message({ messageId: "local-1" })), false);
  });

  test("the shortcut answers the latest message from the member, else the latest there is", () => {
    const staff = { userId: "130000000000000002", name: "Grace", avatarUrl: null, isStaff: true };
    const list = [
      message({ messageId: "140000000000000001" }),
      message({ messageId: "140000000000000002", author: staff }),
      message({ messageId: "140000000000000003", deletedAt: "2026-10-18T13:00:00.000Z" }),
    ];
    assert.equal(latestToReplyTo(list)?.messageId, "140000000000000001");
    assert.equal(latestToReplyTo([list[1]!])?.messageId, "140000000000000002");
    assert.equal(latestToReplyTo([]), null);
  });

  test("Shift+R is the key, shown as two keys, and typing in a box does not trigger it", () => {
    const press = (key: string, tagName = "BODY") => ({ key, ctrlKey: false, metaKey: false, altKey: false, target: { tagName } });
    assert.equal(shortcutFor(press("R")), "replyLatest");
    assert.equal(shortcutFor(press("R", "TEXTAREA")), null);
    assert.equal(shortcutFor(press("Shift")), null);
    assert.deepEqual(TICKET_SHORTCUTS.find((entry) => entry.action === "replyLatest")?.keys, ["Shift", "R"]);
  });

  test("the message menu offers Reply first only where the page can answer", () => {
    const base = { guildId: "1", role: null, user: { userId: "130000000000000001", name: "Ada", inServer: true }, options: null } as const;
    const plain = messageEntries({ ...base, message: { channelId: "2", messageId: "3", content: "hi" } });
    assert.equal(plain.some((entry) => entry.id === "reply"), false);
    let answered = 0;
    const entries = messageEntries({ ...base, message: { channelId: "2", messageId: "3", content: "hi", onReply: () => (answered += 1) } });
    assert.equal(entries[0]!.id, "reply");
    assert.equal(entries[0]!.separated, false);
    const effect = entries[0]!.effect;
    assert.equal(effect.type, "run");
    if (effect.type === "run") effect.run();
    assert.equal(answered, 1);
  });
});
