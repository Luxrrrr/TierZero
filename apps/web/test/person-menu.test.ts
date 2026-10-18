import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ActionTargetDto, StaffRole } from "@tier0/core";
import { actionOptions, memberState } from "../app/guilds/[id]/mod/members/[userId]/actions.ts";
import {
  APP_HINT,
  CHECKING_HINT,
  caseHref,
  discordProfileUrl,
  isMenuUser,
  menuName,
  messageEntries,
  messageEvidence,
  messageLink,
  personEntries,
  profileHref,
  reasonWithMessageLink,
  type MenuEntry,
  type MenuUser,
} from "../lib/person-menu.ts";

const GUILD = "111111111111111111";
const USER_ID = "222222222222222222";
const CHANNEL = "333333333333333333";
const MESSAGE = "444444444444444444";
const NOW = new Date("2026-10-18T12:00:00Z");

const person: MenuUser = { userId: USER_ID, name: "Priya", inServer: true };

function standing(overrides: Partial<ActionTargetDto> = {}): ActionTargetDto {
  return { inServer: true, banned: false, timedOutUntil: null, blocked: {}, ...overrides };
}

/** The options the provider computes once the bot has answered. */
function optionsFor(role: StaffRole, answer: ActionTargetDto | null, switchedOff: Parameters<typeof actionOptions>[2] = []) {
  const state = memberState({ user: { inServer: person.inServer }, infractions: [] }, NOW, answer);
  return actionOptions(role, state, switchedOff, answer?.blocked ?? {});
}

const ids = (entries: MenuEntry[]) => entries.map((entry) => entry.id);
const byId = (entries: MenuEntry[], id: string) => entries.find((entry) => entry.id === id);

