import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateMessage, normalizeForBannedWords } from "../dist/evaluator.js";
import { settings } from "../dist/settings.js";

function defaultSettings() {
  const parsed = settings.parse({});
  assert.equal(parsed.ok, true, "the schema's own defaults must parse cleanly");
  return parsed.ok ? parsed.value : undefined;
}

// Turns one rule on with the given overrides, leaving every other rule at
// its (disabled) default so tests never trip a rule they are not exercising.
function withRule(rule, patch = {}) {
  const base = defaultSettings();
  return {
    ...base,
    [rule]: { ...base[rule], enabled: true, ...patch },
  };
}

function input(overrides = {}) {
  return {
    content: "hello there",
    authorRoles: [],
    authorIsBot: false,
    authorIsModerator: false,
    channelId: "channel-1",
    now: 1_000_000,
    history: [],
    settings: defaultSettings(),
    ...overrides,
  };
}

describe("baseline", () => {
  test("an ordinary message with every rule off does not trigger", () => {
    const verdict = evaluateMessage(input());
    assert.equal(verdict.triggered, false);
    assert.deepEqual(verdict.matchedRules, []);
  });

  test("a bot author never triggers, even with a rule that would otherwise fire", () => {
    const verdict = evaluateMessage(
      input({
        content: "join my server https://discord.gg/notallowed",
        authorIsBot: true,
        settings: withRule("invites"),
      }),
    );
    assert.equal(verdict.triggered, false);
  });
});

