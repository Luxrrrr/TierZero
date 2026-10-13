import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { plainReply } from "@tier0/core";
import { settings } from "../dist/settings.js";
import { evaluateMessage, fingerprintOf } from "../dist/evaluator.js";
import { carryOut, noticeLifetimeMs, MIN_NOTICE_MS } from "../dist/handler.js";
import { DM_MESSAGE, NOTICE_MESSAGE, describeOutcome, matchText, ruleName, tripValues } from "../dist/messages.js";
import { DEFAULT_AUTOMOD_WORDING } from "../dist/texts.js";

/** What automod said before any of it could be changed, copied out by hand. */
const LABELS_WERE = {
  outcomes: {
    removedWarnedTimedOut: "your message was removed, and you were warned and timed out",
    removedWarned: "your message was removed and you were warned",
    removedTimedOut: "your message was removed and you were timed out",
    warnedTimedOut: "you were warned and timed out",
    removed: "your message was removed",
    timedOut: "you were timed out",
    warned: "that message tripped automod",
    nothing: "that message tripped automod",
  },
  actionWords: { delete: "delete", warn: "warn", timeout: "timeout", comma: ",", and: "and" },
  fragments: { noReason: "-", reasonNote: ": {reason}", matchesMore: "and {count} more", invalidAddress: "an invalid address" },
  ruleNames: { invites: "invites", links: "links", capitals: "capitals", repeatedText: "repeatedText", mentions: "mentions", bannedWords: "bannedWords", rateLimit: "rateLimit" },
  reasons: {
    invites: "Posted a Discord invite link",
    links: "Posted a link to a site that isn't allowed",
    capitals: "Message was {percent}% capital letters",
    repeatedCharacter: "Message repeats one character {limit} or more times in a row",
    repeatedMessage: "Sent the same message {count} times in a row",
    mentions: "Mentioned {count} users or roles, more than the limit of {limit}",
    bannedWords: "Used a banned word or phrase",
    rateLimit: "Sent {count} messages in {seconds}s, more than the limit of {limit}",
  },
  problems: {
    deleteMissingPermission: "Could not delete the message: missing permission",
    deleteRefused: "Could not delete the message: Discord refused the request",
    timeoutMissingPermission: "Could not time out: missing permission, or the member outranks the bot",
    timeoutRefused: "Could not time out: Discord refused the request",
  },
  audit: { timeoutReason: "Automod: {rule}" },
  time: {
    dayOne: "{n} day",
    dayMany: "{n} days",
    hourOne: "{n} hour",
    hourMany: "{n} hours",
    minuteOne: "{n} minute",
    minuteMany: "{n} minutes",
    secondOne: "{n} second",
    secondMany: "{n} seconds",
  },
};

function parsed(stored: Record<string, unknown> = {}) {
  const result = settings.parse(stored);
  assert.ok(result.ok, "settings should parse");
  return result.value;
}

describe("defaults are what automod has always said", () => {
  test("every label starts as the old word, and none was added or lost", () => {
    assert.deepEqual(parsed().labels, LABELS_WERE);
    assert.deepEqual(DEFAULT_AUTOMOD_WORDING, LABELS_WERE);
  });

  test("the notice is unchanged and the direct message is off", () => {
    const stock = parsed();
    assert.deepEqual(stock.noticeMessage, NOTICE_MESSAGE);
    assert.equal(stock.noticeMessage.content, "{user}, {outcome} ({rule}{reasonNote}).");
    assert.equal(stock.noticeLifetime, 8000);
    assert.equal(stock.dmOnAction, false);
    assert.deepEqual(stock.dmMessage, DM_MESSAGE);
    assert.deepEqual(DM_MESSAGE, plainReply("In {server}, {outcome} ({rule}{reasonNote})."));
  });

  test("a notice saved as plain text before it became a message is still read", () => {
    assert.equal(parsed({ noticeMessage: "Careful, {user}" }).noticeMessage.content, "Careful, {user}");
  });

  test("a label that is too long or names an unknown variable is refused", () => {
    assert.equal(settings.parse({ labels: { audit: { timeoutReason: "x".repeat(513) } } }).ok, false);
    assert.equal(settings.parse({ labels: { reasons: { capitals: "{nope}" } } }).ok, false);
  });

  test("the direct message is shown only once it is on", () => {
    const description = settings.describe() as unknown as { fields: Record<string, { when?: { field: string; equals: boolean } }> };
    assert.deepEqual(description.fields.dmMessage?.when, { field: "dmOnAction", equals: true });
  });
});

