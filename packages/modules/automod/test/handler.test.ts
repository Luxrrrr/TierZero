import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { carryOut, draftInfraction, judgeMessage, type IncomingMessage, type Steps } from "../dist/handler.js";
import { AutomodState } from "../dist/state.js";
import { settings } from "../dist/settings.js";

function defaults() {
  const parsed = settings.parse({});
  assert.ok(parsed.ok);
  return parsed.value;
}

function withRule(rule: "invites" | "links" | "repeatedText" | "rateLimit", patch: Record<string, unknown> = {}) {
  const base = defaults() as Record<string, any>;
  return { ...base, [rule]: { ...base[rule], enabled: true, ...patch } } as ReturnType<typeof defaults>;
}

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    guildId: "g1",
    userId: "u1",
    messageId: "m1",
    content: "hello there",
    isEdit: false,
    previousContent: null,
    authorRoles: [],
    authorIsModerator: false,
    channelId: "c1",
    parentChannelId: null,
    now: 1_000_000,
    settings: withRule("invites"),
    ...overrides,
  };
}

describe("judgeMessage", () => {
  test("returns the verdict for a message that trips a rule", () => {
    const verdict = judgeMessage(new AutomodState(), incoming({ content: "discord.gg/abc" }));
    assert.equal(verdict?.rule, "invites");
    assert.equal(verdict?.detail, "abc");
  });

  test("returns null for a clean message", () => {
    assert.equal(judgeMessage(new AutomodState(), incoming()), null);
  });

  test("an update that did not change the text is ignored", () => {
    const state = new AutomodState();
    const content = "discord.gg/abc";
    assert.ok(judgeMessage(state, incoming({ content })));
    assert.equal(judgeMessage(state, incoming({ content, isEdit: true, previousContent: content })), null);
  });

  test("an update with no cached old text is judged only if this text was not judged already", () => {
    const state = new AutomodState();
    const content = "discord.gg/abc";
    assert.ok(judgeMessage(state, incoming({ content })));
    // An embed loading arrives as an update with nothing to compare against.
    assert.equal(judgeMessage(state, incoming({ content, isEdit: true, previousContent: null })), null);
    assert.equal(judgeMessage(state, incoming({ content, isEdit: true, previousContent: null })), null);
  });

  test("an update to text nobody has seen is judged once", () => {
    const state = new AutomodState();
    const edit = incoming({ content: "discord.gg/abc", isEdit: true, previousContent: "innocent" });
    assert.ok(judgeMessage(state, edit));
    assert.equal(judgeMessage(state, edit), null);
  });

  test("an edit into a different offending text is judged again", () => {
    const state = new AutomodState();
    assert.ok(judgeMessage(state, incoming({ content: "discord.gg/abc" })));
    const verdict = judgeMessage(state, incoming({ content: "discord.gg/xyz", isEdit: true, previousContent: "discord.gg/abc" }));
    assert.equal(verdict?.detail, "xyz");
  });

  test("an edit is not recorded as a message", () => {
    const state = new AutomodState();
    const repeat = withRule("repeatedText", { repeatMessageCount: 2, repeatWindow: 60_000 });
    judgeMessage(state, incoming({ content: "buy now", settings: repeat }));
    // Two edits that change the text, then a second real copy: the edits must
    // not have used up the count.
    judgeMessage(state, incoming({ content: "buy now please", isEdit: true, previousContent: "buy now", settings: repeat }));
    judgeMessage(state, incoming({ content: "buy now", isEdit: true, previousContent: "buy now please", settings: repeat }));
    const second = judgeMessage(state, incoming({ messageId: "m2", content: "buy now", now: 1_001_000, settings: repeat }));
    assert.equal(second?.rule, "repeatedText");
    assert.equal(second?.reason, "Sent the same message 2 times in a row", "one earlier copy, not three");
  });

  test("a rate limit counts new messages once each, and never an edit", () => {
    const state = new AutomodState();
    const limit = withRule("rateLimit", { limit: 2, window: 10_000, actions: ["delete"] });
    const send = (id: string, at: number) => judgeMessage(state, incoming({ messageId: id, content: `message ${id}`, now: at, settings: limit }));
    assert.equal(send("a", 1_000_000), null);
    assert.equal(send("b", 1_000_100), null);
    // Edits, and updates with nothing to compare, add nothing to the count.
    for (let i = 0; i < 5; i++) {
      assert.equal(judgeMessage(state, incoming({ messageId: "b", content: "message b", isEdit: true, previousContent: null, now: 1_000_200 + i, settings: limit })), null);
      assert.equal(judgeMessage(state, incoming({ messageId: "b", content: `edited ${i}`, isEdit: true, previousContent: "message b", now: 1_000_300 + i, settings: limit })), null);
    }
    assert.equal(send("c", 1_000_400)?.rule, "rateLimit");
  });

  test("a message in a thread follows its parent channel's exemption", () => {
    const state = new AutomodState();
    const exempt = { ...withRule("invites"), exemptChannels: ["c1"] };
    const content = "discord.gg/abc";
    assert.equal(judgeMessage(state, incoming({ content, channelId: "t9", parentChannelId: "c1", settings: exempt })), null);
    assert.ok(judgeMessage(state, incoming({ messageId: "m2", content, channelId: "t9", parentChannelId: "c2", settings: exempt })));
  });
});