describe("exemptions", () => {
  test("a moderator is exempt by default", () => {
    const verdict = evaluateMessage(
      input({
        content: "https://discord.gg/notallowed",
        authorIsModerator: true,
        settings: withRule("invites"),
      }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("turning off exemptModerators makes moderators subject to rules again", () => {
    const settingsValue = { ...withRule("invites"), exemptModerators: false };
    const verdict = evaluateMessage(
      input({
        content: "https://discord.gg/notallowed",
        authorIsModerator: true,
        settings: settingsValue,
      }),
    );
    assert.equal(verdict.triggered, true);
  });

  test("a server-wide exempt channel is never touched", () => {
    const settingsValue = { ...withRule("invites"), exemptChannels: ["channel-1"] };
    const verdict = evaluateMessage(
      input({ content: "https://discord.gg/notallowed", settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("a server-wide exempt role is never touched", () => {
    const settingsValue = { ...withRule("invites"), exemptRoles: ["role-vip"] };
    const verdict = evaluateMessage(
      input({
        content: "https://discord.gg/notallowed",
        authorRoles: ["role-vip"],
        settings: settingsValue,
      }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("a per-rule exempt role only excuses that rule", () => {
    const settingsValue = withRule("invites", { exemptRoles: ["role-streamer"] });
    const verdict = evaluateMessage(
      input({
        content: "https://discord.gg/notallowed",
        authorRoles: ["role-streamer"],
        settings: settingsValue,
      }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("a per-rule exempt channel only excuses that rule", () => {
    const settingsValue = withRule("invites", { exemptChannels: ["promo-channel"] });
    const verdict = evaluateMessage(
      input({
        content: "https://discord.gg/notallowed",
        channelId: "promo-channel",
        settings: settingsValue,
      }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("an exemption for one rule does not excuse a different rule", () => {
    const base = withRule("invites", { exemptRoles: ["role-streamer"] });
    const settingsValue = { ...base, links: { ...base.links, enabled: true } };
    const verdict = evaluateMessage(
      input({
        content: "check out https://example.com",
        authorRoles: ["role-streamer"],
        settings: settingsValue,
      }),
    );
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "links");
  });
});

describe("invites", () => {
  test("trips on a discord.gg invite not on the allowlist", () => {
    const verdict = evaluateMessage(
      input({ content: "come hang out discord.gg/randomcode", settings: withRule("invites") }),
    );
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "invites");
  });

  test("recognizes discord.com/invite and discordapp.com/invite forms", () => {
    const a = evaluateMessage(
      input({ content: "https://discord.com/invite/abc123", settings: withRule("invites") }),
    );
    const b = evaluateMessage(
      input({ content: "https://discordapp.com/invite/abc123", settings: withRule("invites") }),
    );
    assert.equal(a.triggered, true);
    assert.equal(b.triggered, true);
  });

  test("does not trip for a code on the allowlist", () => {
    const settingsValue = withRule("invites", { allowlist: ["randomcode"] });
    const verdict = evaluateMessage(
      input({ content: "discord.gg/randomcode", settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("an allowlist entry can be a full link rather than a bare code", () => {
    const settingsValue = withRule("invites", { allowlist: ["https://discord.gg/randomcode/"] });
    const verdict = evaluateMessage(
      input({ content: "discord.gg/randomcode", settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("does not trip when the rule is disabled", () => {
    const verdict = evaluateMessage(input({ content: "discord.gg/randomcode" }));
    assert.equal(verdict.triggered, false);
  });

  test("does not trip on a message with no invite", () => {
    const verdict = evaluateMessage(
      input({ content: "no links here at all", settings: withRule("invites") }),
    );
    assert.equal(verdict.triggered, false);
  });
});

describe("links", () => {
  test("trips on a domain not on the allowlist", () => {
    const verdict = evaluateMessage(
      input({ content: "go to https://sketchy.example/deal", settings: withRule("links") }),
    );
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "links");
  });

  test("allows an exact domain match", () => {
    const settingsValue = withRule("links", { allowlist: ["youtube.com"] });
    const verdict = evaluateMessage(
      input({ content: "https://youtube.com/watch?v=1", settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("allows a subdomain of an allowed domain", () => {
    const settingsValue = withRule("links", { allowlist: ["youtube.com"] });
    const verdict = evaluateMessage(
      input({ content: "https://music.youtube.com/watch?v=1", settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("a www prefix on either side of the comparison is ignored", () => {
    const settingsValue = withRule("links", { allowlist: ["www.youtube.com"] });
    const verdict = evaluateMessage(
      input({ content: "https://youtube.com/watch?v=1", settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("does not trip on a message with no link", () => {
    const verdict = evaluateMessage(
      input({ content: "no links here at all", settings: withRule("links") }),
    );
    assert.equal(verdict.triggered, false);
  });
});

describe("capitals", () => {
  test("trips on a long shouted message", () => {
    const verdict = evaluateMessage(
      input({ content: "THIS IS ALL CAPITAL LETTERS", settings: withRule("capitals") }),
    );
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "capitals");
  });

  test("a short shout like OK does not trip because of minLength", () => {
    const verdict = evaluateMessage(input({ content: "OK!!", settings: withRule("capitals") }));
    assert.equal(verdict.triggered, false);
  });

  test("a long message under the percentage threshold does not trip", () => {
    const verdict = evaluateMessage(
      input({
        content: "This is a Normal sentence with just one Capital here and there ok",
        settings: withRule("capitals"),
      }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("minLength counts letters only, ignoring punctuation and digits", () => {
    // 9 letters, one short of the default minLength of 10, even though the
    // raw string is much longer than that.
    const verdict = evaluateMessage(
      input({ content: "12345678 OK!!!!!!!", settings: withRule("capitals") }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("the threshold is inclusive at the boundary", () => {
    const settingsValue = withRule("capitals", { thresholdPercent: 50, minLength: 4 });
    // 4 letters, exactly 2 upper: exactly 50%.
    const verdict = evaluateMessage(input({ content: "ABcd", settings: settingsValue }));
    assert.equal(verdict.triggered, true);
  });
});

describe("repeatedText", () => {
  test("a wall of one repeated character trips", () => {
    const verdict = evaluateMessage(
      input({ content: "aaaaaaaaaaaa", settings: withRule("repeatedText") }),
    );
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "repeatedText");
  });

  test("a short run under the configured length does not trip", () => {
    const settingsValue = withRule("repeatedText", { maxCharacterRepeat: 10 });
    const verdict = evaluateMessage(input({ content: "aaaa", settings: settingsValue }));
    assert.equal(verdict.triggered, false);
  });

  test("repeating the same message enough times within the window trips", () => {
    const settingsValue = withRule("repeatedText", { repeatMessageCount: 3, repeatWindow: 30_000 });
    const history = [
      { content: "buy my stuff", timestamp: 990_000 },
      { content: "buy my stuff", timestamp: 995_000 },
    ];
    const verdict = evaluateMessage(
      input({ content: "buy my stuff", now: 1_000_000, history, settings: settingsValue }),
    );
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "repeatedText");
  });

  test("copies outside the window are not counted", () => {
    const settingsValue = withRule("repeatedText", { repeatMessageCount: 3, repeatWindow: 10_000 });
    const history = [
      { content: "buy my stuff", timestamp: 500_000 },
      { content: "buy my stuff", timestamp: 995_000 },
    ];
    const verdict = evaluateMessage(
      input({ content: "buy my stuff", now: 1_000_000, history, settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("distinct messages never count as repeats of each other", () => {
    const settingsValue = withRule("repeatedText", { repeatMessageCount: 2 });
    const history = [{ content: "good morning", timestamp: 999_000 }];
    const verdict = evaluateMessage(
      input({ content: "good evening", now: 1_000_000, history, settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("comparison ignores case and surrounding whitespace", () => {
    const settingsValue = withRule("repeatedText", { repeatMessageCount: 2 });
    const history = [{ content: "  Buy My Stuff  ", timestamp: 999_000 }];
    const verdict = evaluateMessage(
      input({ content: "buy my stuff", now: 1_000_000, history, settings: settingsValue }),
    );
    assert.equal(verdict.triggered, true);
  });
});

describe("mentions", () => {
  test("trips over the limit", () => {
    const settingsValue = withRule("mentions", { limit: 2 });
    const content = "<@111111111111111111> <@222222222222222222> <@333333333333333333>";
    const verdict = evaluateMessage(input({ content, settings: settingsValue }));
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "mentions");
  });

  test("exactly at the limit does not trip", () => {
    const settingsValue = withRule("mentions", { limit: 2 });
    const content = "<@111111111111111111> <@222222222222222222>";
    const verdict = evaluateMessage(input({ content, settings: settingsValue }));
    assert.equal(verdict.triggered, false);
  });

  test("user and role mentions count together", () => {
    const settingsValue = withRule("mentions", { limit: 2 });
    const content = "<@111111111111111111> <@&222222222222222222> <@&333333333333333333>";
    const verdict = evaluateMessage(input({ content, settings: settingsValue }));
    assert.equal(verdict.triggered, true);
  });
});

describe("bannedWords", () => {
  test("trips on an exact match", () => {
    const settingsValue = withRule("bannedWords", { words: ["badword"] });
    const verdict = evaluateMessage(
      input({ content: "that is a badword to use", settings: settingsValue }),
    );
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "bannedWords");
  });

  test("matching is case-insensitive", () => {
    const settingsValue = withRule("bannedWords", { words: ["badword"] });
    const verdict = evaluateMessage(input({ content: "BADWORD", settings: settingsValue }));
    assert.equal(verdict.triggered, true);
  });

  test("catches simple leetspeak substitution", () => {
    const settingsValue = withRule("bannedWords", { words: ["ass"] });
    const verdict = evaluateMessage(input({ content: "you a55", settings: settingsValue }));
    assert.equal(verdict.triggered, true);
  });

  test("catches a stretched-out word", () => {
    const settingsValue = withRule("bannedWords", { words: ["dumb"] });
    const verdict = evaluateMessage(input({ content: "duuuumb", settings: settingsValue }));
    assert.equal(verdict.triggered, true);
  });

  test("does not flag a word for containing a banned word as a substring", () => {
    const settingsValue = withRule("bannedWords", { words: ["ass"] });
    const assassin = evaluateMessage(input({ content: "the assassin waited", settings: settingsValue }));
    const classic = evaluateMessage(input({ content: "a classic example", settings: settingsValue }));
    assert.equal(assassin.triggered, false);
    assert.equal(classic.triggered, false);
  });

  test("an empty word list never trips", () => {
    const settingsValue = withRule("bannedWords", { words: [] });
    const verdict = evaluateMessage(input({ content: "anything at all", settings: settingsValue }));
    assert.equal(verdict.triggered, false);
  });

  test("does not trip when the rule is disabled", () => {
    const verdict = evaluateMessage(input({ content: "badword" }));
    assert.equal(verdict.triggered, false);
  });
});

describe("normalizeForBannedWords", () => {
  test("folds common leetspeak substitutions", () => {
    assert.equal(normalizeForBannedWords("a55 4nd $tuff"), "ass and stuff");
  });

  test("collapses a letter repeated three or more times", () => {
    assert.equal(normalizeForBannedWords("sooooo good"), "so good");
  });

  test("leaves a legitimate double letter alone", () => {
    assert.equal(normalizeForBannedWords("bookkeeper"), "bookkeeper");
  });
});

describe("rateLimit", () => {
  test("trips once the count in the window exceeds the limit", () => {
    const settingsValue = withRule("rateLimit", { limit: 3, window: 10_000 });
    const history = [
      { content: "a", timestamp: 998_000 },
      { content: "b", timestamp: 998_500 },
      { content: "c", timestamp: 999_000 },
    ];
    const verdict = evaluateMessage(input({ now: 1_000_000, history, settings: settingsValue }));
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "rateLimit");
  });

  test("exactly at the limit does not trip", () => {
    const settingsValue = withRule("rateLimit", { limit: 3, window: 10_000 });
    const history = [
      { content: "a", timestamp: 998_500 },
      { content: "b", timestamp: 999_000 },
    ];
    const verdict = evaluateMessage(input({ now: 1_000_000, history, settings: settingsValue }));
    assert.equal(verdict.triggered, false);
  });

  test("messages outside the window are not counted", () => {
    const settingsValue = withRule("rateLimit", { limit: 2, window: 5_000 });
    const history = [
      { content: "a", timestamp: 100_000 },
      { content: "b", timestamp: 200_000 },
    ];
    const verdict = evaluateMessage(input({ now: 1_000_000, history, settings: settingsValue }));
    assert.equal(verdict.triggered, false);
  });
});

describe("combining rules", () => {
  test("a message that trips two rules is acted on once, at the higher severity", () => {
    const base = withRule("bannedWords", { words: ["badword"], action: "warn" });
    const settingsValue = {
      ...base,
      rateLimit: { ...base.rateLimit, enabled: true, limit: 1, window: 10_000, action: "timeout" },
    };
    const history = [{ content: "prior message", timestamp: 999_000 }];
    const verdict = evaluateMessage(
      input({ content: "badword", now: 1_000_000, history, settings: settingsValue }),
    );
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.action, "timeout");
    assert.deepEqual(new Set(verdict.matchedRules), new Set(["bannedWords", "rateLimit"]));
  });

  test("severity picks timeout over delete over warn regardless of check order", () => {
    const base = withRule("links", { action: "delete", allowlist: [] });
    const settingsValue = { ...base, invites: { ...base.invites, enabled: true, action: "timeout" } };
    const verdict = evaluateMessage(
      input({
        content: "discord.gg/x and https://sketchy.example",
        settings: settingsValue,
      }),
    );
    assert.equal(verdict.action, "timeout");
    assert.equal(verdict.rule, "invites");
  });

  test("a timeout verdict carries the configured timeout duration", () => {
    const settingsValue = withRule("mentions", {
      limit: 1,
      action: "timeout",
      timeoutDuration: 60_000,
    });
    const content = "<@111111111111111111> <@222222222222222222>";
    const verdict = evaluateMessage(input({ content, settings: settingsValue }));
    assert.equal(verdict.action, "timeout");
    assert.equal(verdict.timeoutMs, 60_000);
  });

  test("a warn verdict carries no timeout duration", () => {
    const settingsValue = withRule("mentions", { limit: 1, action: "warn" });
    const content = "<@111111111111111111> <@222222222222222222>";
    const verdict = evaluateMessage(input({ content, settings: settingsValue }));
    assert.equal(verdict.action, "warn");
    assert.equal(verdict.timeoutMs, undefined);
  });
});
