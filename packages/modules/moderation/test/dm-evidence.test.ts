import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyVariablesToMessage, parseMessage, embedLength, type EvidenceMessage, type MessageBody } from "@tier0/core";
import { DM_EVIDENCE, formatEvidence, neutralise } from "../dist/evidence-text.js";
import { dmValues } from "../dist/dm.js";
import { DM_MESSAGE } from "../dist/messages.js";
import { moderationSettingsWith } from "./settings-helper.ts";

function message(n: number, over: Partial<EvidenceMessage> = {}): EvidenceMessage {
  return {
    id: String(1000 + n),
    channelId: "5001",
    channelName: "general",
    content: `message number ${n}`,
    attachments: [],
    createdAt: "2026-10-18T12:00:00.000Z",
    url: `https://discord.com/channels/1/5001/${1000 + n}`,
    deleted: false,
    ...over,
  };
}

const many = (count: number, over: Partial<EvidenceMessage> = {}) => Array.from({ length: count }, (_, i) => message(i + 1, over));

describe("the messages block", () => {
  test("is empty for no messages, which leaves the field out", () => {
    assert.deepEqual(formatEvidence([]), { title: "", value: "" });
  });

  test("one message is titled Message and shows where, when, a link and its words", () => {
    const { title, value } = formatEvidence([message(1)]);
    assert.equal(title, "Message");
    assert.match(value, /\*\*#general\*\*/);
    assert.match(value, /<t:\d+:f>/);
    assert.match(value, /\[Jump to message\]\(https:\/\/discord\.com\/channels\/1\/5001\/1001\)/);
    assert.match(value, /> message number 1/);
  });

  test("five messages are all written out, and twelve are counted after the fifth", () => {
    const five = formatEvidence(many(5));
    assert.equal(five.title, "Messages");
    for (let n = 1; n <= 5; n++) assert.ok(five.value.includes(`message number ${n}`), String(n));
    assert.doesNotMatch(five.value, /more message/);

    const twelve = formatEvidence(many(12));
    assert.ok(twelve.value.includes("message number 5"));
    assert.ok(!twelve.value.includes("message number 6"));
    assert.ok(twelve.value.endsWith("and 7 more messages"));
  });

  test("a message is cut to 300 characters with an ellipsis", () => {
    const { value } = formatEvidence([message(1, { content: "a".repeat(900) })]);
    const quoted = value.split("\n").find((line) => line.startsWith("> "))!;
    assert.equal(quoted.length, 2 + DM_EVIDENCE.content);
    assert.ok(quoted.endsWith("..."));
  });

  test("never passes one field's limit, however much is attached", () => {
    for (const count of [1, 2, 5, 12]) {
      const { value } = formatEvidence(many(count, { content: "word ".repeat(200), attachments: Array.from({ length: 5 }, (_, i) => ({ name: `a-long-file-name-${i}-${"x".repeat(60)}.png`, url: "https://cdn.example/x", contentType: null })) }));
      assert.ok(value.length <= 1024, `${count} messages: ${value.length}`);
      assert.ok(value.length > 0);
    }
    const long = formatEvidence(many(5, { content: "line\n".repeat(400) }));
    assert.ok(long.value.length <= 1024);
    assert.equal(long.value.split("\n").filter((line) => line === "> line").length <= 6 * 5, true, "a message shows at most six lines");
    const crowded = formatEvidence(many(5, { channelName: "c".repeat(60), content: "q".repeat(300), attachments: Array.from({ length: 5 }, (_, i) => ({ name: `${i}${"f".repeat(60)}`, url: "", contentType: null })) }));
    assert.ok(crowded.value.length <= 1024);
    assert.match(crowded.value, /and \d+ more messages?$/, "what does not fit is counted");
  });

  test("a message that is gone is shown from the saved copy, with no link", () => {
    const { value } = formatEvidence([message(1, { deleted: true, content: "I said this" })]);
    assert.match(value, /\(deleted\)/);
    assert.match(value, /> I said this/);
    assert.doesNotMatch(value, /https:/);
  });

  test("attachments are listed by name only, never linked", () => {
    const { value } = formatEvidence([message(1, { content: "", attachments: [{ name: "evidence.png", url: "https://cdn.discordapp.com/attachments/1/2/evidence.png?ex=1", contentType: "image/png" }] })]);
    assert.match(value, /Attachments: evidence\.png/);
    assert.doesNotMatch(value, /cdn\.discordapp/);
    assert.doesNotMatch(value, /\(no text\)/, "a message with a file is not shown as empty");
    assert.match(formatEvidence([message(1, { content: "" })]).value, /\(no text\)/);
  });

  test("cannot ping, mention a channel or open a code block", () => {
    const text = neutralise("@everyone @here <@123> <@&456> <#789> ```x```");
    assert.ok(!/@everyone|@here|<@1|<@&|<#7|```/.test(text), text);
    const { value } = formatEvidence([message(1, { content: "@everyone and <@123> hey", channelName: "chat@everyone" })]);
    assert.ok(!value.includes("@everyone"));
    assert.ok(!value.includes("<@123>"));
  });

  test("a damaged saved copy still formats", () => {
    const damaged = { id: "1", channelId: "2" } as unknown as EvidenceMessage;
    assert.doesNotThrow(() => formatEvidence([damaged]));
  });
});

function fill(body: MessageBody, values: Record<string, string | number>): MessageBody {
  const strings = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
  const filled = applyVariablesToMessage(body, { server: "Test Server", ...strings });
  const checked = parseMessage(filled);
  assert.ok(checked.ok, checked.ok ? "" : checked.errors[0]?.message);
  return checked.value;
}

const settings = (stored: Record<string, unknown> = {}) => moderationSettingsWith(stored);
const WHEN = new Date("2026-10-18T12:30:00.000Z");
const SECONDS = Math.floor(WHEN.getTime() / 1000);

describe("the direct message's values", () => {
  test("every variable is present even when it does not apply, so the stock embed never shows a variable's name", () => {
    const values = dmValues(settings(), { action: "kick", reason: null, expiresAt: null }, { caseNumber: 4, createdAt: WHEN });
    for (const key of ["evidence", "evidenceTitle", "case", "caseNote", "channel", "when", "warnings", "warningNote", "rule", "appealNote", "liftedNote", "moderatorName", "moderator", "moderatorId", "duration", "expires"]) {
      assert.ok(key in values, key);
    }
    const embed = fill(DM_MESSAGE, values).embeds[0]!;
    assert.equal(embed.description, "You were kicked in Test Server.");
    assert.equal(embed.footerText, "Case #4");
    assert.deepEqual(embed.fields, []);
  });

  test("a warning: the case, the messages and the count when it is not the first", () => {
    const first = dmValues(settings(), { action: "warn", reason: "Spam", expiresAt: null }, { caseNumber: 1, warnings: 1, evidence: many(1), createdAt: WHEN });
    assert.equal(first.warningNote, "");
    assert.equal(first.warnings, 1);
    const third = dmValues(settings(), { action: "warn", reason: "Spam", expiresAt: null }, { caseNumber: 9, warnings: 3, evidence: many(2), createdAt: WHEN });
    const embed = fill(DM_MESSAGE, third).embeds[0]!;
    assert.equal(embed.description, "You were warned in Test Server. Reason: Spam\nThis is warning 3.");
    assert.equal(embed.footerText, "Case #9");
    assert.equal(embed.timestamp, WHEN.toISOString());
    assert.deepEqual(embed.fields.map((field) => field.name), ["Messages"]);
    assert.equal(third.channel, "#general");
    assert.equal(third.when, `<t:${SECONDS}:f>`);
  });

  test("a timeout and a temporary ban say how long and when it ends", () => {
    const expiresAt = new Date(WHEN.getTime() + 3 * 86_400_000);
    for (const action of ["timeout", "ban"]) {
      const values = dmValues(settings(), { action, reason: null, expiresAt, durationMs: 3 * 86_400_000 }, { caseNumber: 2, createdAt: WHEN });
      assert.equal(values.duration, "3 days");
      assert.match(String(values.expires), /<t:\d+:f> \(<t:\d+:R>\)/);
      const embed = fill(DM_MESSAGE, values).embeds[0]!;
      assert.match(embed.description, /This expires <t:\d+:R>\./);
      assert.deepEqual(embed.fields.map((field) => [field.name, field.value]), [["Length", "3 days"]]);
    }
  });

  test("a ban tells them how to appeal only while appeals are on", () => {
    const off = dmValues(settings(), { action: "ban", reason: null, expiresAt: null }, { caseNumber: 2 });
    assert.equal(off.appealNote, "");
    const on = dmValues(settings({ appeals: { enabled: true } }), { action: "ban", reason: null, expiresAt: null }, { caseNumber: 2 });
    assert.equal(on.appealNote, "\nYou can appeal this ban with the button below.");
    assert.equal(dmValues(settings({ appeals: { enabled: true } }), { action: "kick", reason: null, expiresAt: null }).appealNote, "");
  });

  test("an unban and a cleared timeout say the restriction was lifted", () => {
    for (const action of ["unban", "timeout-clear"]) {
      const embed = fill(DM_MESSAGE, dmValues(settings(), { action, reason: null, expiresAt: null }, { caseNumber: 3 })).embeds[0]!;
      assert.match(embed.description, /Your restriction in this server was lifted\.$/);
    }
    assert.equal(dmValues(settings(), { action: "warn", reason: null, expiresAt: null }).liftedNote, "");
  });

  test("an escalation names its rule and no moderator", () => {
    const values = dmValues(settings({ dmShowModerator: true }), { action: "timeout", reason: "Automatic", expiresAt: null }, { caseNumber: 5, rule: "3 warnings" });
    assert.equal(values.rule, "3 warnings");
    assert.equal(values.moderatorName, "");
  });

  test("the moderator's name is shown only when the server asks for it", () => {
    const context = { moderatorDisplayName: "Ada" };
    assert.equal(dmValues(settings(), { action: "warn", reason: null, expiresAt: null, moderatorId: "2" }, context).moderatorName, "");
    const shown = dmValues(settings({ dmShowModerator: true }), { action: "warn", reason: null, expiresAt: null, moderatorId: "2" }, context);
    assert.equal(shown.moderatorName, "Ada");
    assert.deepEqual(fill(DM_MESSAGE, shown).embeds[0]!.fields.map((field) => [field.name, field.value]), [["Moderator", "Ada"]]);
  });

  test("the messages can be switched off for the whole server", () => {
    const off = dmValues(settings({ dmIncludeMessages: false }), { action: "ban", reason: null, expiresAt: null }, { evidence: many(3) });
    assert.equal(off.evidence, "");
    assert.equal(off.evidenceTitle, "");
    assert.equal(off.channel, "");
    assert.deepEqual(fill(DM_MESSAGE, off).embeds[0]!.fields, []);
  });

  test("the stock message stays inside Discord's limits with twelve long messages", () => {
    const values = dmValues(
      settings({ dmShowModerator: true, appeals: { enabled: true } }),
      { action: "ban", reason: "r".repeat(500), expiresAt: new Date(WHEN.getTime() + 86_400_000), durationMs: 86_400_000, moderatorId: "2" },
      { caseNumber: 12, warnings: 9, evidence: many(12, { content: "z".repeat(1500) }), moderatorDisplayName: "Ada" },
    );
    const embed = fill(DM_MESSAGE, values).embeds[0]!;
    assert.ok(embedLength(embed) < 6000, String(embedLength(embed)));
    assert.ok(embed.fields.every((field) => field.value.length <= 1024));
  });
});

describe("wording saved before the messages existed", () => {
  const expiresAt = new Date(WHEN.getTime() + 600_000);

  test("keeps working and does not grow the new content", () => {
    const stored = settings({ dmMessage: { content: "Hi, {server}: {actionTitle}. {reason} ({moderator})" } });
    const values = dmValues(stored, { action: "timeout", reason: "Spam", expiresAt, durationMs: 600_000, moderatorId: "2" }, { caseNumber: 8, evidence: many(2) });
    const body = fill(stored.dmMessage, values);
    assert.equal(body.content, "Hi, Test Server: Timed out. Spam (<@2>)");
    assert.deepEqual(body.embeds, []);
  });

  test("shows the messages once {evidence} is added to it", () => {
    const stored = settings({ dmMessage: { content: "Heads up.\n{evidence}" } });
    const values = dmValues(stored, { action: "warn", reason: null, expiresAt: null }, { evidence: many(1) });
    assert.match(fill(stored.dmMessage, values).content, /message number 1/);
  });

  test("a stored message that still names {moderator} keeps showing it whatever Show who took the action says", () => {
    const stored = settings({ dmMessage: { content: "By {moderator}" } });
    const values = dmValues(stored, { action: "warn", reason: null, expiresAt: null, moderatorId: "2" });
    assert.equal(fill(stored.dmMessage, values).content, "By <@2>");
  });
});

describe("the settings", () => {
  test("messages are included by default and the moderator is hidden", () => {
    const stock = settings();
    assert.equal(stock.dmIncludeMessages, true);
    assert.equal(stock.dmShowModerator, false);
  });

  test("servers that never changed the message get the new default", () => {
    assert.deepEqual(settings().dmMessage, DM_MESSAGE);
    assert.deepEqual(DM_MESSAGE.embeds[0]?.fields.map((field) => field.value), ["{duration}", "{moderatorName}", "{evidence}"]);
  });
});
