import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TICKET_FILTERS,
  parseTicketListFilters,
  readUpdatedSince,
  type TicketEventDto,
  type TicketHealthIssue,
  type TicketMessageDto,
  type TicketPanelOption,
} from "@tier0/shared-tickets";
import { isTicketTabCurrent, ticketLanding, ticketTabsFor } from "../lib/ticket-tabs.ts";
import { firstRunSteps, healthLines, healthSummary, issuesBeyondFirstRun, needsFirstRun } from "../lib/ticket-health.ts";
import {
  activeFilterCount,
  arrivalAnnouncement,
  conversationItems,
  durationText,
  eventLine,
  formatBytes,
  inboxHref,
  isImage,
  mergeMessages,
  knownNames,
  searchIsBusy,
  ticketIdFrom,
  ticketTitle,
  transcriptDeletedText,
  transcriptsHref,
  utcDay,
  withFilters,
} from "../lib/ticket-format.ts";
import { backlogText, dayChartSummary, parseStatsPeriod, ratingBars } from "../lib/ticket-stats.ts";
import { draftPanels, panelPreviewMessage, panelStripState } from "../lib/ticket-panel-preview.ts";
import { failureReason, isActionResult, messagesPath, ticketsApiPath, transcriptHref } from "../lib/tickets-client.ts";
import { areaHref, isHosted, moduleHref } from "../lib/module-href.ts";

describe("ticket tabs", () => {
  const ids = (...args: Parameters<typeof ticketTabsFor>) => ticketTabsFor(...args).map((tab) => tab.id);

  test("a handler works tickets but does not see Settings", () => {
    assert.deepEqual(ids("1", "handler", false), ["inbox", "transcripts", "stats"]);
  });

  test("an admin role is the same, since settings take Manage Server", () => {
    assert.deepEqual(ids("1", "admin", false), ["inbox", "transcripts", "stats"]);
  });

  test("a manager sees everything", () => {
    assert.deepEqual(ids("1", "manager", true), ["inbox", "transcripts", "stats", "settings"]);
  });

  test("someone who manages the server but has no level from the bot gets Settings alone", () => {
    assert.deepEqual(ids("1", null, true), ["settings"]);
    assert.equal(ticketLanding("1", null, true), "/guilds/1/tickets/settings");
  });

  test("nobody else gets anything", () => {
    assert.deepEqual(ids("1", null, false), []);
    assert.equal(ticketLanding("1", null, false), null);
  });

  test("the inbox tab owns its root and every open ticket, and nothing else", () => {
    const [inbox] = ticketTabsFor("9", "manager", true);
    assert.equal(isTicketTabCurrent(inbox!, "/guilds/9/tickets"), true);
    assert.equal(isTicketTabCurrent(inbox!, "/guilds/9/tickets/"), true);
    assert.equal(isTicketTabCurrent(inbox!, "/guilds/9/tickets/128"), true);
    assert.equal(isTicketTabCurrent(inbox!, "/guilds/9/tickets/transcripts"), false);
    assert.equal(isTicketTabCurrent(inbox!, "/guilds/9/tickets/settings"), false);
  });

  test("Settings is current on the quick setup too", () => {
    const settings = ticketTabsFor("9", "manager", true).find((tab) => tab.id === "settings")!;
    assert.equal(isTicketTabCurrent(settings, "/guilds/9/tickets/settings"), true);
    assert.equal(isTicketTabCurrent(settings, "/guilds/9/tickets/setup"), true);
  });

  test("a transcript is under the Transcripts tab", () => {
    const transcripts = ticketTabsFor("9", "handler").find((tab) => tab.id === "transcripts")!;
    assert.equal(isTicketTabCurrent(transcripts, "/guilds/9/tickets/transcripts/121"), true);
  });
});

describe("module addresses", () => {
  test("the tickets module is hosted in its area", () => {
    assert.equal(isHosted({ id: "tickets", area: "tickets" }), true);
    assert.equal(moduleHref("5", { id: "tickets", area: "tickets" }), "/guilds/5/tickets/settings");
    assert.equal(areaHref("5", "tickets"), "/guilds/5/tickets");
    assert.equal(areaHref("5", "moderation"), "/guilds/5/mod");
  });

  test("an area the dashboard does not know is not treated as hosted", () => {
    assert.equal(isHosted({ id: "x", area: "elsewhere" as never }), false);
  });
});