describe("what happened, worded for the member", () => {
  const words = { ...DEFAULT_AUTOMOD_WORDING.outcomes };
  const cases: Array<[Parameters<typeof describeOutcome>[0], keyof typeof words]> = [
    [{ deleted: true, warned: true, timedOut: true }, "removedWarnedTimedOut"],
    [{ deleted: true, warned: true, timedOut: false }, "removedWarned"],
    [{ deleted: true, warned: false, timedOut: true }, "removedTimedOut"],
    [{ deleted: false, warned: true, timedOut: true }, "warnedTimedOut"],
    [{ deleted: true, warned: false, timedOut: false }, "removed"],
    [{ deleted: false, warned: false, timedOut: true }, "timedOut"],
    [{ deleted: false, warned: true, timedOut: false }, "warned"],
    [{ deleted: false, warned: false, timedOut: false }, "nothing"],
  ];

  test("each situation has its own phrase, and the stock ones are the old ones", () => {
    for (const [done, key] of cases) assert.equal(describeOutcome(done), LABELS_WERE.outcomes[key], key);
  });

  test("a changed phrase is the one used", () => {
    for (const [done, key] of cases) {
      assert.equal(describeOutcome(done, { ...words, [key]: `custom ${key}` }), `custom ${key}`);
    }
  });
});

describe("values for the notice, the direct message and the log", () => {
  const facts = {
    userId: "111111111111111111",
    rule: "rateLimit",
    actions: ["delete", "warn", "timeout"],
    reason: "Sent 6 messages in 10s, more than the limit of 5",
    timeoutMs: 600_000,
    deleted: true,
    warned: true,
    timedOut: true,
  } as const;

  test("are as they were with nothing changed", () => {
    assert.deepEqual(tripValues({ ...facts, actions: [...facts.actions] }), {
      user: "<@111111111111111111>",
      userId: "111111111111111111",
      rule: "rateLimit",
      ruleKey: "rateLimit",
      action: "delete, warn and timeout",
      reason: "Sent 6 messages in 10s, more than the limit of 5",
      reasonNote: ": Sent 6 messages in 10s, more than the limit of 5",
      outcome: "your message was removed, and you were warned and timed out",
      duration: "10 minutes",
    });
    assert.equal(tripValues({ ...facts, actions: ["delete"], reason: undefined, warned: false, timedOut: false }).reason, "-");
  });

  test("take the owner's rule name, joiner words, dash and units, and keep the rule's key", () => {
    const wording = {
      ...DEFAULT_AUTOMOD_WORDING,
      ruleNames: { ...DEFAULT_AUTOMOD_WORDING.ruleNames, rateLimit: "Message speed" },
      actionWords: { ...DEFAULT_AUTOMOD_WORDING.actionWords, delete: "remove", comma: ";", and: "und" },
      fragments: { ...DEFAULT_AUTOMOD_WORDING.fragments, noReason: "n/a", reasonNote: " ({reason})" },
      time: { ...DEFAULT_AUTOMOD_WORDING.time, minuteMany: "{n} Minuten" },
    };
    const values = tripValues({ ...facts, actions: [...facts.actions] }, wording);
    assert.equal(values.rule, "Message speed");
    assert.equal(values.ruleKey, "rateLimit");
    assert.equal(values.action, "remove; warn und timeout");
    assert.equal(values.duration, "10 Minuten");
    assert.equal(values.reasonNote, " (Sent 6 messages in 10s, more than the limit of 5)");
    assert.equal(tripValues({ ...facts, actions: ["delete"], reason: undefined, warned: false, timedOut: false }, wording).reason, "n/a");
  });

  test("a rule this version does not know keeps its key", () => {
    assert.equal(ruleName("slowmode"), "slowmode");
  });

  test("the list of what matched is cut short in the owner's words", () => {
    const matches = Array.from({ length: 12 }, (_, i) => `word${i}`);
    assert.match(matchText({ matches }), / and 2 more$/);
    assert.match(matchText({ matches }, { ...DEFAULT_AUTOMOD_WORDING, fragments: { ...DEFAULT_AUTOMOD_WORDING.fragments, matchesMore: "plus {count}" } }), / plus 2$/);
  });
});

