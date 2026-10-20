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
import { minimumTime, type Round } from "../dist/rounds.js";

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
  const MINUTE = 60_000;
  const make = () => {
    let clock = 1_000_000;
    let counter = 0;
    const book = new ChallengeBook(MINUTE, () => clock, () => `n${++counter}`);
    return {
      book,
      now: () => clock,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };
  const typed = (answer: string): Round => ({ type: "block", answer, values: {} });
  const none = { question: () => false };
  /** Long enough for any round to have been read and typed. */
  const READ = 10_000;

  test("accepts the right answer and forgets the check", () => {
    const { book, advance } = make();
    book.issue("a", [typed("12")]);
    advance(READ);
    assert.deepEqual(book.answer("a", "12", 3, none), { outcome: "correct" });
    assert.equal(book.active("a"), false);
  });

  test("moves through the rounds one at a time", () => {
    const { book, advance } = make();
    book.issue("a", [typed("1"), typed("2"), typed("3")]);
    advance(READ);
    assert.deepEqual(book.answer("a", "1", 3, none), { outcome: "next", step: 1, total: 3 });
    assert.equal(book.running("a")?.step, 1);
    advance(READ);
    assert.deepEqual(book.answer("a", "2", 3, none), { outcome: "next", step: 2, total: 3 });
    advance(READ);
    assert.deepEqual(book.answer("a", "3", 3, none), { outcome: "correct" });
  });

  test("a miss ends the attempt, and the member starts from the first round", () => {
    const { book, advance } = make();
    book.issue("a", [typed("1"), typed("2")]);
    advance(READ);
    book.answer("a", "1", 3, none);
    advance(READ);
    assert.deepEqual(book.answer("a", "x", 3, none), { outcome: "wrong", left: 2 });
    assert.equal(book.active("a"), false);
    book.issue("a", [typed("1"), typed("2")]);
    assert.equal(book.running("a")?.step, 0);
    advance(READ);
    assert.deepEqual(book.answer("a", "x", 3, none), { outcome: "wrong", left: 1 });
  });

  test("runs out of tries", () => {
    const { book, advance } = make();
    for (let attempt = 0; attempt < 2; attempt++) {
      book.issue("a", [typed("1")]);
      advance(READ);
      book.answer("a", "x", 3, none);
    }
    book.issue("a", [typed("1")]);
    advance(READ);
    assert.deepEqual(book.answer("a", "x", 3, none), { outcome: "exhausted" });
    assert.equal(book.active("a"), false);
  });

  test("a question round asks the settings", () => {
    const { book, advance } = make();
    const matchers = { question: (text: string) => text === "yes" };
    book.issue("a", [{ type: "question" }]);
    assert.deepEqual(book.answer("a", "no", 3, matchers), { outcome: "wrong", left: 2 });
    book.issue("a", [{ type: "question" }]);
    advance(0);
    assert.deepEqual(book.answer("a", "yes", 3, matchers), { outcome: "correct" });
  });

  test("says expired with no check, or after the time is up", () => {
    const { book, advance } = make();
    assert.deepEqual(book.answer("a", "x", 3, none), { outcome: "expired" });
    book.issue("a", [typed("1")]);
    advance(MINUTE + 1);
    assert.equal(book.active("a"), false);
    assert.deepEqual(book.answer("a", "1", 3, none), { outcome: "expired" });
  });

  test("a check can be given longer to wait than the book's own", () => {
    const { book, advance } = make();
    book.issue("a", [typed("1")], 5 * MINUTE);
    advance(4 * MINUTE);
    assert.equal(book.active("a"), true);
    advance(2 * MINUTE);
    assert.equal(book.active("a"), false);
  });

  test("keeps members apart", () => {
    const { book, advance } = make();
    book.issue("a", [typed("1")]);
    book.issue("b", [typed("2")]);
    advance(READ);
    assert.deepEqual(book.answer("a", "2", 3, none), { outcome: "wrong", left: 2 });
    assert.deepEqual(book.answer("b", "2", 3, none), { outcome: "correct" });
  });

  test("forgets a member who leaves, but not a lockout", () => {
    const { book } = make();
    book.issue("a", [typed("1")]);
    book.leave("a");
    assert.equal(book.active("a"), false);
    const until = book.lock("b", 10_000);
    book.leave("b");
    assert.equal(book.lockedUntil("b"), until);
  });

  test("clearing starts a member from nothing, lockout included", () => {
    const { book } = make();
    book.lock("a", 10_000);
    book.clear("a");
    assert.equal(book.lockedUntil("a"), null);
  });

  describe("how fast an answer may come", () => {
    test("an answer sooner than anyone could read and type it is a miss, even when it is right", () => {
      const { book, advance } = make();
      book.issue("a", [typed("12")]);
      advance(300);
      assert.deepEqual(book.answer("a", "12", 3, none), { outcome: "wrong", left: 2 });
    });

    test("the same answer a few seconds later is right", () => {
      const { book, advance } = make();
      book.issue("a", [typed("12")]);
      advance(3_000);
      assert.deepEqual(book.answer("a", "12", 3, none), { outcome: "correct" });
    });

    test("the wait starts again for each round", () => {
      const { book, advance } = make();
      book.issue("a", [typed("1"), typed("2")]);
      advance(READ);
      book.answer("a", "1", 3, none);
      advance(300);
      assert.deepEqual(book.answer("a", "2", 3, none), { outcome: "wrong", left: 2 });
    });

    test("does not hold up a question, which a member may know the answer to", () => {
      const { book } = make();
      book.issue("a", [{ type: "question" }]);
      assert.deepEqual(book.answer("a", "yes", 3, { question: () => true }), { outcome: "correct" });
    });

    test("is longer for the rounds that take longer to read", () => {
      const rounds: Round[] = [
        { type: "text", answer: "a", values: {}, image: { code: "A", seed: 1 } },
        { type: "block", answer: "a", values: {} },
        { type: "colour", answer: "a", values: {}, image: { code: "A", seed: 1 } },
        { type: "motion", answer: "a", values: {}, image: { code: "A", seed: 1 } },
        { type: "question" },
      ];
      const times = rounds.map((round) => minimumTime(round));
      assert.deepEqual(times, [1500, 2000, 2000, 2500, 0]);
    });
  });

  describe("the round on screen", () => {
    test("an answer from a message that is no longer current is not taken", () => {
      const { book, advance } = make();
      book.issue("a", [typed("1"), typed("2")]);
      const first = book.running("a")!.nonce;
      advance(READ);
      assert.deepEqual(book.answer("a", "1", 3, none, first), { outcome: "next", step: 1, total: 2 });
      const second = book.running("a")!.nonce;
      assert.notEqual(first, second);
      advance(READ);
      assert.deepEqual(book.answer("a", "2", 3, none, first), { outcome: "expired" });
      assert.deepEqual(book.answer("a", "2", 3, none, second), { outcome: "correct" });
    });

    test("a new attempt gets a new one", () => {
      const { book } = make();
      book.issue("a", [typed("1")]);
      const before = book.running("a")!.nonce;
      book.issue("a", [typed("1")]);
      assert.notEqual(book.running("a")!.nonce, before);
    });

    test("an expired answer does not count as a miss", () => {
      const { book, advance } = make();
      book.issue("a", [typed("1")]);
      advance(READ);
      book.answer("a", "1", 3, none, "stale");
      assert.deepEqual(book.answer("a", "x", 3, none), { outcome: "wrong", left: 2 });
    });
  });

  describe("a round of squares", () => {
    const tiles = (answer: string): Round => ({ type: "tiles", answer, values: {}, tiles: { shapes: [], seed: 1 } });

    test("presses and unpresses squares, and judges what is pressed when done", () => {
      const { book, advance } = make();
      book.issue("a", [tiles("159")]);
      const nonce = book.running("a")!.nonce;
      assert.deepEqual(book.toggle("a", nonce, 9), [9]);
      assert.deepEqual(book.toggle("a", nonce, 1), [9, 1]);
      assert.deepEqual(book.toggle("a", nonce, 7), [9, 1, 7]);
      assert.deepEqual(book.toggle("a", nonce, 7), [9, 1]);
      assert.deepEqual(book.toggle("a", nonce, 5), [9, 1, 5]);
      assert.equal(book.selection("a"), "159");
      advance(READ);
      assert.deepEqual(book.answer("a", book.selection("a"), 3, none, nonce), { outcome: "correct" });
    });

    test("is a miss when a square is missing or one too many is pressed", () => {
      for (const extra of [[1, 5], [1, 5, 9, 3]]) {
        const { book, advance } = make();
        book.issue("a", [tiles("159")]);
        const nonce = book.running("a")!.nonce;
        for (const square of extra) book.toggle("a", nonce, square);
        advance(READ);
        assert.deepEqual(book.answer("a", book.selection("a"), 3, none, nonce), { outcome: "wrong", left: 2 });
      }
    });

    test("pressing nothing is a miss", () => {
      const { book, advance } = make();
      book.issue("a", [tiles("159")]);
      advance(READ);
      assert.deepEqual(book.answer("a", book.selection("a"), 3, none), { outcome: "wrong", left: 2 });
    });

    test("is a miss when done is pressed too soon, even with the right squares", () => {
      const { book, advance } = make();
      book.issue("a", [tiles("159")]);
      const nonce = book.running("a")!.nonce;
      for (const square of [1, 5, 9]) book.toggle("a", nonce, square);
      advance(500);
      assert.deepEqual(book.answer("a", book.selection("a"), 3, none, nonce), { outcome: "wrong", left: 2 });
    });

    test("takes no press from an old message, an unknown square or a round that is not squares", () => {
      const { book } = make();
      book.issue("a", [tiles("159")]);
      const nonce = book.running("a")!.nonce;
      assert.equal(book.toggle("a", "stale", 1), null);
      assert.equal(book.toggle("a", nonce, 0), null);
      assert.equal(book.toggle("a", nonce, 10), null);
      assert.equal(book.toggle("a", nonce, 1.5), null);
      assert.equal(book.toggle("b", nonce, 1), null);
      book.issue("c", [typed("1")]);
      assert.equal(book.toggle("c", book.running("c")!.nonce, 1), null);
      assert.equal(book.selection("a"), "");
    });

    test("starts each round with nothing pressed", () => {
      const { book, advance } = make();
      book.issue("a", [tiles("12"), tiles("34")]);
      const first = book.running("a")!.nonce;
      book.toggle("a", first, 1);
      book.toggle("a", first, 2);
      advance(READ);
      assert.deepEqual(book.answer("a", book.selection("a"), 3, none, first), { outcome: "next", step: 1, total: 2 });
      assert.equal(book.selection("a"), "");
      assert.deepEqual(book.running("a")!.selected, []);
    });

    test("starts a new attempt with nothing pressed", () => {
      const { book, advance } = make();
      book.issue("a", [tiles("12")]);
      book.toggle("a", book.running("a")!.nonce, 3);
      advance(READ);
      book.answer("a", book.selection("a"), 3, none);
      book.issue("a", [tiles("12")]);
      assert.equal(book.selection("a"), "");
    });
  });

  describe("lockouts", () => {
    const DAY = 86_400_000;

    test("grow each time a member is locked out again, up to eight times as long", () => {
      const { book, advance, now } = make();
      const lengths: number[] = [];
      for (let i = 0; i < 6; i++) {
        const until = book.lock("a", MINUTE);
        lengths.push((until - now()) / MINUTE);
        advance(until - now() + 1);
      }
      assert.deepEqual(lengths, [1, 2, 4, 8, 8, 8]);
    });

    test("start again at the length set once a day has passed without one", () => {
      const { book, advance, now } = make();
      book.lock("a", MINUTE);
      book.lock("a", MINUTE);
      advance(DAY + 1);
      assert.equal((book.lock("a", MINUTE) - now()) / MINUTE, 1);
    });

    test("are kept apart for each member", () => {
      const { book, now } = make();
      book.lock("a", MINUTE);
      book.lock("a", MINUTE);
      assert.equal((book.lock("b", MINUTE) - now()) / MINUTE, 1);
    });

    test("never grow past the longest lockout the setting allows", () => {
      const { book, advance, now } = make();
      for (let i = 0; i < 6; i++) {
        const until = book.lock("a", 3 * DAY);
        assert.ok(until - now() <= 7 * DAY);
        advance(until - now() + 1);
      }
    });

    test("a member who left and came back is still locked out", () => {
      const { book } = make();
      const until = book.lock("a", MINUTE);
      book.leave("a");
      book.issue("a", [{ type: "question" }]);
      assert.deepEqual(book.answer("a", "x", 3, { question: () => true }), { outcome: "locked", until });
    });
  });
});
