import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, applyVariablesToMessage, colorToInt, parseMessage, type MessageBody } from "@tier0/core";
import type { TripFacts } from "../dist/messages.js";
import automod from "../dist/index.js";
import { LOG_MESSAGES, NOTICE_MESSAGE, breakMentions, describeLength, describeOutcome, effectiveActions, loggedAs, logValues, matchText, tripValues } from "../dist/messages.js";

const registry = new ModuleRegistry();
registry.register(automod);

interface Stored {
  noticeMessage: MessageBody;
  logMessages: Record<"delete" | "warn" | "timeout", MessageBody>;
}

function settings(stored: unknown): Stored {
  const resolved = registry.resolveSettings("automod", stored);
  assert.ok(resolved.ok, "settings should resolve");
  return resolved.value as Stored;
}

function fill(body: MessageBody, values: Record<string, string>): MessageBody {
  const checked = parseMessage(applyVariablesToMessage(body, values));
  assert.ok(checked.ok, "a filled message must still be sendable");
  return checked.value;
}

// The three presets a rule used to have. By default everything the rule is set to do worked.
type Preset = "delete" | "warn" | "timeout";
const PRESET: Record<Preset, TripFacts["actions"]> = { delete: ["delete"], warn: ["warn"], timeout: ["delete", "timeout"] };
const trip = (action: Preset, reason?: string, timeoutMs?: number, more: Partial<TripFacts> = {}) =>
  tripValues({
    userId: "111111111111111111", rule: "invites", actions: PRESET[action], reason, timeoutMs,
    deleted: action !== "warn", warned: action === "warn", timedOut: action === "timeout", ...more,
  });
const tripLog = (action: Preset, reason?: string, more: Partial<TripFacts> = {}) =>
  logValues({
    userId: "111111111111111111", rule: "invites", actions: PRESET[action], reason, timeoutMs: action === "timeout" ? 600_000 : undefined,
    deleted: action !== "warn", warned: action === "warn", timedOut: action === "timeout", ...more,
  });

describe("the notice in the channel", () => {
  test("says what it always has, for each action, with and without a reason", () => {
    const notice = settings({}).noticeMessage;
    assert.equal(fill(notice, trip("delete", "Posted a Discord invite link")).content,
      "<@111111111111111111>, your message was removed (invites: Posted a Discord invite link).");
    assert.equal(fill(notice, trip("timeout", "Spam", 600_000)).content,
      "<@111111111111111111>, your message was removed and you were timed out (invites: Spam).");
    assert.equal(fill(notice, trip("warn")).content, "<@111111111111111111>, that message tripped automod (invites).");
  });

  test("says only what was done when a step failed", () => {
    const notice = settings({}).noticeMessage;
    assert.equal(fill(notice, trip("timeout", "Spam", 600_000, { timedOut: false })).content,
      "<@111111111111111111>, your message was removed (invites: Spam).");
    assert.equal(fill(notice, trip("timeout", "Spam", 600_000, { deleted: false, timedOut: false })).content,
      "<@111111111111111111>, that message tripped automod (invites: Spam).");
    assert.equal(fill(notice, trip("delete", "Spam", undefined, { deleted: false })).content,
      "<@111111111111111111>, that message tripped automod (invites: Spam).");
    assert.equal(trip("timeout", "Spam", 600_000, { timedOut: false }).duration, "");
  });

  test("never carries what matched, even if the owner asks for it", () => {
    const values = trip("delete", "Posted a Discord invite link", undefined, { detail: "secretcode" });
    assert.ok(!Object.values(values).some((v) => v.includes("secretcode")));
    const own = settings({ noticeMessage: { content: "{user} {match} {problems}" } }).noticeMessage;
    assert.equal(fill(own, values).content, "<@111111111111111111> {match} {problems}");
  });

  test("starts from a message with only text", () => {
    assert.deepEqual(settings({}).noticeMessage, NOTICE_MESSAGE);
  });

  test("uses the message the owner wrote", () => {
    const own = settings({ noticeMessage: { content: "Careful {user}: {rule} ({action}) for {duration}" } }).noticeMessage;
    assert.equal(fill(own, trip("timeout", "Spam", 600_000)).content, "Careful <@111111111111111111>: invites (delete and timeout) for 10 minutes");
  });

  test("reads a plain string saved as the message", () => {
    assert.equal(settings({ noticeMessage: "No links, {user}" }).noticeMessage.content, "No links, {user}");
  });
});