// -- carrying out -----------------------------------------------------------

function steps(overrides: { del?: unknown; timeout?: unknown } = {}) {
  const calls: string[] = [];
  const fail = (what: unknown) => (typeof what === "object" || what === "boom" ? Promise.reject(what === "boom" ? new Error("boom") : what) : Promise.resolve());
  const made: Steps = {
    deleteMessage: () => {
      calls.push("delete");
      return fail(overrides.del);
    },
    timeoutMember: (ms) => {
      calls.push(`timeout:${ms}`);
      return fail(overrides.timeout);
    },
  };
  return { made, calls };
}

describe("carryOut", () => {
  const done = (deleted: boolean, warned: boolean, timedOut: boolean, problems: string[] = []) => ({ deleted, warned, timedOut, problems });

  test("a warn alone touches nothing and leaves the message", async () => {
    const { made, calls } = steps();
    assert.deepEqual(await carryOut(["warn"], undefined, made), done(false, true, false));
    assert.deepEqual(calls, []);
  });

  test("a delete alone only deletes", async () => {
    const { made, calls } = steps();
    assert.deepEqual(await carryOut(["delete"], undefined, made), done(true, false, false));
    assert.deepEqual(calls, ["delete"]);
  });

  test("a timeout alone times out and leaves the message", async () => {
    const { made, calls } = steps();
    assert.deepEqual(await carryOut(["timeout"], 60_000, made), done(false, false, true));
    assert.deepEqual(calls, ["timeout:60000"]);
  });

  test("delete and warn", async () => {
    const { made, calls } = steps();
    assert.deepEqual(await carryOut(["delete", "warn"], undefined, made), done(true, true, false));
    assert.deepEqual(calls, ["delete"]);
  });

  test("delete and timeout", async () => {
    const { made, calls } = steps();
    assert.deepEqual(await carryOut(["delete", "timeout"], 60_000, made), done(true, false, true));
    assert.deepEqual(calls, ["delete", "timeout:60000"]);
  });

  test("warn and timeout leaves the message", async () => {
    const { made, calls } = steps();
    assert.deepEqual(await carryOut(["warn", "timeout"], 60_000, made), done(false, true, true));
    assert.deepEqual(calls, ["timeout:60000"]);
  });

  test("all three", async () => {
    const { made, calls } = steps();
    assert.deepEqual(await carryOut(["delete", "warn", "timeout"], 60_000, made), done(true, true, true));
    assert.deepEqual(calls, ["delete", "timeout:60000"]);
  });

  test("a message that is already gone counts as removed", async () => {
    const { made } = steps({ del: { code: 10008 } });
    assert.deepEqual(await carryOut(["delete"], undefined, made), done(true, false, false));
  });

  test("a refused timeout is not reported as done, and the rest still is", async () => {
    const { made } = steps({ timeout: { code: 50013 } });
    const outcome = await carryOut(["delete", "warn", "timeout"], 60_000, made);
    assert.equal(outcome.deleted, true);
    assert.equal(outcome.warned, true);
    assert.equal(outcome.timedOut, false);
    assert.equal(outcome.problems.length, 1);
    assert.match(outcome.problems[0] ?? "", /^Could not time out: missing permission/);
  });

  test("a refused delete is not reported as done, and the timeout still goes ahead", async () => {
    const { made, calls } = steps({ del: { code: 50013 } });
    const outcome = await carryOut(["delete", "timeout"], 60_000, made);
    assert.equal(outcome.deleted, false);
    assert.equal(outcome.timedOut, true);
    assert.deepEqual(outcome.problems, ["Could not delete the message: missing permission"]);
    assert.deepEqual(calls, ["delete", "timeout:60000"]);
  });

  test("an unexpected failure is a problem, not a crash", async () => {
    const { made } = steps({ del: "boom", timeout: "boom" });
    const outcome = await carryOut(["delete", "timeout"], 60_000, made);
    assert.deepEqual(outcome.problems, [
      "Could not delete the message: Discord refused the request",
      "Could not time out: Discord refused the request",
    ]);
  });

  test("problems never quote anything from the message", async () => {
    const { made } = steps({ del: new Error("discord.gg/secret"), timeout: { code: 50013, message: "<@123456789012345678>" } });
    const outcome = await carryOut(["delete", "timeout"], 60_000, made);
    assert.ok(!outcome.problems.join(" ").includes("secret"));
    assert.ok(!outcome.problems.join(" ").includes("<@"));
  });
});

