import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  TICKET_REPLY_FILES_BYTES_MAX,
  TICKET_REPLY_FILES_MAX,
  base64Bytes,
  canTicket,
  fillSavedReply,
  readTicketMembers,
  readTicketRename,
  readTicketReply,
  readTicketRequestClose,
  safeFileName,
  savedReplyValues,
  ticketAccess,
  ticketHealth,
  ticketHealthSummary,
  type TicketHealthFacts,
} from "../dist/index.js";

/**
 * The health rules counted once for every place that shows them, the panel
 * states that read Discord, Manage Channels as an admin, and the readers for
 * the routes and files the dashboard gained.
 */

const type = (id: string, extra: Partial<TicketHealthFacts["panels"][number]["types"][number]> = {}) => ({
  id,
  mode: "channel" as const,
  handlerCount: 1,
  categoryId: "c",
  categoryExists: true,
  categoryChildren: 0,
  ...extra,
});

const facts = (panels: TicketHealthFacts["panels"]): TicketHealthFacts => ({
  permissions: { manageChannels: true, manageWebhooks: true, manageThreads: true },
  panels,
});

const panel = (id: string, extra: Partial<TicketHealthFacts["panels"][number]> = {}, types = [type(`${id}-a`)]) => ({
  id,
  channelId: "ch",
  channelExists: true,
  posted: true,
  types,
  ...extra,
});

describe("ticket health", () => {
  test("one blocked type of several is some, not all", () => {
    const f = facts([panel("p", {}, [type("ok"), type("broken", { categoryExists: false })])]);
    const summary = ticketHealthSummary(f);
    assert.equal(summary.state, "someBlocked");
    assert.deepEqual(summary.blockedTypes, [{ panelId: "p", typeId: "broken", codes: ["categoryMissing"] }]);
    assert.equal(summary.totalTypes, 2);
  });

  test("nothing posted blocks every type, and the counts agree with and without the first-run steps", () => {
    const f = facts([panel("p", { posted: false }, [type("a"), type("b", { handlerCount: 0 })])]);
    const issues = ticketHealth(f);
    const summary = ticketHealthSummary(f, issues);
    assert.equal(summary.state, "allBlocked");
    assert.equal(summary.blocking + summary.warnings, issues.length);
    assert.equal(summary.blockingAfterFirstRun, 0);
    assert.equal(summary.warningsAfterFirstRun, 0);
    assert.ok(issues.filter((issue) => issue.firstRun).map((issue) => issue.code).includes("noPanelsPosted"));
  });

  test("Manage Channels missing only stops channel types", () => {
    const f = {
      ...facts([panel("p", {}, [type("channel"), type("thread", { mode: "thread", categoryId: null, categoryExists: false })])]),
      permissions: { manageChannels: false, manageWebhooks: true, manageThreads: true },
    };
    assert.deepEqual(
      ticketHealthSummary(f).blockedTypes.map((entry) => entry.typeId),
      ["channel"],
    );
  });

  test("a deleted message, changed settings, a move and a foreign emoji each have a code", () => {
    const issues = ticketHealth(
      facts([
        panel("gone", { messageMissing: true }),
        panel("changed", { changed: true }),
        panel("moved", { posted: false, liveChannelId: "old" }),
        panel("emoji", {}, [type("e", { emojiMissing: true })]),
      ]),
    );
    const codes = issues.map((issue) => `${issue.panelId}:${issue.code}`);
    assert.ok(codes.includes("gone:panelMessageMissing"));
    assert.ok(codes.includes("changed:panelChanged"));
    assert.ok(codes.includes("moved:panelMoved"));
    assert.ok(!codes.includes("moved:panelNotPosted"), "a panel still up elsewhere is not called unposted");
    assert.ok(codes.includes("emoji:typeEmojiMissing"));
    assert.ok(!issues.some((issue) => issue.code === "panelMessageMissing" && issue.blocking), "other panels are up");
  });

  test("a panel whose message was deleted stops tickets when it was the only one", () => {
    const issues = ticketHealth(facts([panel("only", { messageMissing: true })]));
    assert.ok(issues.some((issue) => issue.code === "noPanelsPosted"));
    assert.ok(issues.some((issue) => issue.code === "panelMessageMissing" && issue.blocking));
  });
});

