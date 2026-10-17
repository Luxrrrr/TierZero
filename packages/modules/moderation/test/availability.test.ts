import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BLOCKED_TEXT, blockedActions } from "../dist/availability.js";
import { checkTargetIdentity, targetIdentityCode } from "../dist/action-rules.js";

const ACTOR = "100000000000000001";
const TARGET = "100000000000000002";
const BOT = "100000000000000003";
const OWNER = "100000000000000004";

function input(over: Record<string, unknown> = {}) {
  return {
    targetId: TARGET,
    actorId: ACTOR,
    botId: BOT,
    ownerId: OWNER,
    actor: { topRole: 10, isServerOwner: false },
    actorIsInstanceOwner: false,
    target: { topRole: 5, moderatable: true, kickable: true, bannable: true },
    botTopRole: 20,
    ...over,
  } as Parameters<typeof blockedActions>[0];
}

describe("which actions the Take action menu greys out", () => {
  test("nothing for an ordinary member below both the moderator and the bot", () => {
    assert.deepEqual(blockedActions(input()), {});
  });

  test("everything on yourself, on the bot and on the server owner, with the same reason the bot refuses with", () => {
    for (const [targetId, reason] of [
      [ACTOR, BLOCKED_TEXT.targetSelf],
      [BOT, BLOCKED_TEXT.targetBot],
      [OWNER, BLOCKED_TEXT.targetOwner],
    ] as const) {
      const blocked = blockedActions(input({ targetId }));
      for (const kind of ["warn", "timeout", "timeout-clear", "kick", "ban", "unban"] as const) assert.equal(blocked[kind], reason, `${kind} on ${targetId}`);
    }
  });

  test("the menu and the action agree on identity, because they use the one rule", () => {
    assert.equal(targetIdentityCode(ACTOR, ACTOR, BOT, OWNER), "targetSelf");
    assert.equal(targetIdentityCode(BOT, ACTOR, BOT, OWNER), "targetBot");
    assert.equal(targetIdentityCode(OWNER, ACTOR, BOT, OWNER), "targetOwner");
    assert.equal(targetIdentityCode(TARGET, ACTOR, BOT, OWNER), null);
    assert.throws(() => checkTargetIdentity(OWNER, ACTOR, BOT, OWNER), { name: "ActionRefused" });
  });

  test("a higher-ranked member blocks every action for a moderator, warns included", () => {
    const blocked = blockedActions(input({ target: { topRole: 10, moderatable: true, kickable: true, bannable: true } }));
    assert.equal(blocked.warn, BLOCKED_TEXT.actorRank);
    assert.equal(blocked.timeout, BLOCKED_TEXT.actorRank);
    assert.equal(blocked.ban, BLOCKED_TEXT.actorRank);
    assert.equal(blocked.unban, undefined, "an unban has no member to weigh");
  });

  test("a member above the bot can still be warned, but not acted on in Discord", () => {
    const blocked = blockedActions(input({ actorIsInstanceOwner: true, actor: null, target: { topRole: 25, moderatable: false, kickable: false, bannable: false } }));
    assert.equal(blocked.warn, undefined);
    assert.equal(blocked.timeout, BLOCKED_TEXT.botRank);
    assert.equal(blocked.kick, BLOCKED_TEXT.botRank);
  });

  test("Discord's own refusal shows when ranks allow it but Discord does not", () => {
    const blocked = blockedActions(input({ target: { topRole: 5, moderatable: false, kickable: true, bannable: false } }));
    assert.equal(blocked.timeout, BLOCKED_TEXT.cannotActOn);
    assert.equal(blocked.ban, BLOCKED_TEXT.cannotActOn);
    assert.equal(blocked.kick, undefined);
  });

  test("someone who left can be warned, banned and unbanned, and nothing else", () => {
    const blocked = blockedActions(input({ target: null }));
    assert.deepEqual(Object.keys(blocked).sort(), ["kick", "timeout", "timeout-clear"]);
    assert.equal(blocked.kick, BLOCKED_TEXT.away);
  });

  test("a moderator who is not in the server can do nothing, unlike the install owner", () => {
    const outside = blockedActions(input({ actor: null }));
    assert.equal(outside.warn, BLOCKED_TEXT.notInServer);
    assert.deepEqual(blockedActions(input({ actor: null, actorIsInstanceOwner: true })), {});
  });
});
