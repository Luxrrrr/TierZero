import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { INVITE_PERMISSIONS, INVITE_PERMISSION_BITS, missingInvitePermissions, missingPermissions, permissionLabel } from "../lib/invite.ts";

/** Discord's documented bit positions, from the developer documentation's permissions table. */
const DOCUMENTED: Record<string, number> = {
  KickMembers: 1,
  BanMembers: 2,
  ManageChannels: 4,
  AddReactions: 6,
  ViewAuditLog: 7,
  ViewChannel: 10,
  SendMessages: 11,
  ManageMessages: 13,
  EmbedLinks: 14,
  AttachFiles: 15,
  ReadMessageHistory: 16,
  MentionEveryone: 17,
  UseExternalEmojis: 18,
  Connect: 20,
  MoveMembers: 24,
  ManageRoles: 28,
  ManageWebhooks: 29,
  ManageThreads: 34,
  CreatePublicThreads: 35,
  CreatePrivateThreads: 36,
  SendMessagesInThreads: 38,
  ModerateMembers: 40,
};

describe("the invite link's permissions", () => {
  test("each one sits at Discord's documented bit", () => {
    for (const [name, bit] of Object.entries(INVITE_PERMISSION_BITS)) {
      assert.equal(bit, 1n << BigInt(DOCUMENTED[name] ?? -1), name);
    }
  });

  test("the number is exactly those bits", () => {
    assert.equal(INVITE_PERMISSIONS, "1495472270550");
  });

  test("asks for what the features use beyond the basics", () => {
    for (const name of ["ManageWebhooks", "CreatePrivateThreads", "CreatePublicThreads", "MentionEveryone", "UseExternalEmojis"]) {
      assert.ok(name in INVITE_PERMISSION_BITS, name);
    }
  });

  test("never asks for Administrator", () => {
    assert.equal(BigInt(INVITE_PERMISSIONS) & 8n, 0n);
  });
});

describe("missingPermissions", () => {
  test("names what a feature needs and the bot lacks", () => {
    assert.deepEqual(missingPermissions(["ManageChannels", "ManageRoles"], ["ManageRoles"]), ["ManageChannels"]);
  });

  test("Administrator covers everything", () => {
    assert.deepEqual(missingPermissions(["ManageChannels"], ["Administrator"]), []);
  });

  test("unknown permissions are not the same as none missing", () => {
    assert.equal(missingPermissions(["ManageChannels"], null), null);
  });
});

describe("permissionLabel", () => {
  test("reads the way Discord's settings write it", () => {
    assert.equal(permissionLabel("ManageChannels"), "Manage Channels");
    assert.equal(permissionLabel("ModerateMembers"), "Timeout Members");
    assert.equal(permissionLabel("ViewAuditLog"), "View Audit Log");
  });
});

describe("missingInvitePermissions", () => {
  test("lists what the invite asks for and the bot lacks, in the invite's order", () => {
    const all = Object.keys(INVITE_PERMISSION_BITS);
    const has = all.filter((name) => name !== "ManageWebhooks" && name !== "CreatePrivateThreads");
    assert.deepEqual(missingInvitePermissions(has), ["ManageWebhooks", "CreatePrivateThreads"]);
    assert.deepEqual(missingInvitePermissions(all), []);
  });

  test("Administrator covers all of it, and unknown permissions are not read as complete", () => {
    assert.deepEqual(missingInvitePermissions(["Administrator"]), []);
    assert.equal(missingInvitePermissions(null), null);
  });
});
