import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateMessage, fingerprintOf, normalizeDomainEntry, normalizeForBannedWords, normalizeInviteEntry } from "../dist/evaluator.js";
import { settings } from "../dist/settings.js";

// An earlier message as the state keeps it: a digest and a time.
function past(content, timestamp) {
  return { fingerprint: fingerprintOf(content), timestamp };
}

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

  test("an allowlist entry can be a full link as well as a bare code", () => {
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
      past("buy my stuff", 990_000),
      past("buy my stuff", 995_000),
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
      past("buy my stuff", 500_000),
      past("buy my stuff", 995_000),
    ];
    const verdict = evaluateMessage(
      input({ content: "buy my stuff", now: 1_000_000, history, settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("distinct messages never count as repeats of each other", () => {
    const settingsValue = withRule("repeatedText", { repeatMessageCount: 2 });
    const history = [past("good morning", 999_000)];
    const verdict = evaluateMessage(
      input({ content: "good evening", now: 1_000_000, history, settings: settingsValue }),
    );
    assert.equal(verdict.triggered, false);
  });

  test("comparison ignores case and surrounding whitespace", () => {
    const settingsValue = withRule("repeatedText", { repeatMessageCount: 2 });
    const history = [past("  Buy My Stuff  ", 999_000)];
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
      past("a", 998_000),
      past("b", 998_500),
      past("c", 999_000),
    ];
    const verdict = evaluateMessage(input({ now: 1_000_000, history, settings: settingsValue }));
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.rule, "rateLimit");
  });

  test("exactly at the limit does not trip", () => {
    const settingsValue = withRule("rateLimit", { limit: 3, window: 10_000 });
    const history = [
      past("a", 998_500),
      past("b", 999_000),
    ];
    const verdict = evaluateMessage(input({ now: 1_000_000, history, settings: settingsValue }));
    assert.equal(verdict.triggered, false);
  });

  test("messages outside the window are not counted", () => {
    const settingsValue = withRule("rateLimit", { limit: 2, window: 5_000 });
    const history = [
      past("a", 100_000),
      past("b", 200_000),
    ];
    const verdict = evaluateMessage(input({ now: 1_000_000, history, settings: settingsValue }));
    assert.equal(verdict.triggered, false);
  });
});

describe("combining rules", () => {
  test("a message that trips two rules is acted on once, with the worse rule's actions", () => {
    const base = withRule("bannedWords", { words: ["badword"], actions: ["warn"] });
    const settingsValue = {
      ...base,
      rateLimit: { ...base.rateLimit, enabled: true, limit: 1, window: 10_000, actions: ["delete", "timeout"] },
    };
    const history = [past("prior message", 999_000)];
    const verdict = evaluateMessage(
      input({ content: "badword", now: 1_000_000, history, settings: settingsValue }),
    );
    assert.equal(verdict.triggered, true);
    assert.deepEqual(verdict.actions, ["delete", "timeout"]);
    assert.equal(verdict.rule, "rateLimit");
    assert.deepEqual(new Set(verdict.matchedRules), new Set(["bannedWords", "rateLimit"]));
  });

  test("a set with a timeout outranks one with a warning, which outranks deleting alone, whatever the check order", () => {
    const content = "discord.gg/x and https://sketchy.example";
    const run = (invites, links) => {
      const base = withRule("links", { actions: links, allowlist: [] });
      return evaluateMessage(input({ content, settings: { ...base, invites: { ...base.invites, enabled: true, actions: invites } } }));
    };
    assert.equal(run(["delete", "timeout"], ["delete", "warn"]).rule, "invites");
    assert.equal(run(["delete"], ["warn", "timeout"]).rule, "links");
    assert.equal(run(["delete", "warn"], ["delete"]).rule, "invites");
    assert.equal(run(["delete"], ["warn"]).rule, "links");
    assert.equal(run(["delete"], ["delete", "warn"]).rule, "links");
  });

  test("a tie goes to the rule that is checked first, and the sets are never merged", () => {
    const base = withRule("links", { actions: ["delete", "warn"], allowlist: [] });
    const settingsValue = { ...base, invites: { ...base.invites, enabled: true, actions: ["warn", "timeout"] }, capitals: { ...base.capitals, enabled: true, actions: ["delete", "timeout"], thresholdPercent: 1, minLength: 1 } };
    const verdict = evaluateMessage(input({ content: "DISCORD.GG/x https://sketchy.example", settings: settingsValue }));
    assert.equal(verdict.rule, "invites");
    assert.deepEqual(verdict.actions, ["warn", "timeout"]);
  });

  test("a timeout verdict carries the configured timeout duration", () => {
    const settingsValue = withRule("mentions", {
      limit: 1,
      actions: ["timeout"],
      timeoutDuration: 60_000,
    });
    const content = "<@111111111111111111> <@222222222222222222>";
    const verdict = evaluateMessage(input({ content, settings: settingsValue }));
    assert.deepEqual(verdict.actions, ["timeout"]);
    assert.equal(verdict.timeoutMs, 60_000);
  });

  test("a verdict without a timeout carries no timeout duration", () => {
    const content = "<@111111111111111111> <@222222222222222222>";
    for (const actions of [["warn"], ["delete"], ["delete", "warn"]]) {
      const verdict = evaluateMessage(input({ content, settings: withRule("mentions", { limit: 1, actions }) }));
      assert.deepEqual(verdict.actions, actions);
      assert.equal(verdict.timeoutMs, undefined);
    }
  });

  test("lists the actions in the order delete, warn, timeout however they were stored", () => {
    const content = "<@111111111111111111> <@222222222222222222>";
    const verdict = evaluateMessage(input({ content, settings: withRule("mentions", { limit: 1, actions: ["timeout", "warn", "delete"] }) }));
    assert.deepEqual(verdict.actions, ["delete", "warn", "timeout"]);
    assert.equal(verdict.timeoutMs, 600_000);
  });
});

