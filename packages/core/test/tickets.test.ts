import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TICKET_FILTERS,
  LEGACY_TYPE_ID,
  TICKET_PERMISSIONS,
  TICKET_REPLY_MAX,
  canTicket,
  medianOf,
  parseTicketListFilters,
  readTicketAnswers,
  readTicketAttachments,
  readTicketClose,
  readTicketDetail,
  readTicketEmbeds,
  readTicketMembers,
  readTicketNote,
  readTicketPriority,
  readTicketReply,
  readTicketSentAs,
  ticketMessageFromRow,
  ticketStaffLine,
  readTicketTransfer,
  ticketAccess,
  ticketDashboardUrl,
  ticketHealth,
  ticketListQuery,
  ticketPermissions,
  type TicketAccessSettings,
  type TicketHealthFacts,
} from "../dist/tickets.js";

const ADMIN_ROLE = "100000000000000001";
const BILLING_ROLE = "100000000000000002";
const SUPPORT_ROLE = "100000000000000003";
const OTHER_ROLE = "100000000000000004";
const ME = "200000000000000001";
const SOMEONE = "200000000000000002";

const SETTINGS: TicketAccessSettings = {
  adminRoleIds: [ADMIN_ROLE],
  types: [
    { id: "billing", handlerRoleIds: [BILLING_ROLE] },
    { id: LEGACY_TYPE_ID, handlerRoleIds: [SUPPORT_ROLE] },
    { id: "appeals", handlerRoleIds: [SUPPORT_ROLE], claim: false },
  ],
  reopen: true,
};

const viewer = (roleIds: string[], isManager = false) => ({ userId: ME, isManager, roleIds });
const open = (typeId: string | null, claimedById: string | null = null) => ({ typeId, status: "open", claimedById });
const closed = (typeId: string | null, archived = true) => ({ typeId, status: "closed", archived });

describe("ticketAccess", () => {
  test("a manager handles every type", () => {
    const access = ticketAccess(viewer([], true), SETTINGS);
    assert.equal(access.level, "manager");
    assert.deepEqual(access.handledTypeIds, ["billing", LEGACY_TYPE_ID, "appeals"]);
  });

  test("an admin role sees every type without handling any", () => {
    const access = ticketAccess(viewer([ADMIN_ROLE]), SETTINGS);
    assert.equal(access.level, "admin");
    assert.deepEqual(access.handledTypeIds, ["billing", LEGACY_TYPE_ID, "appeals"]);
  });

  test("a handler gets the types whose roles they hold", () => {
    const access = ticketAccess(viewer([SUPPORT_ROLE]), SETTINGS);
    assert.equal(access.level, "handler");
    assert.deepEqual(access.handledTypeIds, [LEGACY_TYPE_ID, "appeals"]);
  });

  test("anyone else, the opener of a ticket included, gets nothing", () => {
    const access = ticketAccess(viewer([OTHER_ROLE]), SETTINGS);
    assert.equal(access.level, null);
    assert.deepEqual(access.handledTypeIds, []);
    assert.deepEqual(ticketPermissions(access), []);
    assert.deepEqual(ticketPermissions(access, open("billing")), []);
  });

  test("manager wins over admin, and admin over handler", () => {
    assert.equal(ticketAccess(viewer([ADMIN_ROLE, BILLING_ROLE], true), SETTINGS).level, "manager");
    assert.equal(ticketAccess(viewer([ADMIN_ROLE, BILLING_ROLE]), SETTINGS).level, "admin");
  });

  test("reopening follows the setting, and is on when it is not given", () => {
    assert.equal(ticketAccess(viewer([], true), { ...SETTINGS, reopen: false }).reopen, false);
    assert.equal(ticketAccess(viewer([], true), { adminRoleIds: [], types: [] }).reopen, true);
  });
});