const panels: TicketPanelOption[] = [
  {
    id: "main",
    name: "Main support",
    channelId: "1",
    types: [
      { id: "game", name: "Game support", emoji: "🎮", panelId: "main", handled: true },
      { id: "report", name: "Report a player", emoji: null, panelId: "main", handled: true },
    ],
  },
];

describe("health wording", () => {
  test("every code has a title and a detail, blocking ones first", () => {
    const issues: TicketHealthIssue[] = [
      { code: "missingManageWebhooks", blocking: false },
      { code: "typeNoHandlers", blocking: false, panelId: "main", typeId: "report" },
      { code: "missingManageChannels", blocking: true },
      { code: "categoryMissing", blocking: true, panelId: "main", typeId: "game", channelId: "9" },
    ];
    const lines = healthLines("7", issues, panels);
    assert.deepEqual(
      lines.map((line) => [line.code, line.tone]),
      [
        ["missingManageChannels", "danger"],
        ["categoryMissing", "danger"],
        ["missingManageWebhooks", "attention"],
        ["typeNoHandlers", "attention"],
      ],
    );
    for (const line of lines) {
      assert.ok(line.title.length > 0 && line.detail.length > 0);
      assert.ok(!(line.title + line.detail).includes(String.fromCharCode(0x2014)), "no em dashes in UI text");
    }
  });

  test("names the panel and the type it is about", () => {
    const [noHandlers] = healthLines("7", [{ code: "typeNoHandlers", blocking: false, panelId: "main", typeId: "report" }], panels);
    assert.equal(noHandlers?.title, "The Report a player type has no handlers");
    const [missing] = healthLines("7", [{ code: "categoryMissing", blocking: true, typeId: "game" }], panels);
    assert.equal(missing?.title, "The category for the Game support type was deleted");
  });

  test("a deleted panel channel and one never picked are worded apart", () => {
    const [deleted] = healthLines("7", [{ code: "panelChannelMissing", blocking: true, panelId: "main", channelId: "3" }], panels);
    const [never] = healthLines("7", [{ code: "panelChannelMissing", blocking: true, panelId: "main" }], panels);
    assert.match(deleted!.title, /lost its channel/);
    assert.match(never!.title, /has no channel/);
  });

  test("a full category with room in the overflow is only worth a look", () => {
    const [line] = healthLines("7", [{ code: "categoryFull", blocking: false, typeId: "game" }], panels);
    assert.equal(line?.tone, "attention");
    assert.equal(line?.fix, null);
  });

  test("fixes in the dashboard point at Panels; permissions are fixed in Discord", () => {
    const [perm, posted] = healthLines("7", [{ code: "missingManageChannels", blocking: true }, { code: "noPanelsPosted", blocking: true }], panels);
    assert.equal(perm?.fix, null);
    assert.equal(posted?.fix?.href, "/guilds/7/tickets/settings#section-panels");
  });

  test("an unknown name falls back to plain words", () => {
    const [line] = healthLines("7", [{ code: "typeNoHandlers", blocking: false, typeId: "gone" }], []);
    assert.equal(line?.title, "A ticket type has no handlers");
  });

  test("the summary counts what stops tickets first", () => {
    assert.equal(healthSummary([]), null);
    assert.equal(healthSummary([{ code: "missingManageWebhooks", blocking: false }]), "1 thing to look at");
    assert.equal(
      healthSummary([
        { code: "noPanels", blocking: true },
        { code: "missingManageChannels", blocking: true },
      ]),
      "2 problems stop tickets opening",
    );
  });
});

describe("first run", () => {
  test("a server with nothing set up has three steps to go", () => {
    const steps = firstRunSteps({ panels: [], health: [{ code: "noPanels", blocking: true }] });
    assert.deepEqual(steps.map((step) => step.done), [false, false, false]);
    assert.equal(needsFirstRun({ panels: [], health: [] }), true);
  });

  test("a posted panel with a handled type is done", () => {
    assert.equal(needsFirstRun({ panels, health: [] }), false);
  });

  test("a type without handlers does not count as added", () => {
    const steps = firstRunSteps({
      panels: [{ ...panels[0]!, types: [panels[0]!.types[1]!] }],
      health: [{ code: "typeNoHandlers", blocking: false, typeId: "report" }, { code: "noPanelsPosted", blocking: true }],
    });
    assert.deepEqual(steps.map((step) => [step.id, step.done]), [
      ["panel", true],
      ["type", false],
      ["post", false],
    ]);
  });
});