describe("reasons never quote the message", () => {
  test("an invite names no code in the reason and keeps it as detail", () => {
    const verdict = evaluateMessage(input({ content: "discord.gg/randomcode", settings: withRule("invites") }));
    assert.equal(verdict.reason, "Posted a Discord invite link");
    assert.equal(verdict.detail, "randomcode");
  });

  test("a link names no host in the reason and keeps it as detail", () => {
    const verdict = evaluateMessage(input({ content: "see https://sketchy.example/deal", settings: withRule("links") }));
    assert.equal(verdict.reason, "Posted a link to a site that isn't allowed");
    assert.equal(verdict.detail, "sketchy.example");
  });

  test("rules that match nothing specific carry no detail", () => {
    const verdict = evaluateMessage(input({ content: "SHOUTING IN CAPS ALL THE TIME", settings: withRule("capitals", { minLength: 5 }) }));
    assert.equal(verdict.rule, "capitals");
    assert.equal(verdict.detail, undefined);
    assert.equal(verdict.matches, undefined);
  });

  test("banned words report the entries of the list that matched, not the member's message", () => {
    const verdict = evaluateMessage(
      input({
        content: "well Badword and some other words, plus a b4dw0rd evasion",
        settings: withRule("bannedWords", { words: ["badword", "  not here ", "other words", "nope"] }),
      }),
    );
    assert.equal(verdict.reason, "Used a banned word or phrase");
    assert.deepEqual(verdict.matches, ["badword", "other words"]);
    assert.equal(verdict.detail, "badword, other words");
    assert.ok(!verdict.detail?.includes("well"));
  });

  test("a word that matched both plain and folded is listed once", () => {
    const verdict = evaluateMessage(input({ content: "badword", settings: withRule("bannedWords", { words: ["badword", "badword"] }) }));
    assert.deepEqual(verdict.matches, ["badword"]);
  });
});

describe("links with hostile addresses", () => {
  const hostile = "https://x<@&123456789012345678>";

  test("a role mention smuggled into the host is an invalid address, not echoed", () => {
    const verdict = evaluateMessage(input({ content: hostile, settings: withRule("links") }));
    assert.equal(verdict.triggered, true);
    assert.equal(verdict.detail, "an invalid address");
    assert.ok(!verdict.reason?.includes("<@"));
    assert.ok(!verdict.reason?.includes("123456789012345678"));
  });

  test("an allowlisted name in front of an @ does not pass for that site", () => {
    const settingsValue = withRule("links", { allowlist: ["youtube.com"] });
    const verdict = evaluateMessage(input({ content: "https://youtube.com@evil.example/x", settings: settingsValue }));
    assert.equal(verdict.triggered, true);
  });

  test("a link wrapped in brackets or emphasis is still read as the site it points to", () => {
    const settingsValue = withRule("links", { allowlist: ["youtube.com"] });
    for (const content of ["<https://youtube.com/x>", "(https://youtube.com)", "**https://youtube.com**", "[a](https://youtube.com/x)", "https://youtube.com."]) {
      assert.equal(evaluateMessage(input({ content, settings: settingsValue })).triggered, false, content);
    }
  });

  test("a port and an international name are valid hosts", () => {
    const settingsValue = withRule("links", { allowlist: ["münchen.de"] });
    assert.equal(evaluateMessage(input({ content: "https://münchen.de:8080/a", settings: settingsValue })).triggered, false);
  });
});

describe("allowlist entries pasted as whatever was copied", () => {
  test("a domain entry is reduced to its host", () => {
    for (const entry of ["https://youtube.com/", "http://www.youtube.com/watch?v=1", "youtube.com:443/x#top", "YouTube.com", " *.youtube.com ", "www.youtube.com."]) {
      assert.equal(normalizeDomainEntry(entry), "youtube.com", entry);
    }
  });

  test("a pasted URL entry allows the site", () => {
    const settingsValue = withRule("links", { allowlist: ["https://youtube.com/"] });
    assert.equal(evaluateMessage(input({ content: "https://youtube.com/watch?v=1", settings: settingsValue })).triggered, false);
    assert.equal(evaluateMessage(input({ content: "https://music.youtube.com/a", settings: settingsValue })).triggered, false);
    assert.equal(evaluateMessage(input({ content: "https://notyoutube.com/a", settings: settingsValue })).triggered, true);
  });

  test("an entry with nothing usable in it allows nothing", () => {
    const settingsValue = withRule("links", { allowlist: ["", "https://"] });
    assert.equal(evaluateMessage(input({ content: "https://a.example", settings: settingsValue })).triggered, true);
  });

  test("an invite entry drops a query string and fragment", () => {
    assert.equal(normalizeInviteEntry("https://discord.gg/Abc123?event=1"), "abc123");
    assert.equal(normalizeInviteEntry("discord.gg/abc123/#top"), "abc123");
    const settingsValue = withRule("invites", { allowlist: ["https://discord.gg/abc123?event=1"] });
    assert.equal(evaluateMessage(input({ content: "discord.gg/abc123", settings: settingsValue })).triggered, false);
  });
});

