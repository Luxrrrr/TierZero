import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { LOCK_PERMISSIONS, lockPatch, previousOf, readPrevious, restorePatch, shouldRemoveAfterRestore } from "../dist/lockdown.js";
import { JoinTracker } from "../dist/join-alert.js";

const bit = (name: (typeof LOCK_PERMISSIONS)[number]) => PermissionFlagsBits[name];
const all = LOCK_PERMISSIONS.reduce((sum, name) => sum | bit(name), 0n);

/** What Discord does with an edit: a true allows the bit, false denies it, null clears both. */
function applyEdit(current: { allow: bigint; deny: bigint } | null, patch: Record<string, boolean | null>) {
  let allow = current?.allow ?? 0n;
  let deny = current?.deny ?? 0n;
  for (const [name, value] of Object.entries(patch)) {
    const flag = PermissionFlagsBits[name as keyof typeof PermissionFlagsBits];
    allow &= ~flag;
    deny &= ~flag;
    if (value === true) allow |= flag;
    if (value === false) deny |= flag;
  }
  return { allow, deny };
}

describe("locking and restoring an overwrite", () => {
  test("the lock denies every locked permission and nothing else", () => {
    const patch = lockPatch();
    assert.deepEqual(Object.keys(patch), [...LOCK_PERMISSIONS]);
    assert.ok(Object.values(patch).every((value) => value === false));
    assert.ok(!(LOCK_PERMISSIONS as readonly string[]).includes("ViewChannel"));
    assert.ok(!(LOCK_PERMISSIONS as readonly string[]).includes("Connect"));
  });

  test("a channel with no @everyone overwrite goes back to having none", () => {
    const previous = previousOf(null);
    assert.equal(previous.had, false);
    const locked = applyEdit(null, lockPatch());
    assert.equal(locked.deny, all);
    const restored = applyEdit(locked, restorePatch(previous));
    assert.deepEqual(restored, { allow: 0n, deny: 0n });
    assert.equal(shouldRemoveAfterRestore(previous, restored), true);
  });

  test("permissions that were allowed, denied or unset come back exactly, and other bits are untouched", () => {
    const view = PermissionFlagsBits.ViewChannel;
    const attach = PermissionFlagsBits.AttachFiles;
    const before = {
      allow: bit("SendMessages") | bit("AddReactions") | view,
      deny: bit("CreatePublicThreads") | attach,
    };
    const previous = previousOf(before);
    assert.equal(previous.had, true);
    assert.equal(previous.bits.SendMessages, "allow");
    assert.equal(previous.bits.CreatePublicThreads, "deny");
    assert.equal(previous.bits.Speak, "unset");

    const locked = applyEdit(before, lockPatch());
    assert.equal(locked.deny & all, all);
    assert.equal(locked.allow & all, 0n);
    assert.equal(locked.allow & view, view);
    assert.equal(locked.deny & attach, attach);

    const restored = applyEdit(locked, restorePatch(previous));
    assert.deepEqual(restored, before);
    assert.equal(shouldRemoveAfterRestore(previous, restored), false);
  });

  test("a change staff made to another permission while locked survives the unlock", () => {
    const previous = previousOf(null);
    const locked = applyEdit(null, lockPatch());
    const edited = { allow: locked.allow | PermissionFlagsBits.EmbedLinks, deny: locked.deny };
    const restored = applyEdit(edited, restorePatch(previous));
    assert.equal(restored.allow, PermissionFlagsBits.EmbedLinks);
    assert.equal(shouldRemoveAfterRestore(previous, restored), false);
  });

  test("an overwrite that existed before is never removed", () => {
    const previous = previousOf({ allow: 0n, deny: 0n });
    assert.equal(previous.had, true);
    assert.equal(shouldRemoveAfterRestore(previous, { allow: 0n, deny: 0n }), false);
  });
});

describe("what is stored to survive a restart", () => {
  test("the stored text reads back to the same state", () => {
    const previous = previousOf({ allow: bit("SendMessages"), deny: bit("Speak") });
    assert.deepEqual(readPrevious(JSON.stringify(previous)), previous);
  });

  test("damaged text reads as nothing to restore, and a missing bit reads as unset", () => {
    assert.equal(readPrevious("not json"), null);
    assert.equal(readPrevious("{}"), null);
    assert.equal(readPrevious(JSON.stringify({ had: true })), null);
    const partial = readPrevious(JSON.stringify({ had: true, bits: { SendMessages: "allow" } }));
    assert.equal(partial?.bits.SendMessages, "allow");
    assert.equal(partial?.bits.Speak, "unset");
  });
});

describe("JoinTracker", () => {
  const rule = { joins: 5, windowMs: 30_000 };

  test("goes off when enough members join inside the window", () => {
    const tracker = new JoinTracker();
    const results = [0, 1, 2, 3, 4].map((i) => tracker.record("g", i * 1000, rule));
    assert.deepEqual(results, [false, false, false, false, true]);
  });

  test("members spread beyond the window do not set it off", () => {
    const tracker = new JoinTracker();
    const results = [0, 1, 2, 3, 4, 5, 6].map((i) => tracker.record("g", i * 20_000, rule));
    assert.ok(results.every((result) => !result));
  });

  test("goes off once for a burst, then stays quiet while it continues and for five minutes after", () => {
    const tracker = new JoinTracker();
    let fired = 0;
    for (let i = 0; i < 20; i += 1) if (tracker.record("g", i * 1000, rule)) fired += 1;
    assert.equal(fired, 1);
    // A second burst two minutes after the first ended is still inside the quiet time.
    const later = 19_000 + 120_000;
    let again = 0;
    for (let i = 0; i < 5; i += 1) if (tracker.record("g", later + i * 1000, rule)) again += 1;
    assert.equal(again, 0);
    // And one well after it goes off again.
    const muchLater = 19_000 + 20 * 60_000;
    let third = 0;
    for (let i = 0; i < 5; i += 1) if (tracker.record("g", muchLater + i * 1000, rule)) third += 1;
    assert.equal(third, 1);
  });

  test("servers are counted apart, and joins are counted with no rule at all", () => {
    const tracker = new JoinTracker();
    for (let i = 0; i < 4; i += 1) tracker.record("a", i, rule);
    assert.equal(tracker.record("b", 5, rule), false);
    tracker.record("c", 0, null);
    tracker.record("c", 1000, null);
    assert.equal(tracker.recent("c", 2000), 2);
    assert.equal(tracker.recent("c", 11 * 60_000), 0);
  });

  test("forgetting a server drops its count", () => {
    const tracker = new JoinTracker();
    tracker.record("g", 0, null);
    tracker.forget("g");
    assert.equal(tracker.recent("g", 1000), 0);
  });
});
