import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ChallengeBook,
  accountAge,
  matchesAnswer,
  matchesCaptcha,
  normalise,
  pressOutcome,
  questionReady,
  timeoutDelay,
} from "../dist/logic.js";
import type { Round } from "../dist/rounds.js";

describe("typed captcha answers", () => {
  test("match whatever the case or spacing", () => {
    assert.ok(matchesCaptcha("tenalp", "TENALP"));
    assert.ok(matchesCaptcha("12", " 1 2 "));
    assert.ok(!matchesCaptcha("12", "13"));
    assert.ok(!matchesCaptcha("12", ""));
  });
});

describe("answers", () => {
  test("ignore case, accents and extra spaces", () => {
    assert.equal(normalise("  Café   Au  LAIT "), "cafe au lait");
    assert.ok(matchesAnswer("CAFE au lait", ["Café au lait"]));
  });

  test("pass on any accepted answer and fail on the rest", () => {
    assert.ok(matchesAnswer("two", ["2", "two"]));
    assert.ok(!matchesAnswer("three", ["2", "two"]));
  });

  test("never pass on an empty answer, even if an empty one is accepted", () => {
    assert.ok(!matchesAnswer("  ", ["", " "]));
  });

  test("a question needs its text and a real answer", () => {
    assert.ok(questionReady("Rule one?", ["no spam"]));
    assert.ok(!questionReady("", ["no spam"]));
    assert.ok(!questionReady("Rule one?", []));
    assert.ok(!questionReady("Rule one?", [" "]));
  });
});

describe("account age", () => {
  const DAY = 86_400_000;

  test("is fine with no minimum", () => {
    assert.deepEqual(accountAge(1000, 2000, undefined, "kick"), { kind: "ok" });
    assert.deepEqual(accountAge(1000, 2000, 0, "kick"), { kind: "ok" });
  });

  test("passes an account that is old enough", () => {
    assert.deepEqual(accountAge(0, 7 * DAY, 7 * DAY, "kick"), { kind: "ok" });
  });

  test("applies the chosen action to a younger one and says when it will be old enough", () => {
    assert.deepEqual(accountAge(3 * DAY, 4 * DAY, 7 * DAY, "hold"), { kind: "hold", oldEnoughAt: 10 * DAY });
    assert.deepEqual(accountAge(3 * DAY, 4 * DAY, 7 * DAY, "kick"), { kind: "kick", oldEnoughAt: 10 * DAY });
  });
});

describe("the wait for an unverified member", () => {
  test("is the timeout when the choice is to remove them", () => {
    assert.equal(timeoutDelay("kick", 60_000), 60_000);
  });

  test("is nothing when they are left alone or the timeout is zero", () => {
    assert.equal(timeoutDelay("nothing", 60_000), null);
    assert.equal(timeoutDelay("kick", 0), null);
  });
});

describe("pressing the button", () => {
  const base = { configured: true, verified: false, tooYoung: false, locked: false, method: "button" };

  test("passes at once for the button method", () => assert.equal(pressOutcome(base), "pass"));

  test("starts a check for the other methods", () => {
    assert.equal(pressOutcome({ ...base, method: "captcha" }), "challenge");
    assert.equal(pressOutcome({ ...base, method: "question" }), "challenge");
  });

  test("refuses before anything else when unconfigured", () => {
    assert.equal(pressOutcome({ ...base, configured: false, verified: true }), "notSetUp");
  });

  test("notices a member who is already verified", () => {
    assert.equal(pressOutcome({ ...base, verified: true, locked: true }), "alreadyVerified");
  });

  test("holds a young account before a lockout", () => {
    assert.equal(pressOutcome({ ...base, tooYoung: true, locked: true }), "tooYoung");
  });

  test("refuses a locked-out member", () => {
    assert.equal(pressOutcome({ ...base, locked: true, method: "captcha" }), "locked");
  });
});