describe("list addresses", () => {
  test("the inbox keeps only what differs from the defaults", () => {
    assert.equal(inboxHref("1"), "/guilds/1/tickets");
    assert.equal(inboxHref("1", { status: "closed", typeIds: ["game"], q: "rank" }, 12), "/guilds/1/tickets/12?status=closed&type=game&q=rank");
  });

  test("what the address says reads back as the same filters", () => {
    const filters = withFilters(DEFAULT_TICKET_FILTERS, { claimed: "me", priority: "urgent", sort: "oldest", page: 3 });
    const back = parseTicketListFilters(new URLSearchParams(inboxHref("1", filters).split("?")[1]));
    assert.deepEqual(back, filters);
  });

  test("the archive never repeats the status", () => {
    assert.equal(transcriptsHref("1", { status: "closed", rating: 5 }), "/guilds/1/tickets/transcripts?rating=5");
    assert.equal(transcriptsHref("1", { status: "closed" }, 121), "/guilds/1/tickets/transcripts/121");
  });

  test("changing a filter starts again from page one, and turning the page keeps the rest", () => {
    const on3 = { ...DEFAULT_TICKET_FILTERS, page: 3, q: "lag" };
    assert.equal(withFilters(on3, { claimed: "unclaimed" }).page, 1);
    assert.equal(withFilters(on3, { page: 4 }).q, "lag");
  });

  test("counts the filters that are on", () => {
    assert.equal(activeFilterCount(DEFAULT_TICKET_FILTERS), 0);
    assert.equal(activeFilterCount({ ...DEFAULT_TICKET_FILTERS, typeIds: ["a"], priority: "high", q: "x" }), 3);
    assert.equal(activeFilterCount({ ...DEFAULT_TICKET_FILTERS, q: "x", claimed: "me" }, ["q", "claimed"]), 0);
  });

  test("ticket numbers in the address", () => {
    assert.equal(ticketIdFrom("128"), 128);
    assert.equal(ticketIdFrom("0"), null);
    assert.equal(ticketIdFrom("12a"), null);
    assert.equal(ticketIdFrom("setup"), null);
  });
});

describe("wording", () => {
  test("a ticket is called by its subject, then its channel", () => {
    assert.equal(ticketTitle({ id: 4, subject: "Lag in ranked", channelName: "ticket-nova" }), "Lag in ranked");
    assert.equal(ticketTitle({ id: 4, subject: "  ", channelName: "ticket-nova" }), "#ticket-nova");
    assert.equal(ticketTitle({ id: 4, subject: null, channelName: "" }), "Ticket 4");
  });

  test("durations", () => {
    assert.equal(durationText(null), "No data");
    assert.equal(durationText(20_000), "Under a minute");
    assert.equal(durationText(23 * 60_000), "23 min");
    assert.equal(durationText(5.5 * 3_600_000), "5 h 30 min");
    assert.equal(durationText(26 * 3_600_000), "1 day 2 h");
    assert.equal(durationText(48 * 3_600_000), "2 days");
  });

  test("sizes and pictures", () => {
    assert.equal(formatBytes(0), "");
    assert.equal(formatBytes(900), "900 B");
    assert.equal(formatBytes(48_211), "47 KB");
    assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
    assert.equal(isImage({ name: "a.png", contentType: "image/png" }), true);
    assert.equal(isImage({ name: "a.svg", contentType: "image/svg+xml" }), false);
    assert.equal(isImage({ name: "clip.jpg", contentType: null }), true);
    assert.equal(isImage({ name: "client.log", contentType: "text/plain" }), false);
  });

  const ev = (kind: TicketEventDto["kind"], detail: Record<string, unknown> = {}, actor: string | null = "Pixel Warden") => ({
    kind,
    detail,
    actor: actor === null ? null : { userId: "1", name: actor },
  });

  test("every event reads as a sentence", () => {
    assert.equal(eventLine(ev("claimed")).text, "Pixel Warden claimed the ticket");
    assert.equal(eventLine(ev("priority", { from: "normal", to: "urgent" })).text, "Pixel Warden changed the priority from normal to urgent");
    assert.equal(eventLine(ev("transferred", { fromTypeName: "Game support", toTypeName: "Report a player" })).text, "Pixel Warden moved the ticket from Game support to Report a player");
    assert.equal(eventLine(ev("member_added", { name: "Turbo Gnome" })).text, "Pixel Warden added Turbo Gnome");
    assert.equal(eventLine(ev("rename", { to: "ranked-flag" })).text, "Pixel Warden renamed the channel to #ranked-flag");
    assert.deepEqual(eventLine(ev("closed", { reason: "Sorted" })), { text: "Pixel Warden closed the ticket", detail: "Reason: Sorted" });
    assert.equal(eventLine(ev("closed", {}, null)).text, "The ticket closed after a stretch with no messages");
    assert.equal(eventLine(ev("rated", { rating: 4, comment: "quick" })).detail, "quick");
    assert.equal(eventLine(ev("reminder", {}, null)).text, "The handlers were reminded that nobody has answered yet");
  });

  test("a damaged detail still reads", () => {
    assert.equal(eventLine(ev("priority", { to: "sideways" })).text, "Pixel Warden changed the priority");
    assert.equal(eventLine(ev("member_removed", { name: 4 })).text, "Pixel Warden removed a member");
  });
});