describe("ticket access", () => {
  const settings = { adminRoleIds: [], types: [{ id: "support", handlerRoleIds: ["h"] }] };

  test("Manage Channels works every type like an admin role, and still cannot change settings", () => {
    const access = ticketAccess({ userId: "1", isManager: false, worksEveryType: true, roleIds: [] }, settings);
    assert.equal(access.level, "admin");
    assert.equal(canTicket(access, "settings"), false);
    assert.equal(canTicket(access, "reply", { typeId: "support", status: "open" }), true);
  });

  test("renaming and asking to close need an open ticket", () => {
    const access = ticketAccess({ userId: "1", isManager: false, roleIds: ["h"] }, settings);
    for (const permission of ["rename", "requestClose"] as const) {
      assert.equal(canTicket(access, permission, { typeId: "support", status: "open" }), true);
      assert.equal(canTicket(access, permission, { typeId: "support", status: "closed" }), false);
    }
  });
});

describe("reply files", () => {
  const file = (bytes: number, name = "clip.png") => ({ name, contentType: "image/png", data: Buffer.alloc(bytes, 1).toString("base64") });

  test("let a reply be only files, and keep their names safe", () => {
    const read = readTicketReply({ content: "  ", files: [file(10, "..\\maps/de_dust2.png")] });
    assert.ok(read.ok);
    assert.equal(read.ok && read.value.files?.[0]?.name, "de_dust2.png");
    assert.equal(safeFileName("\u0000"), "file");
  });

  test("are refused past Discord's count or size", () => {
    assert.equal(readTicketReply({ content: "x", files: Array.from({ length: TICKET_REPLY_FILES_MAX + 1 }, () => file(1)) }).ok, false);
    const big = readTicketReply({ content: "x", files: [file(TICKET_REPLY_FILES_BYTES_MAX + 1)] });
    assert.equal(big.ok, false);
    assert.equal(readTicketReply({ content: "x", files: [{ name: "a", contentType: null, data: "not base64!" }] }).ok, false);
    assert.equal(readTicketReply({ content: "x", files: [file(0)] }).ok, false);
  });

  test("are measured without being decoded", () => {
    assert.equal(base64Bytes(Buffer.alloc(1000).toString("base64")), 1000);
    assert.equal(base64Bytes(Buffer.alloc(1001).toString("base64")), 1001);
  });
});

describe("the new write bodies", () => {
  test("add a member by name, but remove only by id", () => {
    assert.deepEqual(readTicketMembers({ action: "add", name: "@FragMuffin" }), { ok: true, value: { action: "add", userId: "", name: "FragMuffin" } });
    assert.equal(readTicketMembers({ action: "remove", name: "FragMuffin" }).ok, false);
  });

  test("rename and request-close", () => {
    assert.deepEqual(readTicketRename({ name: " clutch-help " }), { ok: true, value: { name: "clutch-help" } });
    assert.equal(readTicketRename({ name: "" }).ok, false);
    assert.equal(readTicketRename({ name: "x".repeat(91) }).ok, false);
    assert.deepEqual(readTicketRequestClose({}), { ok: true, value: { reason: null } });
  });
});

describe("saved replies", () => {
  test("fill the same variables in Discord and the dashboard, and leave others as typed", () => {
    const values = savedReplyValues({ id: 900, number: 12, typeName: "Bug report", openerId: "111", channelId: "222" }, "333");
    assert.equal(fillSavedReply("GG {user}, #{number} ({type}) in {ticket} by {staff}. {server}", values), "GG <@111>, #12 (Bug report) in <#222> by <@333>. {server}");
    assert.equal(savedReplyValues({ id: 900, typeName: "", openerId: "1", channelId: "2" }, "3").number, "900");
  });
});