describe("the log posts", () => {
  const colours = { warn: 0xf5a623, delete: 0xed4245, timeout: 0x992d22 } as const;

  for (const action of ["warn", "delete", "timeout"] as const) {
    test(`are the embed automod always posted when a rule ${action}s`, () => {
      const embed = fill(settings({}).logMessages[action], tripLog(action, "Spam")).embeds[0];
      assert.equal(colorToInt(embed?.color ?? ""), colours[action]);
      assert.equal(embed?.description, "<@111111111111111111> tripped **invites**");
      assert.deepEqual(embed?.fields.map((f) => [f.name, f.value, f.inline]), [
        ["Action", action === "timeout" ? "delete and timeout" : action, true],
        ["Reason", "Spam", true],
      ]);
      assert.equal(embed?.timestamp, "now");
    });
  }

  test("add what matched, in a code span, only when there is something", () => {
    const embed = fill(settings({}).logMessages.delete, tripLog("delete", "Posted a link to a site that isn't allowed", { detail: "sketchy.example" })).embeds[0];
    assert.deepEqual(embed?.fields.map((f) => [f.name, f.value]), [
      ["Action", "delete"],
      ["Reason", "Posted a link to a site that isn't allowed"],
      ["Matched", "`sketchy.example`"],
    ]);
  });

  test("say what could not be done, only when something could not", () => {
    const embed = fill(settings({}).logMessages.timeout, tripLog("timeout", "Spam", { timedOut: false, problems: ["Could not time out: missing permission"] })).embeds[0];
    assert.deepEqual(embed?.fields.at(-1) && [embed.fields.at(-1)?.name, embed.fields.at(-1)?.value], ["Not carried out", "Could not time out: missing permission"]);
  });

  test("a match cannot break out of its code span or carry a mention", () => {
    const values = tripLog("delete", "x", { detail: "a`<@123456789012345678> @everyone\nb" });
    assert.equal(values.match.startsWith("`") && values.match.endsWith("`"), true);
    assert.equal(values.match.slice(1, -1).includes("`"), false);
    assert.equal(values.match.includes("\n"), false);
    assert.equal(values.match.includes("<@"), false);
    assert.equal(values.match.includes("@everyone"), false);
  });

  test("show a dash when there is no reason", () => {
    const embed = fill(settings({}).logMessages.warn, tripLog("warn")).embeds[0];
    assert.equal(embed?.fields[1]?.value, "-");
  });

  test("start from the stock embeds", () => {
    assert.deepEqual(settings({}).logMessages, LOG_MESSAGES);
  });

  test("use the embed the owner wrote for one action and leave the others alone", () => {
    const stored = { logMessages: { delete: { content: "", embeds: [{ description: "{user} broke {rule}", color: "#00ff00" }] } } };
    const resolved = settings(stored);
    assert.equal(fill(resolved.logMessages.delete, tripLog("delete")).embeds[0]?.description, "<@111111111111111111> broke invites");
    assert.deepEqual(resolved.logMessages.timeout, LOG_MESSAGES.timeout);
  });
});

