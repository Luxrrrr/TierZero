import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PATTERN_MAX_LENGTH, PatternGuard, checkPattern, patternProblem, wildcardSource } from "../dist/patterns.js";
import { evaluateMessage } from "../dist/evaluator.js";
import { settings } from "../dist/settings.js";

function rules(patch) {
  const parsed = settings.parse({});
  assert.equal(parsed.ok, true);
  const base = parsed.value;
  return { ...base, bannedWords: { ...base.bannedWords, enabled: true, ...patch } };
}

function verdictFor(content, patch) {
  return evaluateMessage({
    content,
    authorRoles: [],
    authorIsBot: false,
    authorIsModerator: false,
    channelId: "channel-1",
    guildId: "guild-1",
    now: 1_000_000,
    history: [],
    settings: rules(patch),
  });
}

describe("checkPattern", () => {
  test("accepts ordinary patterns", () => {
    for (const pattern of ["free\\s*nitro", "disc[o0]rd\\.gg/\\w+", "(?:buy|sell)\\s+gold", "a{2,5}b", "colou?r"]) {
      assert.equal(checkPattern(pattern).ok, true, pattern);
    }
  });

  test("refuses a group repeated while it repeats inside", () => {
    for (const pattern of ["(a+)+", "(a*)*b", "(a|aa)+", "(a|a)*", "((a|b)c)*", "(\\w+\\s?)+"]) {
      assert.equal(checkPattern(pattern).ok, false, pattern);
    }
  });

  test("allows an optional group and a plain repeated group", () => {
    assert.equal(checkPattern("(ab)?c").ok, true);
    assert.equal(checkPattern("(ab)+c").ok, true);
  });

  test("refuses backreferences, lookahead and lookbehind", () => {
    assert.equal(checkPattern("(a)\\1").ok, false);
    assert.equal(checkPattern("a(?=b)").ok, false);
    assert.equal(checkPattern("a(?!b)").ok, false);
    assert.equal(checkPattern("(?<=a)b").ok, false);
    assert.equal(checkPattern("(?<!a)b").ok, false);
  });

  test("refuses empty, overlong and invalid patterns", () => {
    assert.equal(checkPattern("   ").ok, false);
    assert.equal(checkPattern("a".repeat(PATTERN_MAX_LENGTH + 1)).ok, false);
    assert.equal(checkPattern("(unclosed").ok, false);
    assert.equal(checkPattern("[z-a]").ok, false);
  });

  test("refuses a repeat count above one hundred and a pattern that repeats too much overall", () => {
    assert.equal(checkPattern("a{1,101}").ok, false);
    assert.equal(checkPattern("a*b*c*d*e*").ok, false);
    assert.equal(checkPattern(`${"a?".repeat(30)}${"a".repeat(30)}`).ok, false);
    assert.equal(checkPattern("a+a+a+b").ok, false);
    assert.equal(checkPattern("colou?r").ok, true);
    assert.equal(checkPattern("free\\s*nitro\\s*gift").ok, true);
  });

  test("caps open-ended repeats in the form that is run", () => {
    const check = checkPattern("a+b*");
    assert.equal(check.ok, true);
    assert.equal(check.source, "a{1,32}b{0,32}");
  });

  test("patternProblem is null for a good pattern and words the problem for a bad one", () => {
    assert.equal(patternProblem("abc"), null);
    assert.match(patternProblem("(a+)+") ?? "", /repeat/);
  });

  test("a pattern the check passes cannot take long on a hostile message", () => {
    // Every pattern that is let through is run against text built to hurt it.
    const hostile = "a".repeat(2000) + "!";
    const short = "a".repeat(24);
    for (const pattern of ["(a|b)+c", "a+a+a+b", "(a?){30}a{30}", "a*b", "(?:a+)b", "\\w+\\s+\\w+$"]) {
      const check = checkPattern(pattern);
      if (!check.ok) continue;
      const started = performance.now();
      new RegExp(check.source, "iu").test(hostile);
      new RegExp(check.source, "iu").test(short);
      assert.ok(performance.now() - started < 400, `${pattern} took ${performance.now() - started} ms`);
    }
  });
});