const msg = (n: number, author: string, at: string, extra: Partial<TicketMessageDto> = {}): TicketMessageDto => ({
  id: n,
  messageId: String(1000 + n),
  author: { userId: author, name: author === "me" ? "Pixel Warden" : `User ${author}`, avatarUrl: null, isStaff: author === "me" },
  content: `m${n}`,
  attachments: [],
  embeds: [],
  createdAt: at,
  editedAt: null,
  deletedAt: null,
  edits: 0,
  source: "discord",
  ...extra,
});

describe("conversation", () => {
  const events: TicketEventDto[] = [
    { id: 1, kind: "opened", actor: null, detail: {}, createdAt: "2026-10-12T09:00:00.000Z" },
    { id: 2, kind: "claimed", actor: { userId: "me", name: "Pixel Warden" }, detail: {}, createdAt: "2026-10-12T09:05:30.000Z" },
  ];
  const messages = [
    msg(1, "a", "2026-10-12T09:01:00.000Z"),
    msg(2, "a", "2026-10-12T09:03:00.000Z"),
    msg(3, "a", "2026-10-12T09:20:00.000Z"),
    msg(4, "me", "2026-10-12T09:21:00.000Z"),
    msg(5, "me", "2026-10-13T08:00:00.000Z"),
  ];

  test("orders messages and events, with a divider per day, and leaves the opening out", () => {
    const items = conversationItems(messages, events, utcDay);
    assert.deepEqual(
      items.map((item) => (item.kind === "message" ? `m${item.message.id}${item.continued ? "+" : ""}` : item.kind === "event" ? item.event.kind : `day`)),
      ["day", "m1", "m2+", "claimed", "m3", "m4", "day", "m5"],
    );
  });

  test("groups by the reader's day, which the caller decides", () => {
    const items = conversationItems(messages, [], () => "same");
    assert.equal(items.filter((item) => item.kind === "day").length, 1);
    const m5 = items.find((item) => item.kind === "message" && item.message.id === 5);
    assert.equal(m5?.kind === "message" && m5.continued, false, "a long gap starts a new block");
  });

  test("new messages are added once, and a changed one replaces the old", () => {
    const edited = msg(2, "a", "2026-10-12T09:03:00.000Z", { content: "fixed", editedAt: "2026-10-12T09:04:00.000Z", edits: 1 });
    const merged = mergeMessages(messages.slice(0, 3), [edited, msg(6, "a", "2026-10-12T10:00:00.000Z")]);
    assert.deepEqual(merged.map((m) => m.id), [1, 2, 3, 6]);
    assert.equal(merged[1]?.content, "fixed");
  });

  test("arrivals are announced by who sent them, and the viewer's own are not", () => {
    assert.equal(arrivalAnnouncement([msg(1, "me", "x")], "me"), "");
    assert.equal(arrivalAnnouncement([msg(1, "a", "x")], "me"), "New message from User a.");
    assert.equal(arrivalAnnouncement([msg(1, "a", "x"), msg(2, "a", "x")], "me"), "2 new messages from User a.");
    assert.equal(arrivalAnnouncement([msg(1, "a", "x"), msg(2, "b", "x")], "me"), "2 new messages.");
  });
});