describe("canTicket", () => {
  const manager = ticketAccess(viewer([], true), SETTINGS);
  const admin = ticketAccess(viewer([ADMIN_ROLE]), SETTINGS);
  const handler = ticketAccess(viewer([BILLING_ROLE]), SETTINGS);

  test("a manager can do everything to an open ticket that applies to one", () => {
    const allowed = ticketPermissions(manager, open("billing"));
    for (const permission of ["view", "reply", "claim", "priority", "note", "members", "transfer", "close", "stats", "settings"] as const) {
      assert.ok(allowed.includes(permission), permission);
    }
    assert.ok(!allowed.includes("reopen"), "an open ticket cannot be reopened");
    assert.ok(!allowed.includes("deleteTranscript"), "an open ticket has no finished transcript");
  });

  test("only a manager changes settings or deletes a transcript", () => {
    assert.equal(canTicket(manager, "settings"), true);
    assert.equal(canTicket(admin, "settings"), false);
    assert.equal(canTicket(handler, "settings"), false);
    assert.equal(canTicket(manager, "deleteTranscript", closed("billing")), true);
    assert.equal(canTicket(admin, "deleteTranscript", closed("billing")), false);
    assert.equal(canTicket(handler, "deleteTranscript", closed("billing")), false);
    assert.equal(canTicket(manager, "deleteTranscript"), true);
    assert.equal(canTicket(admin, "deleteTranscript"), false);
  });

  test("an admin role works every type's tickets", () => {
    for (const permission of ["view", "reply", "claim", "priority", "note", "members", "transfer", "close"] as const) {
      assert.equal(canTicket(admin, permission, open("billing")), true, permission);
      assert.equal(canTicket(admin, permission, open(LEGACY_TYPE_ID)), true, permission);
    }
  });

  test("a handler works only the types they handle", () => {
    assert.equal(canTicket(handler, "reply", open("billing")), true);
    assert.equal(canTicket(handler, "view", open(LEGACY_TYPE_ID)), false);
    assert.equal(canTicket(handler, "reply", open("appeals")), false);
    assert.equal(canTicket(handler, "view", closed("appeals")), false);
  });

  test("a ticket from before types belongs to the legacy type", () => {
    const support = ticketAccess(viewer([SUPPORT_ROLE]), SETTINGS);
    assert.equal(canTicket(support, "reply", open(null)), true);
    assert.equal(canTicket(handler, "view", open(null)), false);
  });

  test("a ticket whose type was removed is left to managers and admin roles", () => {
    assert.equal(canTicket(handler, "view", open("deleted")), false);
    assert.equal(canTicket(admin, "view", open("deleted")), true);
    assert.equal(canTicket(manager, "view", open("deleted")), true);
  });

  test("without a ticket, every level may open the workspace and its stats", () => {
    for (const access of [manager, admin, handler]) {
      assert.equal(canTicket(access, "view"), true);
      assert.equal(canTicket(access, "stats"), true);
      assert.equal(canTicket(access, "reply"), false);
    }
  });

  test("a closed ticket can be read and noted but not worked", () => {
    const ticket = closed("billing");
    assert.equal(canTicket(handler, "view", ticket), true);
    assert.equal(canTicket(handler, "note", ticket), true);
    for (const permission of ["reply", "claim", "unclaim", "priority", "members", "transfer", "close"] as const) {
      assert.equal(canTicket(manager, permission, ticket), false, permission);
    }
  });

  test("only a ticket whose channel was kept can be reopened, and only while reopening is on", () => {
    assert.equal(canTicket(handler, "reopen", closed("billing", true)), true);
    assert.equal(canTicket(handler, "reopen", closed("billing", false)), false);
    const noReopen = ticketAccess(viewer([BILLING_ROLE]), { ...SETTINGS, reopen: false });
    assert.equal(canTicket(noReopen, "reopen", closed("billing", true)), false);
    assert.equal(canTicket(handler, "reopen", open("billing")), false);
  });

  test("a handler cannot take over or drop someone else's claim; admins and managers can", () => {
    const theirs = open("billing", SOMEONE);
    assert.equal(canTicket(handler, "claim", theirs), false);
    assert.equal(canTicket(handler, "unclaim", theirs), false);
    assert.equal(canTicket(admin, "claim", theirs), true);
    assert.equal(canTicket(admin, "unclaim", theirs), true);
    assert.equal(canTicket(manager, "unclaim", theirs), true);
  });

  test("claiming and unclaiming follow who holds it", () => {
    assert.equal(canTicket(handler, "claim", open("billing")), true);
    assert.equal(canTicket(handler, "unclaim", open("billing")), false);
    const mine = open("billing", ME);
    assert.equal(canTicket(handler, "claim", mine), false);
    assert.equal(canTicket(handler, "unclaim", mine), true);
  });

  test("a type with claiming off cannot be claimed by anyone", () => {
    assert.equal(canTicket(manager, "claim", open("appeals")), false);
  });

  test("the claim lock keeps other handlers from replying, not admins or managers", () => {
    const locked = { ...SETTINGS, claimLock: true };
    const theirs = open("billing", SOMEONE);
    assert.equal(canTicket(ticketAccess(viewer([BILLING_ROLE]), locked), "reply", theirs), false);
    assert.equal(canTicket(ticketAccess(viewer([BILLING_ROLE]), locked), "reply", open("billing", ME)), true);
    assert.equal(canTicket(ticketAccess(viewer([ADMIN_ROLE]), locked), "reply", theirs), true);
    assert.equal(canTicket(ticketAccess(viewer([], true), locked), "reply", theirs), true);
    assert.equal(canTicket(handler, "reply", theirs), true, "without the lock a claim does not stop replies");
  });

  test("ticketPermissions lists only known permissions, in order", () => {
    const listed = ticketPermissions(manager, open("billing"));
    assert.deepEqual(listed, TICKET_PERMISSIONS.filter((permission) => listed.includes(permission)));
  });
});