describe("what matched, for staff", () => {
  test("lists each banned word from the list on its own, in code spans", () => {
    const values = tripLog("delete", "Used a banned word or phrase", { rule: "bannedWords", detail: "badword, other words", matches: ["badword", "other words"] });
    assert.equal(values.match, "`badword`, `other words`");
  });

  test("keeps a long list short enough for an embed field", () => {
    const matches = Array.from({ length: 14 }, (_, i) => `word${i}`);
    const text = matchText({ matches });
    assert.ok(text.endsWith("and 4 more"));
    assert.ok(text.length < 1024);
    assert.ok(matchText({ matches: ["x".repeat(500)] }).length < 100);
  });

  test("a banned word cannot break out of its code span or carry a mention", () => {
    const text = matchText({ matches: ["a`<@123456789012345678>", "@everyone"] });
    assert.equal(text.includes("<@"), false);
    assert.equal(text.includes("@everyone"), false);
  });

  test("never reaches the notice in the channel", () => {
    const values = trip("delete", "Used a banned word or phrase", undefined, { detail: "badword", matches: ["badword"] });
    assert.ok(!Object.values(values).some((v) => v.includes("badword")));
  });
});

describe("the link to the case in the dashboard", () => {
  const BASE = "https://bot.example.com";
  const more = (dashboardBase: string): Partial<TripFacts> => ({ caseNumber: 31, guildId: "222222222222222222", dashboardBase });

  for (const action of ["warn", "delete", "timeout"] as const) {
    test(`the ${action} post has the View in dashboard button once the address is known, and none without it`, () => {
      const known = fill(settings({}).logMessages[action], tripLog(action, "Spam", more(BASE)));
      assert.deepEqual(known.buttons.map((b) => [b.label, b.url]), [["View in dashboard", `${BASE}/guilds/222222222222222222/mod/members/111111111111111111?case=31`]]);
      const unknown = fill(settings({}).logMessages[action], tripLog(action, "Spam", more("")));
      assert.deepEqual(unknown.buttons, []);
      assert.deepEqual(unknown.embeds, known.embeds);
    });
  }

  test("offers the case number and both links as variables", () => {
    const values = tripLog("delete", "Spam", more(BASE));
    assert.equal(values.case, "31");
    assert.equal(values.memberUrl, `${BASE}/guilds/222222222222222222/mod/members/111111111111111111`);
    const offered = new Set(
      (automod.settings.describe() as unknown as { fields: { logMessages: { fields: { delete: { variables: { name: string }[] } } } } }).fields.logMessages.fields.delete.variables.map((v) => v.name),
    );
    for (const name of ["case", "caseUrl", "memberUrl"]) assert.ok(offered.has(name), name);
  });

  test("is empty when the case could not be recorded", () => {
    const values = tripLog("delete", "Spam", { guildId: "222222222222222222", dashboardBase: BASE });
    assert.equal(values.caseUrl, "");
    assert.equal(values.case, "");
  });

  test("the notice in the channel never carries it", () => {
    const values = trip("delete", "Spam", undefined, more(BASE));
    assert.ok(!Object.values(values).some((v) => v.includes(BASE)));
  });
});

describe("breakMentions", () => {
  test("stops user, role, channel and broadcast mentions", () => {
    const out = breakMentions("<@1> <@&2> <#3> @everyone @HERE");
    for (const bad of ["<@", "<#", "@everyone", "@here"]) assert.equal(out.toLowerCase().includes(bad), false, bad);
    assert.equal(out.replaceAll("​", ""), "<@1> <@&2> <#3> @everyone @HERE");
  });

  test("leaves ordinary text alone", () => {
    assert.equal(breakMentions("Posted a Discord invite link"), "Posted a Discord invite link");
  });

  test("is applied to the reason a notice repeats", () => {
    const values = trip("delete", "hello <@&123456789012345678>");
    assert.equal(values.reason.includes("<@"), false);
    assert.equal(values.reasonNote.includes("<@"), false);
  });
});