describe("stats", () => {
  test("the period comes from the address, 30 days otherwise", () => {
    assert.equal(parseStatsPeriod("7"), 7);
    assert.equal(parseStatsPeriod(["90"]), 90);
    assert.equal(parseStatsPeriod("14"), 30);
    assert.equal(parseStatsPeriod(undefined), 30);
  });

  test("ratings read five stars first, as shares of the whole", () => {
    assert.deepEqual(ratingBars([1, 0, 1, 0, 2]).map((bar) => [bar.stars, bar.count, bar.percent]), [
      [5, 2, 50],
      [4, 0, 0],
      [3, 1, 25],
      [2, 0, 0],
      [1, 1, 25],
    ]);
    assert.ok(ratingBars([0, 0, 0, 0, 0]).every((bar) => bar.percent === 0));
  });

  test("the backlog and the chart are put in words", () => {
    assert.equal(backlogText(10, 12), "Keeping up");
    assert.equal(backlogText(12, 10), "2 more opened than closed");
    assert.equal(backlogText(0, 0), "Nothing came in");
    assert.match(dayChartSummary([{ date: "2026-10-01", opened: 3, closed: 1 }, { date: "2026-10-02", opened: 5, closed: 2 }]), /8 opened and 3 closed.*5, on 2026-10-02/);
  });
});

describe("panel preview", () => {
  const draft = {
    panels: [
      {
        id: "main",
        name: "Main support",
        channel: "55",
        style: "buttons",
        message: { content: "Need a hand?", embeds: [] },
        types: [
          { id: "a", name: "Game support", emoji: "🎮", appearance: { buttonStyle: "success", buttonLabel: "Get help" } },
          { id: "b", name: "Report a player", appearance: { buttonStyle: "rainbow" } },
        ],
      },
      { name: "", style: "menu", placeholder: "Pick one", types: [{ id: "c", name: "Cup", appearance: { description: "Sign up" } }] },
    ],
  };

  test("buttons follow each type's look, with the type's name when no text is set", () => {
    const body = panelPreviewMessage({ panel: draft.panels[0] });
    assert.equal(body.content, "Need a hand?");
    assert.deepEqual(body.buttons.map((button) => [button.label, button.style, button.emoji]), [
      ["Get help", "success", "🎮"],
      ["Report a player", "primary", ""],
    ]);
    assert.equal(body.selects.length, 0);
  });

  test("a menu panel is one menu holding every type", () => {
    const body = panelPreviewMessage({ panel: draft.panels[1] });
    assert.equal(body.buttons.length, 0);
    assert.equal(body.selects[0]?.placeholder, "Pick one");
    assert.deepEqual(body.selects[0]?.options.map((option) => [option.label, option.description]), [["Cup", "Sign up"]]);
  });

  test("a panel without its own message shows the one it starts with", () => {
    const starting = { content: "Press a button", embeds: [], buttons: [], selects: [], reactions: [] };
    assert.equal(panelPreviewMessage({ panel: { types: [] }, starting }).content, "Press a button");
  });

  test("the strip lists every panel of the draft by name", () => {
    assert.deepEqual(draftPanels(draft).map((panel) => [panel.id, panel.name, panel.channelId]), [
      ["main", "Main support", "55"],
      ["", "Panel 2", null],
    ]);
  });
});

describe("browser addresses", () => {
  test("everything goes through the dashboard's own proxy", () => {
    assert.equal(ticketsApiPath("1", "items/4/reply"), "/api/guilds/1/tickets/items/4/reply");
    assert.equal(ticketsApiPath("1", "/context"), "/api/guilds/1/tickets/context");
    assert.equal(messagesPath(4, null), "items/4/messages");
    assert.equal(messagesPath(4, "1290000000000000001"), "items/4/messages?after=1290000000000000001");
    assert.equal(transcriptHref("1", 4, "html"), "/api/guilds/1/tickets/items/4/transcript.html");
  });

  test("a refusal is worded from the bot's own answer, or by its status", () => {
    assert.equal(failureReason(403, "You do not handle Ban appeal tickets."), "You do not handle Ban appeal tickets.");
    assert.match(failureReason(429, undefined), /Wait a moment/);
    assert.match(failureReason(503, ""), /bot could not be reached/);
  });
});