describe("the list filters", () => {
  test("an empty query is the default inbox", () => {
    assert.deepEqual(parseTicketListFilters(new URLSearchParams()), DEFAULT_TICKET_FILTERS);
    assert.equal(ticketListQuery({}), "");
  });

  test("read every filter", () => {
    const filters = parseTicketListFilters(
      new URLSearchParams(
        "status=closed&type=billing,support&type=appeals&priority=urgent&claimed=me&opener=200000000000000002&q=+login+&sort=oldest&page=3&rating=4&handler=200000000000000001&from=2026-01-01&to=2026-02-01&after=77",
      ),
    );
    assert.deepEqual(filters, {
      status: "closed",
      typeIds: ["billing", "support", "appeals"],
      priority: "urgent",
      claimed: "me",
      openerId: SOMEONE,
      q: "login",
      sort: "oldest",
      page: 3,
      rating: 4,
      handlerId: ME,
      from: "2026-01-01",
      to: "2026-02-01",
      afterId: 77,
    });
  });

  test("fall back to the default for anything malformed", () => {
    const filters = parseTicketListFilters({
      status: "deleted",
      type: ["bad id!", "ok"],
      priority: "meh",
      claimed: "everyone",
      opener: "12",
      sort: "random",
      page: "-1",
      rating: "9",
      from: "yesterday",
      to: "2026-13-45",
    });
    assert.equal(filters.status, "open");
    assert.deepEqual(filters.typeIds, ["ok"]);
    assert.equal(filters.priority, null);
    assert.equal(filters.claimed, "anyone");
    assert.equal(filters.openerId, null);
    assert.equal(filters.sort, "activity");
    assert.equal(filters.page, 1);
    assert.equal(filters.rating, null);
    assert.equal(filters.from, null);
    assert.equal(filters.to, null);
  });

  test("cap the search text", () => {
    assert.equal(parseTicketListFilters({ q: "x".repeat(500) }).q.length, 200);
  });

  test("survive a round trip through the query string", () => {
    const filters = { ...DEFAULT_TICKET_FILTERS, status: "all" as const, typeIds: ["billing"], q: "refund", page: 2, rating: 5 };
    assert.deepEqual(parseTicketListFilters(new URLSearchParams(ticketListQuery(filters))), filters);
  });
});

