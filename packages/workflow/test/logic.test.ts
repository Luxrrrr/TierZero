import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { plainReply } from "@tier0/core";
import { COMMAND_NAME, Cooldowns, OPTION_NAME, RateLimit, VARIABLE_NAME, check, compare, defuse, matchesMessage, rolesIn, sameEmoji } from "../dist/logic.js";

describe("matching a message", () => {
  test("anywhere in it, ignoring capitals", () => {
    assert.equal(matchesMessage("Hello THERE friend", ["there"], "contains"), true);
    assert.equal(matchesMessage("Hello", ["bye"], "contains"), false);
  });

  test("as a whole word, so a word inside another does not count", () => {
    assert.equal(matchesMessage("a classic", ["ass"], "word"), false);
    assert.equal(matchesMessage("an ass.", ["ass"], "word"), true);
    assert.equal(matchesMessage("café au lait", ["café"], "word"), true);
  });

  test("at the start, or as the whole message", () => {
    assert.equal(matchesMessage("!rules please", ["!rules"], "start"), true);
    assert.equal(matchesMessage("please !rules", ["!rules"], "start"), false);
    assert.equal(matchesMessage("  Ping ", ["ping"], "exact"), true);
    assert.equal(matchesMessage("ping me", ["ping"], "exact"), false);
  });

  test("treats a phrase as plain text, never as a pattern", () => {
    assert.equal(matchesMessage("what (now)?", ["(now)?"], "word"), true);
    assert.equal(matchesMessage("now", ["(now)?"], "word"), false);
    assert.equal(matchesMessage("anything", [".*"], "contains"), false);
  });

  test("an empty message or an empty phrase matches nothing", () => {
    assert.equal(matchesMessage("", ["a"], "contains"), false);
    assert.equal(matchesMessage("hi", ["", "  "], "contains"), false);
  });
});

describe("the checks", () => {
  const open = { onlyChannels: [], onlyRoles: [], exceptRoles: [], chance: 100 };
  const where = { channelIds: ["thread", "parent", "category"], roleIds: ["a"] };

  test("let anyone through when nothing is set", () => {
    assert.deepEqual(check(open, where, 99), { ok: true });
  });

  test("a channel covers the threads and the category above it", () => {
    assert.deepEqual(check({ ...open, onlyChannels: ["category"] }, where, 0), { ok: true });
    assert.deepEqual(check({ ...open, onlyChannels: ["elsewhere"] }, where, 0), { ok: false, reason: "channel" });
  });

  test("roles are needed, or refused", () => {
    assert.deepEqual(check({ ...open, onlyRoles: ["b"] }, where, 0), { ok: false, reason: "role" });
    assert.deepEqual(check({ ...open, onlyRoles: ["b", "a"] }, where, 0), { ok: true });
    assert.deepEqual(check({ ...open, exceptRoles: ["a"] }, where, 0), { ok: false, reason: "except" });
  });

  test("the chance is a percentage of rolls under it", () => {
    assert.deepEqual(check({ ...open, chance: 100 }, where, 99), { ok: true });
    assert.deepEqual(check({ ...open, chance: 30 }, where, 29), { ok: true });
    assert.deepEqual(check({ ...open, chance: 30 }, where, 30), { ok: false, reason: "chance" });
  });
});

describe("waits and limits", () => {
  test("a member waits out the time and then goes again", () => {
    const waits = new Cooldowns();
    assert.equal(waits.left("a:1", 10_000, 0), 0);
    waits.mark("a:1", 0);
    assert.equal(waits.left("a:1", 10_000, 4_000), 6_000);
    assert.equal(waits.left("a:1", 10_000, 10_000), 0);
    assert.equal(waits.left("a:2", 10_000, 4_000), 0);
  });

  test("no wait set means no wait", () => {
    const waits = new Cooldowns();
    waits.mark("a:1", 0);
    assert.equal(waits.left("a:1", 0, 1), 0);
  });

  test("a rate limit lets a number through in a window and then starts again", () => {
    const limit = new RateLimit(2, 1_000);
    assert.equal(limit.allow("g", 0), true);
    assert.equal(limit.allow("g", 100), true);
    assert.equal(limit.allow("g", 200), false);
    assert.equal(limit.allow("other", 200), true);
    assert.equal(limit.allow("g", 1_100), true);
  });
});