describe("the reasons the rules give", () => {
  const now = 1_000_000;
  const input = (patch: Record<string, unknown>, content: string, extra: Record<string, unknown> = {}) => ({
    content,
    authorRoles: [],
    authorIsBot: false,
    authorIsModerator: false,
    channelId: "c1",
    now,
    history: [] as { fingerprint: string; timestamp: number }[],
    settings: patch as ReturnType<typeof parsed>,
    ...extra,
  });

  function on(rule: string, patch: Record<string, unknown> = {}, labels: Record<string, unknown> = {}) {
    const base = parsed({ labels });
    return { ...base, [rule]: { ...(base as Record<string, Record<string, unknown>>)[rule], enabled: true, ...patch } };
  }

  const reasonOf = (rule: string, content: string, patch: Record<string, unknown> = {}, labels: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    evaluateMessage(input(on(rule, patch, labels), content, extra) as never).reason;

  const cases: Array<{ rule: string; content: string; patch?: Record<string, unknown>; extra?: Record<string, unknown>; key: string; was: string; custom: string; now: string }> = [
    { rule: "invites", content: "discord.gg/abc", key: "invites", was: "Posted a Discord invite link", custom: "Invite!", now: "Invite!" },
    { rule: "links", content: "see https://example.com", key: "links", was: "Posted a link to a site that isn't allowed", custom: "Link!", now: "Link!" },
    {
      rule: "capitals",
      content: "THIS IS ALL SHOUTING",
      patch: { thresholdPercent: 50 },
      key: "capitals",
      was: "Message was 100% capital letters",
      custom: "{percent} percent loud",
      now: "100 percent loud",
    },
    {
      rule: "repeatedText",
      content: "aaaaaaaaaaaaaaa",
      key: "repeatedCharacter",
      was: "Message repeats one character 10 or more times in a row",
      custom: "Over {limit} in a row",
      now: "Over 10 in a row",
    },
    {
      rule: "repeatedText",
      content: "hello there",
      patch: { repeatMessageCount: 2 },
      extra: { history: [{ fingerprint: fingerprintOf("hello there"), timestamp: now - 1000 }] },
      key: "repeatedMessage",
      was: "Sent the same message 2 times in a row",
      custom: "Again x{count}",
      now: "Again x2",
    },
    {
      rule: "mentions",
      content: "<@111111111111111111> <@222222222222222222> <@333333333333333333>",
      patch: { limit: 2 },
      key: "mentions",
      was: "Mentioned 3 users or roles, more than the limit of 2",
      custom: "{count} pings, {limit} allowed",
      now: "3 pings, 2 allowed",
    },
    { rule: "bannedWords", content: "a badword here", patch: { words: ["badword"] }, key: "bannedWords", was: "Used a banned word or phrase", custom: "Not allowed", now: "Not allowed" },
    {
      rule: "rateLimit",
      content: "hi",
      patch: { limit: 1, window: 10_000 },
      extra: { history: [{ fingerprint: "x", timestamp: now - 1000 }] },
      key: "rateLimit",
      was: "Sent 2 messages in 10s, more than the limit of 1",
      custom: "{count} in {seconds}s (max {limit})",
      now: "2 in 10s (max 1)",
    },
  ];

  for (const c of cases) {
    test(`${c.key}: the same words as ever, then the owner's`, () => {
      assert.equal(reasonOf(c.rule, c.content, c.patch, {}, c.extra), c.was);
      assert.equal(reasonOf(c.rule, c.content, c.patch, { reasons: { [c.key]: c.custom } }, c.extra), c.now);
    });
  }

  test("a link with no readable address is named in the owner's words", () => {
    const verdict = evaluateMessage(input(on("links", {}, { fragments: { invalidAddress: "a broken address" } }), "see https://exa_mple.com/") as never);
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.detail, "a broken address");
    assert.equal(evaluateMessage(input(on("links"), "see https://exa_mple.com/") as never).detail, "an invalid address");
  });
});

describe("what could not be done", () => {
  const steps = (deleteError: unknown, timeoutError: unknown) => ({
    deleteMessage: async () => {
      if (deleteError) throw deleteError;
    },
    timeoutMember: async () => {
      if (timeoutError) throw timeoutError;
    },
  });
  const denied = Object.assign(new Error("Missing Permissions"), { code: 50013 });
  const other = new Error("boom");

  test("each of the four problems reads as it did", async () => {
    assert.deepEqual((await carryOut(["delete"], undefined, steps(denied, null))).problems, ["Could not delete the message: missing permission"]);
    assert.deepEqual((await carryOut(["delete"], undefined, steps(other, null))).problems, ["Could not delete the message: Discord refused the request"]);
    assert.deepEqual((await carryOut(["timeout"], 1000, steps(null, denied))).problems, ["Could not time out: missing permission, or the member outranks the bot"]);
    assert.deepEqual((await carryOut(["timeout"], 1000, steps(null, other))).problems, ["Could not time out: Discord refused the request"]);
  });

  test("and in the owner's words once changed", async () => {
    const problems = { deleteMissingPermission: "a", deleteRefused: "b", timeoutMissingPermission: "c", timeoutRefused: "d" };
    assert.deepEqual((await carryOut(["delete"], undefined, steps(denied, null), problems)).problems, ["a"]);
    assert.deepEqual((await carryOut(["delete"], undefined, steps(other, null), problems)).problems, ["b"]);
    assert.deepEqual((await carryOut(["timeout"], 1000, steps(null, denied), problems)).problems, ["c"]);
    assert.deepEqual((await carryOut(["timeout"], 1000, steps(null, other), problems)).problems, ["d"]);
  });
});

describe("how long the notice stays", () => {
  test("zero keeps it, anything shorter than two seconds is two, the rest is as set", () => {
    assert.equal(noticeLifetimeMs(0), null);
    assert.equal(noticeLifetimeMs(1), MIN_NOTICE_MS);
    assert.equal(noticeLifetimeMs(1999), 2000);
    assert.equal(noticeLifetimeMs(2000), 2000);
    assert.equal(noticeLifetimeMs(8000), 8000);
    assert.equal(noticeLifetimeMs(300_000), 300_000);
  });
});
