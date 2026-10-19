import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, applyVariablesToMessage, parseMessage, type MessageBody } from "@tier0/core";
import moderation from "../dist/index.js";
import { noticeValues } from "../dist/modlog.js";
import { dmValues } from "../dist/dm.js";
import { formatModLogEntry } from "./legacy-view.ts";
import { CASE_REPLY, DM_MESSAGE, HISTORY_REPLY, MODLOG_MESSAGE, PURGE_REPLY } from "../dist/messages.js";

const TARGET = "111111111111111111";
const MODERATOR = "222222222222222222";
const SHARED = { server: "Test Server" };

const registry = new ModuleRegistry();
registry.register(moderation);

function settings(stored: unknown) {
  const resolved = registry.resolveSettings("moderation", stored);
  assert.ok(resolved.ok, "settings should resolve");
  return resolved.value as { dmMessage: MessageBody; modLogMessage: MessageBody };
}

function fill(body: MessageBody, values: Record<string, string | number>): MessageBody {
  const strings = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
  const filled = applyVariablesToMessage(body, { ...SHARED, ...strings });
  const checked = parseMessage(filled);
  assert.ok(checked.ok, "a filled message must still be sendable");
  return checked.value;
}

describe("the direct message", () => {
  const expiresAt = new Date("2030-01-01T00:00:00.000Z");
  const seconds = Math.floor(expiresAt.getTime() / 1000);
  const dm = (notice: Parameters<typeof noticeValues>[0]) => fill(settings({}).dmMessage, dmValues(settings({}) as never, notice)).embeds[0]?.description;

  test("reads as it always has until the owner writes another", () => {
    assert.equal(dm({ action: "warn", reason: null, expiresAt: null }), "You were warned in Test Server.");
    assert.equal(dm({ action: "kick", reason: "Broke rule 4", expiresAt: null }), "You were kicked in Test Server. Reason: Broke rule 4");
    assert.equal(dm({ action: "timeout", reason: null, expiresAt }), `You were timed out in Test Server. This expires <t:${seconds}:R>.`);
    assert.equal(
      dm({ action: "ban", reason: "Repeated spam", expiresAt }),
      `You were banned in Test Server. Reason: Repeated spam This expires <t:${seconds}:R>.`,
    );
    assert.equal(dm({ action: "timeout-clear", reason: null, expiresAt: null }), "You were timeout cleared in Test Server.\nYour restriction in this server was lifted.");
    assert.equal(dm({ action: "unban", reason: null, expiresAt: null }), "You were unbanned in Test Server.\nYour restriction in this server was lifted.");
  });

  test("starts as a warning-coloured embed with nothing above it", () => {
    assert.deepEqual(settings({}).dmMessage, DM_MESSAGE);
    assert.equal(DM_MESSAGE.content, "");
    assert.equal(DM_MESSAGE.embeds.length, 1);
    assert.equal(DM_MESSAGE.embeds[0]?.color, REPLY_COLOR.warning);
  });

  test("uses the message the owner wrote, with the moderator only if they ask for it", () => {
    const own = settings({ dmMessage: { content: "{server}: {actionTitle} for {duration}. {reason} / {moderator}" } }).dmMessage;
    const text = fill(own, noticeValues({ action: "timeout", reason: "Spam", expiresAt, durationMs: 600_000, moderatorId: MODERATOR })).content;
    assert.equal(text, `Test Server: Timed out for 10 minutes. Spam / <@${MODERATOR}>`);
    assert.equal(dm({ action: "warn", reason: null, expiresAt: null, moderatorId: MODERATOR }).includes(MODERATOR), false);
  });

  test("reads a plain string saved as the message", () => {
    assert.equal(settings({ dmMessage: "Heads up, {server}" }).dmMessage.content, "Heads up, {server}");
  });

  test("keeps only what a direct message can carry", () => {
    const own = settings({
      dmMessage: {
        content: "Hi",
        reactions: ["👍"],
        buttons: [
          { label: "Appeal", style: "link", url: "https://example.com/appeal" },
          { label: "Okay", style: "primary", action: { type: "none" } },
        ],
      },
    }).dmMessage;
    assert.deepEqual(own.reactions, []);
    assert.deepEqual(
      own.buttons.map((b) => b.label),
      ["Appeal", "Okay"],
    );
  });
});