describe("personEntries", () => {
  test("someone without a moderation role gets only the plain entries", () => {
    const entries = personEntries({ guildId: GUILD, role: null, user: person, options: null });
    assert.deepEqual(ids(entries), ["copy-id", "discord"]);
    assert.ok(entries.every((entry) => !entry.disabled));
  });

  test("an admin is offered the profile, every action, then copy and open", () => {
    const entries = personEntries({ guildId: GUILD, role: "admin", user: person, options: optionsFor("admin", standing()) });
    assert.deepEqual(ids(entries), ["profile", "action:warn", "action:timeout", "action:kick", "action:ban", "copy-id", "discord"]);
    assert.ok(entries.every((entry) => !entry.disabled));
    assert.deepEqual(
      entries.filter((entry) => entry.separated).map((entry) => entry.id),
      ["action:warn", "copy-id"],
    );
  });

  test("a moderator is not offered kick or ban, and an unban never appears for them", () => {
    const entries = personEntries({ guildId: GUILD, role: "mod", user: person, options: optionsFor("mod", standing({ banned: true })) });
    assert.deepEqual(ids(entries).filter((id) => id.startsWith("action:")), ["action:warn", "action:timeout"]);
  });

  test("kick and ban are the heavy ones", () => {
    const entries = personEntries({ guildId: GUILD, role: "owner", user: person, options: optionsFor("owner", standing()) });
    assert.deepEqual(entries.filter((entry) => entry.danger).map((entry) => entry.id), ["action:kick", "action:ban"]);
  });

  test("a banned member offers unban in place of ban, to those who may", () => {
    const entries = personEntries({ guildId: GUILD, role: "admin", user: person, options: optionsFor("admin", standing({ inServer: false, banned: true })) });
    assert.ok(byId(entries, "action:unban"));
    assert.equal(byId(entries, "action:ban"), undefined);
  });

  test("a timed out member offers a changed timeout and a clear", () => {
    const entries = personEntries({
      guildId: GUILD,
      role: "mod",
      user: person,
      options: optionsFor("mod", standing({ timedOutUntil: "2026-10-18T13:00:00Z" })),
    });
    assert.equal(byId(entries, "action:timeout")?.label, "Change timeout");
    assert.ok(byId(entries, "action:timeout-clear"));
  });

  test("an action the bot would refuse stays listed, greyed out, with the bot's reason", () => {
    const reason = "You can't act on yourself.";
    const entries = personEntries({
      guildId: GUILD,
      role: "admin",
      user: person,
      options: optionsFor("admin", standing({ blocked: { ban: reason, kick: "Their role is above yours." } })),
    });
    const ban = byId(entries, "action:ban");
    assert.equal(ban?.disabled, true);
    assert.equal(ban?.hint, reason);
    assert.equal(byId(entries, "action:kick")?.hint, "Their role is above yours.");
    assert.equal(byId(entries, "action:warn")?.disabled, false);
  });

  test("someone who has left cannot be kicked or timed out, but can be warned and banned", () => {
    const entries = personEntries({ guildId: GUILD, role: "admin", user: { ...person, inServer: false }, options: optionsFor("admin", standing({ inServer: false })) });
    assert.equal(byId(entries, "action:kick")?.disabled, true);
    assert.match(byId(entries, "action:kick")?.hint ?? "", /out of the server/);
    assert.equal(byId(entries, "action:timeout")?.disabled, true);
    assert.equal(byId(entries, "action:warn")?.disabled, false);
    assert.equal(byId(entries, "action:ban")?.disabled, false);
  });

  test("an action switched off for the server is left out", () => {
    const entries = personEntries({ guildId: GUILD, role: "admin", user: person, options: optionsFor("admin", standing(), ["ban", "kick"]) });
    assert.deepEqual(ids(entries).filter((id) => id.startsWith("action:")), ["action:warn", "action:timeout"]);
  });

  test("before the bot has answered, only what the role may do is listed, all greyed out", () => {
    const admin = personEntries({ guildId: GUILD, role: "admin", user: person, options: null });
    assert.deepEqual(ids(admin).filter((id) => id.startsWith("action:")), ["action:warn", "action:timeout", "action:kick", "action:ban"]);
    assert.ok(admin.filter((entry) => entry.id.startsWith("action:")).every((entry) => entry.disabled && entry.hint === CHECKING_HINT));
    assert.ok(!byId(admin, "copy-id")?.disabled);

    const mod = personEntries({ guildId: GUILD, role: "mod", user: person, options: null });
    assert.deepEqual(ids(mod).filter((id) => id.startsWith("action:")), ["action:warn", "action:timeout"]);
  });

  test("an app or webhook is never offered a profile, and its actions stay greyed out", () => {
    const entries = personEntries({ guildId: GUILD, role: "owner", user: { ...person, app: true }, options: optionsFor("owner", standing()) });
    assert.equal(byId(entries, "profile"), undefined);
    const actions = entries.filter((entry) => entry.id.startsWith("action:"));
    assert.equal(actions.length, 4);
    assert.ok(actions.every((entry) => entry.disabled && entry.hint === APP_HINT));
  });

  test("the profile and the Discord link point where they say", () => {
    const entries = personEntries({ guildId: GUILD, role: "mod", user: person, options: null });
    assert.deepEqual(byId(entries, "profile")?.effect, { type: "href", href: `/guilds/${GUILD}/mod/members/${USER_ID}`, external: false });
    assert.deepEqual(byId(entries, "discord")?.effect, { type: "href", href: `https://discord.com/users/${USER_ID}`, external: true });
    assert.deepEqual(byId(entries, "copy-id")?.effect, { type: "copy", text: USER_ID, done: "Copied the user ID." });
  });
});