describe("the stored JSON", () => {
  test("answers read back, and damage reads as none", () => {
    assert.deepEqual(readTicketAnswers('[{"label":"Order","value":"42"},{"label":5},"x"]'), [{ label: "Order", value: "42" }]);
    assert.deepEqual(readTicketAnswers("not json"), []);
    assert.deepEqual(readTicketAnswers(null), []);
    assert.deepEqual(readTicketAnswers('{"label":"x"}'), []);
  });

  test("attachments keep only what has a link", () => {
    assert.deepEqual(readTicketAttachments('[{"name":"a.png","url":"https://cdn/a.png","contentType":"image/png","size":10},{"name":"b"}]'), [
      { name: "a.png", url: "https://cdn/a.png", contentType: "image/png", size: 10 },
    ]);
    assert.deepEqual(readTicketAttachments('[{"url":"https://cdn/x"}]'), [{ name: "file", url: "https://cdn/x", contentType: null, size: 0 }]);
  });

  test("an embed stored before full embeds were kept reads with the rest empty, and empty ones drop", () => {
    assert.deepEqual(readTicketEmbeds('[{"title":"T","description":"D"},{}]'), [
      {
        type: "rich",
        title: "T",
        description: "D",
        url: null,
        color: null,
        author: null,
        provider: null,
        fields: [],
        thumbnailUrl: null,
        imageUrl: null,
        footer: null,
        timestamp: null,
      },
    ]);
  });

  test("a full embed keeps what Discord drew and nothing unsafe", () => {
    const [embed] = readTicketEmbeds(
      JSON.stringify([
        {
          title: "Match report",
          url: "javascript:alert(1)",
          color: 0x5865f2,
          author: { name: "Scoreboard", iconUrl: "https://cdn.discordapp.com/a.png" },
          fields: [{ name: "Kills", value: "12", inline: true }, { name: "", value: "" }],
          imageUrl: "data:image/png;base64,AAAA",
          footer: { text: "Season 14" },
          timestamp: "2026-10-14T18:00:00Z",
        },
      ]),
    );
    assert.equal(embed?.url, null);
    assert.equal(embed?.imageUrl, null);
    assert.equal(embed?.color, 0x5865f2);
    assert.deepEqual(embed?.fields, [{ name: "Kills", value: "12", inline: true }]);
    assert.deepEqual(embed?.author, { name: "Scoreboard", url: null, iconUrl: "https://cdn.discordapp.com/a.png" });
    assert.equal(embed?.timestamp, "2026-10-14T18:00:00.000Z");
  });

  test("details read as an object or as nothing", () => {
    assert.deepEqual(readTicketDetail('{"from":"low","to":"high"}'), { from: "low", to: "high" });
    assert.deepEqual(readTicketDetail("[1]"), {});
    assert.deepEqual(readTicketDetail(""), {});
  });
});

describe("the write bodies", () => {
  test("a reply is trimmed, with plain line endings", () => {
    assert.deepEqual(readTicketReply({ content: "  hi\r\nthere \n" }), { ok: true, value: { content: "hi\nthere" } });
  });

  test("an empty reply or one over Discord's limit is refused", () => {
    assert.equal(readTicketReply({ content: "   " }).ok, false);
    assert.equal(readTicketReply({}).ok, false);
    assert.equal(readTicketReply("hello").ok, false);
    assert.equal(readTicketReply({ content: "x".repeat(TICKET_REPLY_MAX) }).ok, true);
    const long = readTicketReply({ content: "x".repeat(TICKET_REPLY_MAX + 1) });
    assert.equal(long.ok, false);
    if (!long.ok) assert.match(long.error, /2000/);
  });

  test("notes, priorities, members, transfers and reasons are checked", () => {
    assert.deepEqual(readTicketNote({ body: " remember " }), { ok: true, value: { body: "remember" } });
    assert.equal(readTicketNote({ body: "" }).ok, false);
    assert.deepEqual(readTicketPriority({ priority: "high" }), { ok: true, value: { priority: "high" } });
    assert.equal(readTicketPriority({ priority: "critical" }).ok, false);
    assert.deepEqual(readTicketMembers({ action: "add", userId: SOMEONE }), { ok: true, value: { action: "add", userId: SOMEONE } });
    assert.equal(readTicketMembers({ action: "kick", userId: SOMEONE }).ok, false);
    assert.equal(readTicketMembers({ action: "add", userId: "abc" }).ok, false);
    assert.deepEqual(readTicketTransfer({ typeId: "billing" }), { ok: true, value: { typeId: "billing" } });
    assert.equal(readTicketTransfer({ typeId: "no spaces" }).ok, false);
    assert.deepEqual(readTicketClose({ reason: "  " }), { ok: true, value: { reason: null } });
    assert.deepEqual(readTicketClose({ reason: "Solved" }), { ok: true, value: { reason: "Solved" } });
    assert.deepEqual(readTicketClose({}), { ok: true, value: { reason: null } });
    assert.equal(readTicketClose({ reason: "x".repeat(501) }).ok, false);
  });
});

