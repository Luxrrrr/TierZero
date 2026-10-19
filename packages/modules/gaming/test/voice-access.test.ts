import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { overwriteSteps } from "../dist/voice.js";

const BOT = "500000000000000001";
const OWNER = "510000000000000001";
const ROLE = "520000000000000001";

const ALL = Object.values(PermissionFlagsBits).reduce((sum, bit) => sum | bit, 0n);

function guild(held: bigint) {
  return { members: { me: { id: BOT, permissions: { bitfield: held } } } } as never;
}

function category(entries: { id: string; type: 0 | 1; allow: bigint; deny: bigint }[]) {
  return { permissionOverwrites: { cache: new Map(entries.map((entry) => [entry.id, { id: entry.id, type: entry.type, allow: { bitfield: entry.allow }, deny: { bitfield: entry.deny } }])) } } as never;
}

type Entry = { id: string; type: number; allow: bigint; deny: bigint };
const entryFor = (step: unknown[], id: string) => (step as Entry[]).find((entry) => entry.id === id);

describe("the access a new room is made with", () => {
  test("starts from the category's own overwrites, so its restrictions still apply", () => {
    const parent = category([{ id: ROLE, type: 0, allow: 0n, deny: PermissionFlagsBits.ViewChannel }]);
    const [full] = overwriteSteps(guild(ALL), parent, OWNER);
    assert.deepEqual(entryFor(full ?? [], ROLE), { id: ROLE, type: 0, allow: 0n, deny: PermissionFlagsBits.ViewChannel });
  });

  test("gives the owner management of the room and the bot what it needs to look after it", () => {
    const [full] = overwriteSteps(guild(ALL), null, OWNER);
    const owner = entryFor(full ?? [], OWNER);
    assert.equal(owner?.type, 1);
    assert.ok((owner?.allow ?? 0n) & PermissionFlagsBits.ManageChannels);
    assert.ok((owner?.allow ?? 0n) & PermissionFlagsBits.MoveMembers);
    const bot = entryFor(full ?? [], BOT);
    assert.ok((bot?.allow ?? 0n) & PermissionFlagsBits.ManageChannels);
  });

  test("grants only what the bot itself holds, since Discord refuses the rest", () => {
    const held = ALL & ~PermissionFlagsBits.MoveMembers & ~PermissionFlagsBits.MuteMembers;
    const [full] = overwriteSteps(guild(held), null, OWNER);
    const owner = entryFor(full ?? [], OWNER);
    assert.equal((owner?.allow ?? 0n) & PermissionFlagsBits.MoveMembers, 0n);
    assert.equal((owner?.allow ?? 0n) & PermissionFlagsBits.MuteMembers, 0n);
    assert.ok((owner?.allow ?? 0n) & PermissionFlagsBits.Connect);
  });

  test("falls back to the owner without management, then to no extra access", () => {
    const parent = category([{ id: ROLE, type: 0, allow: 1n, deny: 0n }]);
    const [, reduced, bare] = overwriteSteps(guild(ALL), parent, OWNER);
    const owner = entryFor(reduced ?? [], OWNER);
    assert.equal((owner?.allow ?? 0n) & PermissionFlagsBits.ManageChannels, 0n);
    assert.ok((owner?.allow ?? 0n) & PermissionFlagsBits.Connect);
    assert.deepEqual(bare, [{ id: ROLE, type: 0, allow: 1n, deny: 0n }]);
  });

  test("an owner the category already names keeps what it gave them", () => {
    const parent = category([{ id: OWNER, type: 1, allow: PermissionFlagsBits.AttachFiles, deny: 0n }]);
    const [full] = overwriteSteps(guild(ALL), parent, OWNER);
    assert.ok((entryFor(full ?? [], OWNER)?.allow ?? 0n) & PermissionFlagsBits.AttachFiles);
    assert.equal((full ?? []).filter((entry) => (entry as Entry).id === OWNER).length, 1);
  });
});