describe("messageEntries", () => {
  const message = { channelId: CHANNEL, messageId: MESSAGE, content: "buy my stuff" };

  test("an admin may act on the author, then copy the message, then see the author", () => {
    const entries = messageEntries({ guildId: GUILD, role: "admin", user: person, options: optionsFor("admin", standing()), message });
    assert.deepEqual(ids(entries), ["action:warn", "action:timeout", "action:kick", "action:ban", "copy-text", "copy-link", "profile", "copy-id"]);
    assert.deepEqual(
      entries.filter((entry) => entry.id.startsWith("action:")).map((entry) => entry.label),
      ["Warn author", "Timeout author", "Kick author", "Ban author"],
    );
    assert.deepEqual(
      entries.filter((entry) => entry.separated).map((entry) => entry.id),
      ["copy-text", "profile"],
    );
  });

  test("unban and clearing a timeout are not message actions", () => {
    const banned = messageEntries({ guildId: GUILD, role: "owner", user: person, options: optionsFor("owner", standing({ banned: true, inServer: false })), message });
    assert.equal(byId(banned, "action:unban"), undefined);
    const timedOut = messageEntries({ guildId: GUILD, role: "owner", user: person, options: optionsFor("owner", standing({ timedOutUntil: "2026-10-18T13:00:00Z" })), message });
    assert.equal(byId(timedOut, "action:timeout-clear"), undefined);
    assert.equal(byId(timedOut, "action:timeout")?.label, "Change author’s timeout");
  });

  test("a moderator gets warn and timeout only", () => {
    const entries = messageEntries({ guildId: GUILD, role: "mod", user: person, options: optionsFor("mod", standing()), message });
    assert.deepEqual(ids(entries).filter((id) => id.startsWith("action:")), ["action:warn", "action:timeout"]);
  });

  test("the copied link is the message's Discord link", () => {
    const entries = messageEntries({ guildId: GUILD, role: "admin", user: person, options: null, message });
    assert.deepEqual(byId(entries, "copy-link")?.effect, {
      type: "copy",
      text: `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`,
      done: "Copied the message link.",
    });
    assert.equal(byId(entries, "copy-text")?.effect.type === "copy" && byId(entries, "copy-text")?.effect.text, "buy my stuff");
  });

  test("a message with no text cannot have its text copied, and says why", () => {
    const entries = messageEntries({ guildId: GUILD, role: "admin", user: person, options: null, message: { ...message, content: "  " } });
    assert.equal(byId(entries, "copy-text")?.disabled, true);
    assert.match(byId(entries, "copy-text")?.hint ?? "", /no text/);
    assert.equal(byId(entries, "copy-link")?.disabled, false);
  });

  test("without a moderation role there are no actions and no profile", () => {
    const entries = messageEntries({ guildId: GUILD, role: null, user: person, options: null, message });
    assert.deepEqual(ids(entries), ["copy-text", "copy-link", "copy-id"]);
  });

  test("an app's messages can be copied but their author is not acted on", () => {
    const entries = messageEntries({ guildId: GUILD, role: "admin", user: { ...person, app: true }, options: null, message });
    assert.equal(byId(entries, "profile"), undefined);
    assert.ok(entries.filter((entry) => entry.id.startsWith("action:")).every((entry) => entry.disabled && entry.hint === APP_HINT));
    assert.ok(byId(entries, "copy-link"));
  });
});

describe("links and evidence", () => {
  test("a message is attached as the pair the bot copies", () => {
    assert.deepEqual(messageEvidence({ channelId: CHANNEL, messageId: MESSAGE }), [{ channelId: CHANNEL, messageId: MESSAGE }]);
  });

  test("the message link matches what Discord copies", () => {
    assert.equal(messageLink(GUILD, CHANNEL, MESSAGE), `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`);
  });

  test("the case link opens the case on the member's record", () => {
    assert.equal(caseHref(GUILD, USER_ID, 61), `/guilds/${GUILD}/mod/members/${USER_ID}?case=61`);
    assert.equal(profileHref(GUILD, USER_ID), `/guilds/${GUILD}/mod/members/${USER_ID}`);
    assert.equal(discordProfileUrl(USER_ID), `https://discord.com/users/${USER_ID}`);
  });

  test("the link goes on its own line under what was typed", () => {
    const link = messageLink(GUILD, CHANNEL, MESSAGE);
    assert.equal(reasonWithMessageLink("Spamming invites", link), `Spamming invites\nMessage: ${link}`);
    assert.equal(reasonWithMessageLink("  ", link), `Message: ${link}`);
  });

  test("the typed reason is cut to keep the link whole inside the limit", () => {
    const link = messageLink(GUILD, CHANNEL, MESSAGE);
    const result = reasonWithMessageLink("x".repeat(600), link, 500);
    assert.ok(result.length <= 500);
    assert.ok(result.endsWith(`\nMessage: ${link}`));
  });

  test("names fall back to the end of the id", () => {
    assert.equal(menuName({ userId: USER_ID, name: "Priya" }), "Priya");
    assert.equal(menuName({ userId: USER_ID, name: null }), "User 2222");
  });

  test("automod and ids that are not Discord users get no menu", () => {
    assert.equal(isMenuUser({ userId: USER_ID }), true);
    assert.equal(isMenuUser({ userId: USER_ID, automod: true }), false);
    assert.equal(isMenuUser({ userId: "automod" }), false);
    assert.equal(isMenuUser({ userId: "" }), false);
  });
});