describe("the mod log post", () => {
  const cases = [
    { caseNumber: 7, action: "warn", targetId: TARGET, moderatorId: MODERATOR, reason: "Spamming", expiresAt: null },
    { caseNumber: 8, action: "kick", targetId: TARGET, moderatorId: MODERATOR, reason: null, expiresAt: null },
    { caseNumber: 9, action: "timeout", targetId: TARGET, moderatorId: MODERATOR, reason: null, expiresAt: new Date("2030-01-01T00:00:00.000Z") },
    { caseNumber: 10, action: "timeout-clear", targetId: TARGET, moderatorId: MODERATOR, reason: "Appealed", expiresAt: null },
  ];

  for (const entry of cases) {
    test(`is the embed the module always posted for case ${entry.caseNumber}`, () => {
      const message = fill(settings({}).modLogMessage, noticeValues(entry));
      const view = formatModLogEntry(entry);
      const embed = message.embeds[0];
      assert.equal(message.embeds.length, 1);
      assert.equal(message.content, "");
      assert.equal(embed?.title, view.title);
      assert.deepEqual(
        embed?.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline })),
        view.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline === true })),
      );
      assert.equal(embed?.color, "");
      assert.notEqual(Date.parse(embed?.timestamp ?? ""), Number.NaN);
    });
  }

  test("starts from the stock embed", () => {
    assert.deepEqual(settings({}).modLogMessage, MODLOG_MESSAGE);
  });

  test("uses the embed the owner wrote", () => {
    const own = settings({
      modLogMessage: { content: "", embeds: [{ title: "{actionTitle}", color: "#ff0000", description: "{member} by {moderator}. {reason}" }] },
    }).modLogMessage;
    const filled = fill(own, noticeValues(cases[0]!));
    assert.equal(filled.embeds[0]?.title, "Warned");
    assert.equal(filled.embeds[0]?.color, "#ff0000");
    assert.equal(filled.embeds[0]?.description, `<@${TARGET}> by <@${MODERATOR}>. Spamming`);
  });
});

describe("the link to the case in the dashboard", () => {
  // A fixed time, because the post is stamped with the current one otherwise and two fills a millisecond apart would differ.
  const entry = { caseNumber: 7, action: "warn", targetId: TARGET, moderatorId: MODERATOR, reason: "Spamming", expiresAt: null, createdAt: new Date("2029-12-30T00:00:00.000Z") };
  const BASE = "https://bot.example.com";
  const GUILD = "333333333333333333";
  const withLinks = (dashboardBase: string) => noticeValues({ ...entry, links: { guildId: GUILD, dashboardBase } });

  test("opens the member's record on that case", () => {
    const values = withLinks(BASE);
    assert.equal(values.caseUrl, `${BASE}/guilds/${GUILD}/mod/members/${TARGET}?case=7`);
    assert.equal(values.memberUrl, `${BASE}/guilds/${GUILD}/mod/members/${TARGET}`);
  });

  test("is empty, not missing, when the address is not known", () => {
    const values = withLinks("");
    assert.equal(values.caseUrl, "");
    assert.equal(values.memberUrl, "");
  });

  test("is left out of the direct message, which is not given an address", () => {
    const values = noticeValues(entry);
    assert.equal("caseUrl" in values, false);
    assert.equal("memberUrl" in values, false);
  });

  test("the stock post and the case reply carry a View in dashboard button that needs it", () => {
    for (const body of [MODLOG_MESSAGE, CASE_REPLY.starting]) {
      assert.deepEqual(body.buttons.map((b) => [b.label, b.style, b.url]), [["View in dashboard", "link", "{caseUrl}"]]);
    }
    const offered = new Set(CASE_REPLY.placeholders.map((p) => p.name));
    assert.ok(offered.has("caseUrl") && offered.has("memberUrl"));
  });

  test("the stock post has the button once the address is known, and no button without it", () => {
    const stock = settings({}).modLogMessage;
    const known = fill(stock, withLinks(BASE));
    assert.deepEqual(known.buttons.map((b) => b.url), [`${BASE}/guilds/${GUILD}/mod/members/${TARGET}?case=7`]);
    const unknown = fill(stock, withLinks(""));
    assert.deepEqual(unknown.buttons, []);
    assert.deepEqual(unknown.embeds, known.embeds);
  });

  test("is set in the settings as an origin and refused when it is not a web address", () => {
    assert.equal((registry.resolveSettings("moderation", { dashboardUrl: "https://bot.example.com/some/path/" }) as { value: { dashboardUrl: string } }).value.dashboardUrl, BASE);
    assert.equal(registry.resolveSettings("moderation", { dashboardUrl: "javascript:alert(1)" }).ok, false);
    assert.equal(registry.resolveSettings("moderation", { dashboardUrl: "bot.example.com" }).ok, false);
    const blank = registry.resolveSettings("moderation", {});
    assert.ok(blank.ok);
    assert.equal((blank.value as { dashboardUrl?: string }).dashboardUrl, undefined);
  });
});