describe("ticketHealth", () => {
  const healthy: TicketHealthFacts = {
    permissions: { manageChannels: true, manageWebhooks: true, manageThreads: true },
    panels: [
      {
        id: "p1",
        channelId: "300000000000000001",
        channelExists: true,
        posted: true,
        types: [{ id: "t1", mode: "channel", handlerCount: 1, categoryId: "300000000000000002", categoryExists: true, categoryChildren: 3 }],
      },
    ],
  };
  const codes = (facts: TicketHealthFacts) => ticketHealth(facts).map((issue) => issue.code);

  test("finds nothing wrong with a working setup", () => {
    assert.deepEqual(ticketHealth(healthy), []);
  });

  test("names missing permissions", () => {
    assert.deepEqual(codes({ ...healthy, permissions: { manageChannels: false, manageWebhooks: false, manageThreads: false } }), [
      "missingManageChannels",
      "missingManageWebhooks",
    ]);
  });

  test("says when there are no panels at all, or none posted", () => {
    assert.deepEqual(codes({ ...healthy, panels: [] }), ["noPanels"]);
    assert.deepEqual(codes({ ...healthy, panels: [{ ...healthy.panels[0]!, posted: false }] }), ["noPanelsPosted"]);
  });

  test("points at the panel and type that need attention", () => {
    const panel = healthy.panels[0]!;
    const type = panel.types[0]!;
    const issues = ticketHealth({
      ...healthy,
      panels: [
        { ...panel, channelExists: false, types: [{ ...type, handlerCount: 0, categoryExists: false }] },
        { ...panel, id: "p2", posted: false, types: [{ ...type, id: "t2", categoryId: null }] },
      ],
    });
    assert.deepEqual(
      issues.map(({ code, panelId, typeId }) => [code, panelId, typeId]),
      [
        ["panelChannelMissing", "p1", undefined],
        ["panelNotPosted", "p2", undefined],
        ["typeNoHandlers", "p1", "t1"],
        ["categoryMissing", "p1", "t1"],
        ["categoryNotSet", "p2", "t2"],
      ],
    );
  });

  test("a full category blocks only while the overflow has no room", () => {
    const full = { ...healthy.panels[0]!.types[0]!, categoryChildren: 50 };
    const withRoom = { ...full, overflowCategoryId: "300000000000000003", overflowExists: true, overflowChildren: 10 };
    const facts = (type: typeof full) => ({ ...healthy, panels: [{ ...healthy.panels[0]!, types: [type] }] });
    assert.deepEqual(ticketHealth(facts(full)).map((issue) => issue.blocking), [true]);
    assert.deepEqual(ticketHealth(facts(withRoom)).map((issue) => issue.blocking), [false]);
  });

  test("a panel an older version posted counts as posted, with a note to post it again", () => {
    const legacy = { ...healthy.panels[0]!, posted: false, legacy: true };
    const issues = ticketHealth({ ...healthy, panels: [legacy] });
    assert.deepEqual(
      issues.map(({ code, blocking }) => [code, blocking]),
      [["panelLegacy", false]],
    );
  });

  test("a thread type needs Manage Threads and no category", () => {
    const thread = { ...healthy.panels[0]!.types[0]!, mode: "thread" as const, categoryId: null };
    assert.deepEqual(
      codes({ permissions: { manageChannels: false, manageWebhooks: true, manageThreads: false }, panels: [{ ...healthy.panels[0]!, types: [thread] }] }),
      ["missingManageThreads"],
    );
  });
});

describe("helpers", () => {
  test("medianOf", () => {
    assert.equal(medianOf([]), null);
    assert.equal(medianOf([5]), 5);
    assert.equal(medianOf([9, 1, 5]), 5);
    assert.equal(medianOf([4, 1, 3, 2]), 2.5);
  });

  test("a dashboard link is empty until the address is known", () => {
    assert.equal(ticketDashboardUrl("", "1", 42), "");
    assert.equal(ticketDashboardUrl("https://bot.example.com", "1", 42), "https://bot.example.com/guilds/1/tickets/42");
  });
});