describe("the challenge book", () => {
  const make = () => {
    let clock = 1_000_000;
    const book = new ChallengeBook(60_000, () => clock);
    return {
      book,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };
  const typed = (answer: string): Round => ({ type: "typed", answer, values: {} });
  const say = (text: string) => ({ kind: "text" as const, text });
  const none = { question: () => false };

  test("accepts the right answer and forgets the check", () => {
    const { book } = make();
    book.issue("a", [typed("12")]);
    assert.deepEqual(book.answer("a", say("12"), 3, none), { outcome: "correct" });
    assert.equal(book.active("a"), false);
  });

  test("moves through the rounds one at a time", () => {
    const { book } = make();
    book.issue("a", [typed("1"), typed("2"), typed("3")]);
    assert.deepEqual(book.answer("a", say("1"), 3, none), { outcome: "next", step: 1, total: 3 });
    assert.equal(book.running("a")?.step, 1);
    assert.deepEqual(book.answer("a", say("2"), 3, none), { outcome: "next", step: 2, total: 3 });
    assert.deepEqual(book.answer("a", say("3"), 3, none), { outcome: "correct" });
  });

  test("a miss ends the attempt, and the member starts from the first round", () => {
    const { book } = make();
    book.issue("a", [typed("1"), typed("2")]);
    book.answer("a", say("1"), 3, none);
    assert.deepEqual(book.answer("a", say("x"), 3, none), { outcome: "wrong", left: 2 });
    assert.equal(book.active("a"), false);
    book.issue("a", [typed("1"), typed("2")]);
    assert.equal(book.running("a")?.step, 0);
    assert.deepEqual(book.answer("a", say("x"), 3, none), { outcome: "wrong", left: 1 });
  });

  test("runs out of tries", () => {
    const { book } = make();
    for (let attempt = 0; attempt < 2; attempt++) {
      book.issue("a", [typed("1")]);
      book.answer("a", say("x"), 3, none);
    }
    book.issue("a", [typed("1")]);
    assert.deepEqual(book.answer("a", say("x"), 3, none), { outcome: "exhausted" });
    assert.equal(book.active("a"), false);
  });

  test("an order round takes presses one at a time and judges the last", () => {
    const { book } = make();
    const round: Round = {
      type: "order",
      choices: [{ token: "b" }, { token: "a" }, { token: "c" }],
      answer: ["a", "b", "c"],
      values: {},
    };
    book.issue("a", [round]);
    const press = (token: string) => book.answer("a", { kind: "token", token }, 3, none);
    assert.deepEqual(press("a"), { outcome: "more", pressed: ["a"] });
    assert.deepEqual(press("a"), { outcome: "more", pressed: ["a"] });
    assert.deepEqual(press("b"), { outcome: "more", pressed: ["a", "b"] });
    assert.deepEqual(press("c"), { outcome: "correct" });
  });

  test("a question round asks the settings", () => {
    const { book } = make();
    const matchers = { question: (text: string) => text === "yes" };
    book.issue("a", [{ type: "question" }]);
    assert.deepEqual(book.answer("a", say("no"), 3, matchers), { outcome: "wrong", left: 2 });
    book.issue("a", [{ type: "question" }]);
    assert.deepEqual(book.answer("a", say("yes"), 3, matchers), { outcome: "correct" });
  });

  test("says expired with no check, or after the time is up", () => {
    const { book, advance } = make();
    assert.deepEqual(book.answer("a", say("x"), 3, none), { outcome: "expired" });
    book.issue("a", [typed("1")]);
    advance(60_001);
    assert.equal(book.active("a"), false);
    assert.deepEqual(book.answer("a", say("1"), 3, none), { outcome: "expired" });
  });

  test("locks out until the time passes, and starts clean afterwards", () => {
    const { book, advance } = make();
    const until = book.lock("a", 10_000);
    assert.equal(book.lockedUntil("a"), until);
    book.issue("a", [typed("1")]);
    assert.deepEqual(book.answer("a", say("1"), 3, none), { outcome: "locked", until });
    advance(10_001);
    assert.equal(book.lockedUntil("a"), null);
    book.issue("a", [typed("1")]);
    assert.deepEqual(book.answer("a", say("1"), 3, none), { outcome: "correct" });
  });

  test("keeps members apart", () => {
    const { book } = make();
    book.issue("a", [typed("1")]);
    book.issue("b", [typed("2")]);
    assert.deepEqual(book.answer("a", say("2"), 3, none), { outcome: "wrong", left: 2 });
    assert.deepEqual(book.answer("b", say("2"), 3, none), { outcome: "correct" });
  });

  test("forgets a member who leaves", () => {
    const { book } = make();
    book.issue("a", [typed("1")]);
    book.clear("a");
    assert.equal(book.active("a"), false);
  });
});