describe("text a member wrote", () => {
  test("cannot mention everyone, here or a role", () => {
    const text = defuse("hi @everyone @HERE <@&123456789012345678> <@1234> <@!99>");
    assert.ok(!/@everyone|@here/i.test(text));
    assert.ok(!/<@[&!]?\d/.test(text));
    assert.ok(text.includes("everyone"));
  });

  test("leaves everything else as it was", () => {
    assert.equal(defuse("hello, world! 100% sure"), "hello, world! 100% sure");
  });
});

describe("the roles an owner's message pings", () => {
  test("are the ones written in it, once each", () => {
    const body = { ...plainReply("<@&111111111111111111> hi"), embeds: [{ ...plainReply("").embeds[0], description: "<@&222222222222222222> <@&111111111111111111>" }] } as never;
    assert.deepEqual(rolesIn(body).sort(), ["111111111111111111", "222222222222222222"]);
  });

  test("are none when it names none", () => {
    assert.deepEqual(rolesIn(plainReply("hello @everyone")), []);
  });
});

describe("emoji", () => {
  test("a plain emoji matches by itself", () => {
    assert.equal(sameEmoji("🎉", { id: null, name: "🎉" }), true);
    assert.equal(sameEmoji("🎉", { id: null, name: "🔥" }), false);
  });

  test("a custom emoji matches by its id, whatever its name has become", () => {
    assert.equal(sameEmoji("<:party:123456789012345678>", { id: "123456789012345678", name: "renamed" }), true);
    assert.equal(sameEmoji("<a:party:123456789012345678>", { id: "123456789012345678", name: "party" }), true);
    assert.equal(sameEmoji("<:party:123456789012345678>", { id: "9", name: "party" }), false);
  });
});

describe("names", () => {
  test("a command is lowercase letters, numbers, - and _", () => {
    assert.ok(COMMAND_NAME.test.test("rules"));
    assert.ok(COMMAND_NAME.test.test("server-info_2"));
    assert.ok(!COMMAND_NAME.test.test("Rules"));
    assert.ok(!COMMAND_NAME.test.test("two words"));
    assert.ok(!COMMAND_NAME.test.test("x".repeat(33)));
    assert.ok(!COMMAND_NAME.test.test(""));
  });

  test("an option cannot hold a hyphen, so it works as a {variable}", () => {
    assert.ok(OPTION_NAME.test.test("target_user"));
    assert.ok(!OPTION_NAME.test.test("target-user"));
  });
});

describe("comparing a counter", () => {
  test("each way of comparing", () => {
    assert.equal(compare(5, "equals", 5), true);
    assert.equal(compare(5, "notEquals", 5), false);
    assert.equal(compare(5, "greater", 4), true);
    assert.equal(compare(5, "greater", 5), false);
    assert.equal(compare(5, "atLeast", 5), true);
    assert.equal(compare(5, "less", 6), true);
    assert.equal(compare(5, "atMost", 4), false);
  });
});

describe("a counter's name", () => {
  test("works as a {variable}", () => {
    assert.ok(VARIABLE_NAME.test.test("wins"));
    assert.ok(VARIABLE_NAME.test.test("streak_2"));
    assert.ok(!VARIABLE_NAME.test.test("Wins"));
    assert.ok(!VARIABLE_NAME.test.test("2fast"));
    assert.ok(!VARIABLE_NAME.test.test("two-words"));
  });

  test("cannot be a name a message already fills in", () => {
    for (const name of ["user", "channel", "message", "server", "role", "emoji"]) assert.ok(!VARIABLE_NAME.test.test(name), name);
    assert.ok(VARIABLE_NAME.test.test("users"));
  });
});