describe("first run and health together", () => {
  test("problems the steps already cover are not listed again", () => {
    const left = issuesBeyondFirstRun([
      { code: "noPanelsPosted", blocking: true },
      { code: "typeNoHandlers", blocking: false, typeId: "a" },
      { code: "missingManageChannels", blocking: true },
      { code: "categoryNotSet", blocking: true, typeId: "a" },
    ]);
    assert.deepEqual(left.map((issue) => issue.code), ["missingManageChannels", "categoryNotSet"]);
  });
});

describe("review fixes", () => {
  test("a transcript deletion answers with a count, not a ticket, and is worded from it", () => {
    assert.equal(isActionResult({ deleted: 4 }), false);
    assert.equal(isActionResult({ ticket: { id: 4 }, notes: [] }), true);
    assert.equal(isActionResult({ message: {}, delivery: "webhook" }), false);
    assert.equal(isActionResult(null), false);
    assert.equal(transcriptDeletedText(9, { deleted: 1 }), "Transcript of #9 deleted: 1 message removed");
    assert.equal(transcriptDeletedText(9, { deleted: 12 }), "Transcript of #9 deleted: 12 messages removed");
    assert.equal(transcriptDeletedText(9, {} as never), "Transcript of #9 deleted: 0 messages removed");
  });

  test("a poll asks for changes since the last one as well as new messages", () => {
    assert.equal(messagesPath(4, "17", "2026-10-13T10:00:00.000Z"), "items/4/messages?after=17&updatedSince=2026-10-13T10%3A00%3A00.000Z");
    assert.equal(messagesPath(4, null, null), "items/4/messages");
    assert.deepEqual(readUpdatedSince(null), { ok: true, value: null });
    assert.deepEqual(readUpdatedSince("2026-10-13T10:00:00.000Z"), { ok: true, value: new Date("2026-10-13T10:00:00.000Z") });
    assert.deepEqual(readUpdatedSince("yesterday"), { ok: false });
  });

  test("the search box is left alone while someone types in it", () => {
    assert.equal(searchIsBusy(true, false), true);
    assert.equal(searchIsBusy(false, true), true);
    assert.equal(searchIsBusy(false, false), false);
  });

  test("changing a filter keeps the open ticket open", () => {
    const filters = withFilters(DEFAULT_TICKET_FILTERS, { claimed: "me" });
    assert.equal(inboxHref("1", filters, 128), "/guilds/1/tickets/128?claimed=me");
  });

  test("mentions read as the names the ticket already knows", () => {
    const names = knownNames([msg(1, "a", "x")], {
      opener: { userId: "o", name: "Nova Rift" },
      claimedBy: { userId: "s", name: "Pixel Warden" },
      members: [{ user: { userId: "t", name: "Turbo Gnome" } }, { user: { userId: "z", name: null } }],
    });
    assert.equal(names.get("a"), "User a");
    assert.equal(names.get("o"), "Nova Rift");
    assert.equal(names.get("s"), "Pixel Warden");
    assert.equal(names.get("t"), "Turbo Gnome");
    assert.equal(names.has("z"), false);
  });

  test("a panel the older version posted has a state of its own", () => {
    const at = { channelId: "5" };
    assert.equal(panelStripState(at, { posted: false, channelExists: true, legacy: true }, false), "legacy");
    assert.equal(panelStripState(at, { posted: true, channelExists: true, legacy: false }, false), "posted");
    assert.equal(panelStripState(at, { posted: false, channelExists: true }, false), "unposted");
    assert.equal(panelStripState(at, { posted: false, channelExists: false, legacy: true }, false), "missing");
    assert.equal(panelStripState(at, undefined, true), "unsaved");
    assert.equal(panelStripState({ channelId: null }, { posted: true, channelExists: true }, false), "nochannel");
  });

  test("a legacy panel is worded plainly and counts as posted for the first run", () => {
    const [line] = healthLines("7", [{ code: "panelLegacy", blocking: false, panelId: "main", channelId: "1" }], panels);
    assert.equal(line?.title, "The Main support panel was posted by an older version");
    assert.match(line!.detail, /delete the old message in Discord/);
    assert.equal(line?.tone, "attention");
    assert.equal(needsFirstRun({ panels, health: [{ code: "panelLegacy", blocking: false, panelId: "main" }] }), false);
  });
});
