import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_LIMITS } from "@tier0/core";
import { createTestDatabase } from "./db-helper.ts";

const db = createTestDatabase();
const { prisma } = await import("@tier0/db");
const { evidenceForTrip, loggedCopyOf } = await import("../dist/evidence.js");

after(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

const GUILD = "100000000000000050";
const CHANNEL = "100000000000000051";
const MESSAGE = "100000000000000052";
const AUTHOR = "100000000000000053";
const SENT = new Date("2030-01-01T10:00:00.000Z");
const NOW = new Date("2030-01-01T10:05:00.000Z");

const message = (patch: Record<string, unknown> = {}) => ({
  id: MESSAGE,
  channelId: CHANNEL,
  channelName: "general",
  content: "this has a badword in it",
  attachments: [],
  createdAt: SENT,
  ...patch,
});

const input = (patch: Record<string, unknown> = {}) => ({
  guildId: GUILD,
  message: message(),
  logged: null,
  previousContent: null,
  isEdit: false,
  deleted: true,
  now: NOW,
  ...patch,
});

/** What the server log holds for a message: its current text and the versions before it. */
function loggedRow(patch: Record<string, unknown> = {}) {
  return {
    id: 1,
    guildId: GUILD,
    messageId: MESSAGE,
    channelId: CHANNEL,
    channelName: "general",
    authorId: AUTHOR,
    authorName: "spamlord",
    content: "this has a badword in it",
    attachments: "[]",
    createdAt: SENT,
    editedAt: null,
    deletedAt: null,
    edits: [],
    ...patch,
  };
}

describe("the message automod keeps with a case", () => {
  test("is a copy with the text, channel name, link and the time it was sent", () => {
    const kept = evidenceForTrip(input() as never);
    assert.equal(kept.id, MESSAGE);
    assert.equal(kept.channelId, CHANNEL);
    assert.equal(kept.channelName, "general");
    assert.equal(kept.content, "this has a badword in it");
    assert.equal(kept.createdAt, SENT.toISOString());
    assert.equal(kept.url, `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`);
    assert.equal(kept.versions, undefined);
    assert.equal(kept.flagged, undefined);
  });

  test("is marked deleted, with when, if automod removed it", () => {
    const kept = evidenceForTrip(input({ deleted: true }) as never);
    assert.equal(kept.deleted, true);
    assert.equal(kept.deletedAt, NOW.toISOString());
  });

  test("is kept, not deleted, when the delete failed", () => {
    const kept = evidenceForTrip(input({ deleted: false }) as never);
    assert.equal(kept.deleted, false);
    assert.equal(kept.deletedAt, null);
    assert.equal(kept.content, "this has a badword in it");
  });

  test("keeps the time the server log saw it deleted, when someone else got there first", () => {
    const earlier = new Date("2030-01-01T10:04:00.000Z");
    const kept = evidenceForTrip(input({ logged: loggedRow({ deletedAt: earlier }) }) as never);
    assert.equal(kept.deletedAt, earlier.toISOString());
  });

  test("keeps what attachments there were, within the same limits as a moderator's", () => {
    const attachments = Array.from({ length: 8 }, (_, i) => ({ name: "n".repeat(300) + i, url: `https://cdn.example/${i}.png`, contentType: "image/png" }));
    const kept = evidenceForTrip(input({ message: message({ attachments }) }) as never);
    assert.equal(kept.attachments.length, EVIDENCE_LIMITS.attachments);
    assert.ok(kept.attachments.every((a) => a.name.length <= EVIDENCE_LIMITS.name));
  });

  test("clips a long text to the limit a moderator's copy has", () => {
    const kept = evidenceForTrip(input({ message: message({ content: "x".repeat(4000) }) }) as never);
    assert.equal(kept.content.length, EVIDENCE_LIMITS.content);
    assert.ok(kept.content.endsWith("…"));
  });

  test("keeps an edited message's earlier versions from the server log and flags the edit that broke the rule", () => {
    const row = loggedRow({
      content: "clean text",
      editedAt: new Date("2030-01-01T10:02:00.000Z"),
      edits: [{ id: 1, loggedId: 1, content: "hello", at: SENT }],
    });
    const kept = evidenceForTrip(input({ logged: row, isEdit: true, message: message({ content: "now with a badword" }) }) as never);
    assert.equal(kept.content, "now with a badword");
    assert.deepEqual(kept.versions?.map((v) => v.content), ["hello", "clean text", "now with a badword"]);
    assert.equal(kept.flagged, 2);
  });

  test("does not add a version twice when the server log already recorded the edit", () => {
    const row = loggedRow({
      content: "now with a badword",
      editedAt: new Date("2030-01-01T10:04:00.000Z"),
      edits: [{ id: 1, loggedId: 1, content: "hello", at: SENT }],
    });
    const kept = evidenceForTrip(input({ logged: row, isEdit: true, message: message({ content: "now with a badword" }) }) as never);
    assert.deepEqual(kept.versions?.map((v) => v.content), ["hello", "now with a badword"]);
    assert.equal(kept.flagged, 1);
  });

  test("uses what Discord remembered of the old text when the log has nothing", () => {
    const kept = evidenceForTrip(input({ isEdit: true, previousContent: "hello", message: message({ content: "now with a badword" }) }) as never);
    assert.deepEqual(kept.versions?.map((v) => v.content), ["hello", "now with a badword"]);
    assert.equal(kept.flagged, 1);
  });

  test("is a single version, unflagged, when an edit has no history to show", () => {
    const kept = evidenceForTrip(input({ isEdit: true, previousContent: null }) as never);
    assert.equal(kept.versions, undefined);
    assert.equal(kept.flagged, undefined);
  });

  test("does not flag anything on a message that was never edited, even with the log's copy", () => {
    const kept = evidenceForTrip(input({ logged: loggedRow() }) as never);
    assert.equal(kept.versions, undefined);
    assert.equal(kept.flagged, undefined);
  });

  test("caps a long edit history at the same number of versions a moderator's copy keeps", () => {
    const edits = Array.from({ length: 60 }, (_, i) => ({ id: i, loggedId: 1, content: `v${i}`, at: new Date(SENT.getTime() + i * 1000) }));
    const kept = evidenceForTrip(input({ logged: loggedRow({ content: "v60", edits }), isEdit: true, message: message({ content: "v61" }) }) as never);
    assert.equal(kept.versions?.length, EVIDENCE_LIMITS.versions);
    assert.equal(kept.versions?.at(-1)?.content, "v61");
    assert.equal(kept.flagged, EVIDENCE_LIMITS.versions - 1);
  });

  test("uses the log's channel name when the message did not know it", () => {
    const kept = evidenceForTrip(input({ message: message({ channelName: "" }), logged: loggedRow({ channelName: "from-the-log" }) }) as never);
    assert.equal(kept.channelName, "from-the-log");
  });
});

describe("the server log's copy of a message", () => {
  test("is read from the database, and is null for a message it never saw", async () => {
    await prisma.guild.create({ data: { id: GUILD, name: "Evidence test guild" } });
    await prisma.loggedMessage.create({
      data: {
        guildId: GUILD,
        messageId: MESSAGE,
        channelId: CHANNEL,
        channelName: "general",
        authorId: AUTHOR,
        authorName: "spamlord",
        content: "hello",
        createdAt: SENT,
        edits: { create: { content: "hi", at: SENT } },
      },
    });
    const row = await loggedCopyOf(GUILD, MESSAGE);
    assert.equal(row?.content, "hello");
    assert.equal(row?.edits.length, 1);
    assert.equal(await loggedCopyOf(GUILD, "100000000000000099"), null);
  });
});