describe("wildcardSource", () => {
  test("a word without a star is matched as written", () => {
    assert.equal(wildcardSource("badword"), null);
  });

  test("more than two stars, or nothing but stars, is matched as written", () => {
    assert.equal(wildcardSource("a*b*c*d"), null);
    assert.equal(wildcardSource("***"), null);
    assert.equal(wildcardSource("*"), null);
  });

  test("a star covers a short run with no space", () => {
    const source = wildcardSource("free*nitro");
    assert.ok(source);
    const regex = new RegExp(`^${source}$`, "iu");
    assert.ok(regex.test("freenitro"));
    assert.ok(regex.test("free-nitro"));
    assert.ok(regex.test("free_discord_nitro"));
    assert.ok(!regex.test("free nitro"));
    assert.ok(!regex.test(`free${"x".repeat(40)}nitro`));
  });

  test("characters around the star are matched literally", () => {
    const source = wildcardSource("a.b*c");
    assert.ok(source);
    const regex = new RegExp(`^${source}$`, "iu");
    assert.ok(regex.test("a.bxc"));
    assert.ok(!regex.test("axbxc"));
  });
});

describe("banned words in the evaluator", () => {
  test("a wildcard word catches its variants and not unrelated words", () => {
    const patch = { words: ["free*nitro"] };
    assert.equal(verdictFor("get freenitro here", patch).triggered, true);
    assert.equal(verdictFor("get free-nitro here", patch).triggered, true);
    assert.equal(verdictFor("free games and nitro", patch).triggered, false);
  });

  test("a wildcard word still stands on its own in the text", () => {
    const patch = { words: ["sc*m"] };
    assert.equal(verdictFor("what a scam", patch).triggered, true);
    assert.equal(verdictFor("a scammer", patch).triggered, false);
  });

  test("a pattern trips, and the verdict reports the pattern as written", () => {
    const verdict = verdictFor("buy   gold now", { words: [], patterns: ["(?:buy|sell)\\s+gold"] });
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "bannedWords");
    assert.deepEqual(verdict.matches, ["(?:buy|sell)\\s+gold"]);
  });

  test("a pattern is matched without regard to case", () => {
    assert.equal(verdictFor("BUY GOLD", { patterns: ["buy\\s+gold"] }).triggered, true);
  });

  test("a pattern that fails the check never runs", () => {
    const verdict = verdictFor("a".repeat(2000) + "!", { patterns: ["(a+)+$"] });
    assert.equal(verdict.triggered, false);
  });

  test("patterns alone, with no words, are enough to turn the rule on", () => {
    assert.equal(verdictFor("spam link", { words: [], patterns: ["spam\\s+link"] }).triggered, true);
  });

  test("a list saved before patterns existed still reads", () => {
    const parsed = settings.parse({ bannedWords: { enabled: true, words: ["x"] } });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.value.bannedWords.patterns, []);
  });

  test("saving a pattern that is not safe is refused", () => {
    const parsed = settings.parse({ bannedWords: { patterns: ["(a+)+"] } });
    assert.equal(parsed.ok, false);
  });
});

describe("PatternGuard", () => {
  test("sets a slow pattern aside for an hour in that server only", () => {
    let now = 0;
    let wall = 1_000;
    const guard = new PatternGuard(() => now, () => wall);
    const slow = () => {
      now += 80;
      return true;
    };
    assert.equal(guard.run("g1", "src", slow), true);
    assert.equal(guard.isSetAside("g1", "src"), true);
    assert.equal(guard.run("g1", "src", () => true), false);
    assert.equal(guard.isSetAside("g2", "src"), false);
    wall += 61 * 60_000;
    assert.equal(guard.isSetAside("g1", "src"), false);
    assert.equal(guard.run("g1", "src", () => true), true);
  });

  test("a fast pattern is never set aside", () => {
    let now = 0;
    const guard = new PatternGuard(() => now, () => 0);
    guard.run("g1", "src", () => {
      now += 1;
      return false;
    });
    assert.equal(guard.isSetAside("g1", "src"), false);
  });
});