describe("embeds on a reply", () => {
  const embed = (over: Record<string, unknown> = {}) => ({ title: "Refund steps", description: "Open Billing, then Refunds.", ...over });

  test("a reply may be only an embed", () => {
    const read = readTicketReply({ content: "", embeds: [embed({ name: "internal", color: "#5865f2" })] });
    assert.ok(read.ok);
    assert.equal(read.value.content, "");
    assert.equal(read.value.embeds?.length, 1);
    assert.equal(read.value.embeds?.[0]?.name, "", "the editor's own name never travels");
    assert.equal(read.value.embeds?.[0]?.color, "#5865f2");
  });

  test("a reply without embeds keeps its old shape", () => {
    assert.deepEqual(readTicketReply({ content: "hi" }), { ok: true, value: { content: "hi" } });
    assert.deepEqual(readTicketReply({ content: "hi", embeds: [] }), { ok: true, value: { content: "hi" } });
  });

  test("at most three, and the fourth is named", () => {
    const read = readTicketReply({ content: "x", embeds: [embed(), embed(), embed(), embed()] });
    assert.ok(!read.ok);
    assert.match(read.error, /at most 3 embeds\. Remove 1/);
  });

  test("buttons, menus and reactions are refused", () => {
    for (const part of [{ buttons: [{ label: "x" }] }, { selects: [{}] }, { reactions: ["👍"] }, { components: [{}] }]) {
      const read = readTicketReply({ content: "x", embeds: [embed()], ...part });
      assert.ok(!read.ok, JSON.stringify(part));
      assert.match(read.error, /not buttons, menus or reactions/);
    }
    assert.ok(readTicketReply({ content: "x", embeds: [embed()], buttons: [], reactions: [] }).ok);
  });

  test("links and pictures must be web addresses, and a variable is not one", () => {
    for (const bad of [{ url: "javascript:alert(1)" }, { imageUrl: "data:image/png;base64,AA" }, { thumbnailUrl: "{server.icon}" }, { authorIconUrl: "{user}/x.png" }, { footerIconUrl: "ftp://x/y.png" }]) {
      const read = readTicketReply({ content: "", embeds: [embed(bad)] });
      assert.ok(!read.ok, JSON.stringify(bad));
    }
    assert.ok(readTicketReply({ content: "", embeds: [embed({ imageUrl: "https://cdn.example/a.png", url: "http://example.com" })] }).ok);
  });

  test("Discord's limits hold, per part and across the embeds, and an empty embed is refused", () => {
    const long = readTicketReply({ content: "", embeds: [embed({ title: "x".repeat(257) })] });
    assert.ok(!long.ok);
    assert.match(long.error, /^Embed 1: /);
    const total = readTicketReply({ content: "", embeds: [embed({ description: "a".repeat(3500) }), embed({ description: "b".repeat(3500) })] });
    assert.ok(!total.ok);
    assert.match(total.error, /6000/);
    assert.ok(!readTicketReply({ content: "", embeds: [{}] }).ok);
    assert.ok(!readTicketReply({ content: "", embeds: "nope" }).ok);
    assert.ok(!readTicketReply({ content: "", embeds: [embed({ timestamp: "{now}" })] }).ok);
    assert.ok(readTicketReply({ content: "", embeds: [embed({ timestamp: "now" })] }).ok);
  });
});

describe("a reply sent under the team's name", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 1,
    messageId: "1800000000000000001",
    authorId: "130000000000000002",
    authorName: "Kairo",
    authorAvatar: "https://cdn.example/kairo.png",
    authorIsStaff: true,
    authorBot: true,
    content: "On it",
    attachments: "[]",
    embeds: "[]",
    createdAt: new Date(0),
    editedAt: null,
    deletedAt: null,
    edits: 0,
    source: "dashboard",
    ...over,
  });

  test("shows the team as the author and keeps the real sender beside it", () => {
    const dto = ticketMessageFromRow(row({ sentAs: JSON.stringify({ name: "Support Team", avatarUrl: "https://cdn.example/team.png", staffLine: true }) }));
    assert.equal(dto.author.name, "Support Team");
    assert.equal(dto.author.avatarUrl, "https://cdn.example/team.png");
    assert.equal(dto.author.userId, "130000000000000002");
    assert.deepEqual(dto.sentBy, { userId: "130000000000000002", name: "Kairo" });
    assert.equal(dto.staffLine, true);
  });

  test("a row without it, or with a damaged one, reads as the staff member", () => {
    for (const sentAs of [undefined, null, "", "not json", "[]", JSON.stringify({ name: "" })]) {
      const dto = ticketMessageFromRow(row({ sentAs }));
      assert.equal(dto.author.name, "Kairo");
      assert.equal(dto.sentBy, undefined);
    }
  });

  test("the line naming the sender cannot ping or format", () => {
    assert.equal(ticketStaffLine("Kairo"), "-# Replied by Kairo");
    assert.equal(ticketStaffLine("**@everyone** <@123>"), "-# Replied by everyone 123");
    assert.equal(ticketStaffLine("***"), "-# Replied by staff");
    assert.equal(readTicketSentAs(JSON.stringify({ name: "T", avatarUrl: "javascript:x" }))?.avatarUrl, null);
  });
});