describe("describeOutcome", () => {
  test("follows what was done", () => {
    assert.equal(describeOutcome({ deleted: true, timedOut: true }), "your message was removed and you were timed out");
    assert.equal(describeOutcome({ deleted: false, timedOut: true }), "you were timed out");
    assert.equal(describeOutcome({ deleted: false, timedOut: false }), "that message tripped automod");
  });

  test("reads naturally for every combination", () => {
    const say = (deleted: boolean, warned: boolean, timedOut: boolean) => describeOutcome({ deleted, warned, timedOut });
    assert.equal(say(true, false, false), "your message was removed");
    assert.equal(say(false, false, true), "you were timed out");
    assert.equal(say(true, true, false), "your message was removed and you were warned");
    assert.equal(say(true, false, true), "your message was removed and you were timed out");
    assert.equal(say(false, true, true), "you were warned and timed out");
    assert.equal(say(true, true, true), "your message was removed, and you were warned and timed out");
  });

  test("a warning on its own, or nothing, keeps the line it always had", () => {
    assert.equal(describeOutcome({ deleted: false, warned: true, timedOut: false }), "that message tripped automod");
    assert.equal(describeOutcome({ deleted: false, warned: false, timedOut: false }), "that message tripped automod");
  });
});

describe("the actions in the notice and the log", () => {
  const base = { userId: "111111111111111111", rule: "invites", reason: "Spam", timeoutMs: 600_000 } as const;
  const facts = (actions: TripFacts["actions"], done: { deleted: boolean; warned: boolean; timedOut: boolean }): TripFacts => ({ ...base, actions, ...done });

  test("{action} lists what was done in words", () => {
    assert.equal(tripValues(facts(["delete"], { deleted: true, warned: false, timedOut: false })).action, "delete");
    assert.equal(tripValues(facts(["delete", "warn"], { deleted: true, warned: true, timedOut: false })).action, "delete and warn");
    assert.equal(tripValues(facts(["delete", "warn", "timeout"], { deleted: true, warned: true, timedOut: true })).action, "delete, warn and timeout");
  });

  test("{action} drops a step that failed, and falls back to what was asked when nothing worked", () => {
    assert.equal(tripValues(facts(["delete", "timeout"], { deleted: true, warned: false, timedOut: false })).action, "delete");
    assert.equal(tripValues(facts(["delete", "timeout"], { deleted: false, warned: false, timedOut: false })).action, "delete and timeout");
  });

  test("the notice names the duration only when the member was timed out", () => {
    assert.equal(tripValues(facts(["warn", "timeout"], { deleted: false, warned: true, timedOut: true })).duration, "10 minutes");
    assert.equal(tripValues(facts(["warn", "timeout"], { deleted: false, warned: true, timedOut: false })).duration, "");
  });

  test("the log post follows the strongest thing done: timeout, then warn, then delete", () => {
    assert.equal(loggedAs(facts(["delete"], { deleted: true, warned: false, timedOut: false })), "delete");
    assert.equal(loggedAs(facts(["warn"], { deleted: false, warned: true, timedOut: false })), "warn");
    assert.equal(loggedAs(facts(["delete", "warn"], { deleted: true, warned: true, timedOut: false })), "warn");
    assert.equal(loggedAs(facts(["delete", "timeout"], { deleted: true, warned: false, timedOut: true })), "timeout");
    assert.equal(loggedAs(facts(["delete", "warn", "timeout"], { deleted: true, warned: true, timedOut: true })), "timeout");
  });

  test("a failed timeout uses the post for what did happen; a rule that managed nothing keeps its own", () => {
    assert.equal(loggedAs(facts(["delete", "timeout"], { deleted: true, warned: false, timedOut: false })), "delete");
    assert.equal(loggedAs(facts(["delete"], { deleted: false, warned: false, timedOut: false })), "delete");
    assert.equal(loggedAs(facts(["delete", "timeout"], { deleted: false, warned: false, timedOut: false })), "timeout");
  });

  test("effectiveActions keeps the order delete, warn, timeout", () => {
    assert.deepEqual(effectiveActions(facts(["timeout", "warn", "delete"], { deleted: true, warned: true, timedOut: true })), ["delete", "warn", "timeout"]);
  });
});

describe("describeLength", () => {
  test("names a timeout the way the settings do", () => {
    assert.equal(describeLength(600_000), "10 minutes");
    assert.equal(describeLength(3_600_000), "1 hour");
  });
});