describe("banned words and punctuation, scripts and substrings", () => {
  const trips = (content, words) =>
    evaluateMessage(input({ content, settings: withRule("bannedWords", { words }) })).triggered;

  test("trailing punctuation does not hide a word", () => {
    assert.equal(trips("well damn!", ["damn"]), true);
    assert.equal(trips("what the ass!", ["ass"]), true);
    assert.equal(trips("DAMN!!!", ["damn"]), true);
  });

  test("a leetspeak spelling is still folded", () => {
    assert.equal(trips("d@mn it", ["damn"]), true);
    assert.equal(trips("you a55", ["ass"]), true);
  });

  test("words in other scripts match at their edges", () => {
    assert.equal(trips("ты блять", ["блять"]), true);
    assert.equal(trips("Это БЛЯТЬ!", ["блять"]), true);
    assert.equal(trips("проблятьство", ["блять"]), false);
  });

  test("accented words match, composed or not", () => {
    assert.equal(trips("quel connard!", ["connard"]), true);
    assert.equal(trips("café is closed", ["café"]), true);
    assert.equal(trips("the CAFÉ", ["café"]), true);
  });

  test("a word inside a longer word does not match", () => {
    assert.equal(trips("the assassin waited", ["ass"]), false);
    assert.equal(trips("Scunthorpe is a town", ["cunt"]), false);
    assert.equal(trips("classic", ["ass"]), false);
    assert.equal(trips("assess9", ["ass"]), false);
    assert.equal(trips("no-ass-here", ["ass"]), true, "a hyphen is an edge");
  });

  test("a phrase with regex characters is matched literally", () => {
    assert.equal(trips("what (the) heck", ["(the)"]), true);
    assert.equal(trips("a.b", ["a.b"]), true);
    assert.equal(trips("axb", ["a.b"]), false);
  });
});

describe("threads", () => {
  test("a thread in an exempt channel is exempt too", () => {
    const settingsValue = { ...withRule("invites"), exemptChannels: ["channel-1"] };
    const content = "discord.gg/randomcode";
    assert.equal(evaluateMessage(input({ content, channelId: "thread-9", settings: settingsValue })).triggered, true);
    assert.equal(evaluateMessage(input({ content, channelId: "thread-9", parentChannelId: "channel-1", settings: settingsValue })).triggered, false);
  });

  test("a rule's own exempt channel covers its threads", () => {
    const settingsValue = withRule("invites", { exemptChannels: ["channel-1"] });
    const verdict = evaluateMessage(input({ content: "discord.gg/randomcode", channelId: "thread-9", parentChannelId: "channel-1", settings: settingsValue }));
    assert.equal(verdict.triggered, false);
  });
});

describe("edits", () => {
  test("an edit is not counted toward the rate limit", () => {
    const settingsValue = withRule("rateLimit", { limit: 2, window: 5_000, actions: ["delete"] });
    const history = [past("a", 998_000), past("b", 998_500), past("c", 999_000)];
    assert.equal(evaluateMessage(input({ now: 1_000_000, history, settings: settingsValue })).triggered, true);
    assert.equal(evaluateMessage(input({ now: 1_000_000, history, isEdit: true, settings: settingsValue })).triggered, false);
  });

  test("an edit is not another copy for repeated text, but a character wall still counts", () => {
    const settingsValue = withRule("repeatedText", { repeatMessageCount: 2, repeatWindow: 60_000 });
    const history = [past("buy my stuff", 999_000)];
    assert.equal(evaluateMessage(input({ content: "buy my stuff", now: 1_000_000, history, settings: settingsValue })).triggered, true);
    assert.equal(evaluateMessage(input({ content: "buy my stuff", now: 1_000_000, history, isEdit: true, settings: settingsValue })).triggered, false);
    assert.equal(evaluateMessage(input({ content: "aaaaaaaaaaaaaaaa", isEdit: true, settings: settingsValue })).triggered, true);
  });
});

describe("fingerprintOf", () => {
  test("is the same for text that differs only in case and spacing", () => {
    assert.equal(fingerprintOf("  Buy   My Stuff "), fingerprintOf("buy my stuff"));
    assert.notEqual(fingerprintOf("buy my stuff"), fingerprintOf("buy my stuf"));
  });

  test("stays short however long the message is", () => {
    assert.ok(fingerprintOf("x".repeat(100_000)).length <= 16);
  });
});