describe("the case reply", () => {
  const entry = {
    caseNumber: 4,
    action: "ban",
    targetId: TARGET,
    moderatorId: MODERATOR,
    reason: "Raiding",
    expiresAt: null,
    createdAt: new Date("2029-12-30T00:00:00.000Z"),
  };

  test("is the embed /case has always shown", () => {
    const filled = fill(CASE_REPLY.starting, { ...noticeValues(entry), reversedNote: "" });
    const view = formatModLogEntry(entry);
    assert.equal(filled.embeds[0]?.title, view.title);
    assert.deepEqual(
      filled.embeds[0]?.fields.map((f) => [f.name, f.value]),
      view.fields.map((f) => [f.name, f.value]),
    );
    assert.equal(filled.embeds[0]?.footerText, "");
    assert.equal(filled.embeds[0]?.timestamp, "2029-12-30T00:00:00.000Z");
  });

  test("carries the footer for a case that has been reversed", () => {
    const filled = fill(CASE_REPLY.starting, { ...noticeValues(entry), reversedNote: "This action has since been reversed." });
    assert.equal(filled.embeds[0]?.footerText, "This action has since been reversed.");
  });

  test("offers every variable the starting message uses", () => {
    const offered = new Set(CASE_REPLY.placeholders.map((p) => p.name));
    const used = [...JSON.stringify(CASE_REPLY.starting).matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    for (const name of used) assert.ok(offered.has(name), `${name} is used but not offered`);
  });
});

describe("the history reply", () => {
  test("is the embed /history has always shown", () => {
    const list = "**#2** Warned - Spam - <t:1:d>\n**#1** Banned (reversed) - No reason given - <t:1:d>";
    const filled = fill(HISTORY_REPLY.starting, { user: "spamlord_42", count: 2, list });
    assert.equal(filled.embeds[0]?.title, "Moderation history for spamlord_42");
    assert.equal(filled.embeds[0]?.description, list);
  });
});

describe("the purge reply", () => {
  test("says what it always has", () => {
    const one = fill(PURGE_REPLY.starting, { count: 1, messages: "1 message", skippedNote: "" });
    assert.equal(one.embeds[0]?.description, "Deleted 1 message.");
    assert.equal(one.embeds[0]?.color, REPLY_COLOR.success);
    assert.equal(one.content, "");
    const some = fill(PURGE_REPLY.starting, {
      count: 18,
      messages: "18 messages",
      skippedNote: " 2 messages were left because they are older than 14 days.",
    });
    assert.equal(some.embeds[0]?.description, "Deleted 18 messages. 2 messages were left because they are older than 14 days.");
  });
});

describe("the moderation commands", () => {
  test("offer a reply to rewrite for each command that confirms something", () => {
    const summary = registry.describe().find((entry) => entry.id === "moderation");
    const withReply = summary?.commands
      .filter((c) => c.response !== null)
      .map((c) => c.name)
      .sort();
    assert.deepEqual(withReply, ["Member history", "ban", "case", "history", "kick", "purge", "timeout", "unban", "warn"]);
  });
});

type Described = { fields: Record<string, { variables?: { name: string }[]; help?: string }> };
const described = (): Described => moderation.settings.describe() as unknown as Described;

describe("the reason a member is sent", () => {
  test("the default message leaves the moderator out, though they stay available as variables", () => {
    const text = JSON.stringify(DM_MESSAGE);
    assert.ok(!text.includes("{moderator}") && !text.includes("{moderatorId}"));
    const description = described();
    const names = (description.fields.dmMessage?.variables ?? []).map((v) => v.name);
    assert.ok(names.includes("moderator") && names.includes("moderatorId"));
  });

  test("the settings say the reason reaches the member as written", () => {
    const description = described();
    assert.match(description.fields.dmOnAction?.help ?? "", /exactly as written/);
    assert.match(description.fields.dmMessage?.help ?? "", /as written/);
  });
});