// -- the record -------------------------------------------------------------

describe("draftInfraction", () => {
  const verdict = { rule: "links" as const, reason: "Posted a link to a site that isn't allowed", detail: "sketchy.example" };
  const NOW = 5_000_000;
  const did = (deleted: boolean, warned: boolean, timedOut: boolean, problems: string[] = []) => ({ deleted, warned, timedOut, problems });

  test("a timeout that was applied is active, with its expiry", () => {
    const draft = draftInfraction(verdict, did(true, false, true), 600_000, NOW);
    assert.equal(draft.action, "automod-timeout");
    assert.equal(draft.active, true);
    assert.equal(draft.expiresAt?.getTime(), NOW + 600_000);
  });

  test("the case is filed under the strongest thing done: timeout, then warn, then delete", () => {
    const label = (deleted: boolean, warned: boolean, timedOut: boolean) => draftInfraction(verdict, did(deleted, warned, timedOut), timedOut ? 600_000 : undefined, NOW).action;
    assert.equal(label(true, false, false), "automod-delete");
    assert.equal(label(false, true, false), "automod-warn");
    assert.equal(label(true, true, false), "automod-warn");
    assert.equal(label(false, false, true), "automod-timeout");
    assert.equal(label(false, true, true), "automod-timeout");
    assert.equal(label(true, true, true), "automod-timeout");
  });

  test("only a timeout makes the case active or gives it an expiry", () => {
    for (const [deleted, warned] of [[true, false], [false, true], [true, true]] as const) {
      const draft = draftInfraction(verdict, did(deleted, warned, false), undefined, NOW);
      assert.equal(draft.active, false);
      assert.equal(draft.expiresAt, null);
    }
  });

  test("a timeout that failed is recorded as the warning or deletion that happened, not active", () => {
    const failed = ["Could not time out: missing permission"];
    const withDelete = draftInfraction(verdict, did(true, false, false, failed), 600_000, NOW);
    assert.equal(withDelete.action, "automod-delete");
    assert.equal(withDelete.active, false);
    assert.equal(withDelete.expiresAt, null);
    assert.match(withDelete.reason, /Could not time out: missing permission/);
    assert.equal(draftInfraction(verdict, did(true, true, false, failed), 600_000, NOW).action, "automod-warn");
    assert.equal(draftInfraction(verdict, did(false, true, false, failed), 600_000, NOW).action, "automod-warn");
  });

  test("a rule that could do nothing is recorded as a warning", () => {
    const draft = draftInfraction(verdict, did(false, false, false), undefined, NOW);
    assert.equal(draft.action, "automod-warn");
  });

  test("keeps the match for staff inside a code span, after the generic reason", () => {
    const draft = draftInfraction(verdict, did(true, false, false), undefined, NOW);
    assert.equal(draft.reason, "links: Posted a link to a site that isn't allowed (matched `sketchy.example`)");
  });

  test("lists each banned word that matched, not the message around it", () => {
    const banned = { rule: "bannedWords" as const, reason: "Used a banned word or phrase", detail: "badword, other words", matches: ["badword", "other words"] };
    const draft = draftInfraction(banned, did(true, false, false), undefined, NOW);
    assert.equal(draft.reason, "bannedWords: Used a banned word or phrase (matched `badword`, `other words`)");
  });

  test("a record without detail is just the rule and reason", () => {
    const draft = draftInfraction({ rule: "capitals", reason: "Message was 90% capital letters" }, did(false, false, false), undefined, NOW);
    assert.equal(draft.reason, "capitals: Message was 90% capital letters");
  });
});
