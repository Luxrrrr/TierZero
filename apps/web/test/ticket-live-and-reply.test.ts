import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TICKET_FILTERS, type TicketCountDto, type TicketSavedReplyDto } from "@tier0/core";
import {
  alertText,
  alertsKey,
  baselineOf,
  countFilters,
  liveAnnouncement,
  liveChange,
  livePillText,
  newSincePrevious,
  titleWithBadge,
} from "../lib/ticket-live.ts";
import {
  base64FromDataUrl,
  checkFiles,
  filesSummary,
  insertText,
  matchSavedReplies,
  previewable,
  savedReplyText,
} from "../lib/ticket-composer.ts";
import { isTyping, shortcutFor, stepRow } from "../lib/ticket-shortcuts.ts";
import { blockedIds, withBlocked } from "../lib/ticket-blocklist.ts";
import { applyAnswers, hasMoreThanSetupEdits, messageLink, readAnswers, unanswered, unansweredSentence } from "../lib/ticket-setup.ts";
import { removalNotice, ticketNumber, ticketTitle, transcriptIsEmpty } from "../lib/ticket-format.ts";
import { statsListHref } from "../lib/ticket-stats.ts";

const count = (over: Partial<TicketCountDto> = {}): TicketCountDto => ({
  total: 5,
  newCount: 0,
  latestId: 40,
  latestActivityAt: "2026-10-16T10:00:00.000Z",
  awaitingStaff: 2,
  ...over,
});

describe("live inbox", () => {
  const base = baselineOf(count());

  test("a count the same as the baseline is no change", () => {
    assert.deepEqual(liveChange(base, count()), { kind: "none" });
  });

  test("tickets opened since are new, and counted by the bot", () => {
    assert.deepEqual(liveChange(base, count({ total: 7, newCount: 2, latestId: 42 })), { kind: "new", count: 2 });
  });

  test("with nothing on screen yet every ticket is new", () => {
    const empty = baselineOf(count({ total: 0, latestId: null, latestActivityAt: null, awaitingStaff: 0 }));
    assert.deepEqual(liveChange(empty, count({ total: 3, newCount: 3 })), { kind: "new", count: 3 });
  });

  test("a message, a close or a claim elsewhere is activity, not a new ticket", () => {
    assert.deepEqual(liveChange(base, count({ latestActivityAt: "2026-10-16T10:05:00.000Z" })), { kind: "activity" });
    assert.deepEqual(liveChange(base, count({ total: 4 })), { kind: "activity" });
    assert.deepEqual(liveChange(base, count({ awaitingStaff: 3 })), { kind: "activity" });
  });

  test("the pill and the announcement say the same thing", () => {
    assert.equal(livePillText({ kind: "new", count: 1 }), "1 new ticket");
    assert.equal(livePillText({ kind: "new", count: 1200 }), "1,200 new tickets");
    assert.equal(livePillText({ kind: "activity" }), "New activity");
    assert.equal(livePillText({ kind: "none" }), null);
    assert.match(liveAnnouncement({ kind: "new", count: 1 }), /^A new ticket was opened/);
    assert.match(liveAnnouncement({ kind: "new", count: 3 }), /^3 new tickets were opened/);
    assert.equal(liveAnnouncement({ kind: "none" }), "");
  });

  test("a count asks with the list's filters from page one, after the newest ticket shown", () => {
    const filters = { ...DEFAULT_TICKET_FILTERS, q: "ban", page: 4 };
    assert.deepEqual(countFilters(filters, base), { ...filters, page: 1, afterId: 40 });
    assert.equal(countFilters(filters, null).afterId, null);
  });

  test("the tab title carries the waiting count and never doubles it", () => {
    assert.equal(titleWithBadge("Tickets", 3), "(3) Tickets");
    assert.equal(titleWithBadge("(3) Tickets", 5), "(5) Tickets");
    assert.equal(titleWithBadge("(5) Tickets", 0), "Tickets");
    assert.equal(titleWithBadge("Tickets", 250), "(99+) Tickets");
    assert.equal(titleWithBadge("(99+) Tickets", 0), "Tickets");
  });

  test("an alert is for what changed since the poll before", () => {
    assert.equal(newSincePrevious({ kind: "new", count: 1 }, { kind: "new", count: 3 }), 2);
    assert.equal(newSincePrevious({ kind: "new", count: 3 }, { kind: "new", count: 3 }), 0);
    assert.equal(newSincePrevious({ kind: "none" }, { kind: "activity" }), 0);
    assert.equal(alertText(1, 2, 2)?.title, "New ticket");
    assert.equal(alertText(4, 0, 0)?.title, "4 new tickets");
    assert.equal(alertText(0, 1, 2)?.title, "A ticket is waiting on staff");
    assert.equal(alertText(0, 1, 4)?.title, "3 more tickets are waiting on staff");
    assert.equal(alertText(0, 3, 3), null);
    assert.equal(alertText(0, 3, 1), null);
  });

  test("the alert choice is kept per server", () => {
    assert.notEqual(alertsKey("1"), alertsKey("2"));
  });
});

describe("reply box", () => {
  const limits = { maxFiles: 3, maxBytes: 1000 };
  const file = (name: string, size: number) => ({ name, size });

  test("files that fit are kept in order", () => {
    const { accepted, problems } = checkFiles([], [file("a.png", 100), file("b.txt", 200)], limits);
    assert.deepEqual(accepted.map((entry) => entry.name), ["a.png", "b.txt"]);
    assert.deepEqual(problems, []);
  });

  test("an empty file is left out and named", () => {
    const { accepted, problems } = checkFiles([], [file("none.txt", 0)], limits);
    assert.equal(accepted.length, 0);
    assert.match(problems[0]!, /none\.txt is empty/);
  });

  test("the count counts files already attached", () => {
    const { accepted, problems } = checkFiles([file("1", 1), file("2", 1)], [file("3", 1), file("4", 1)], limits);
    assert.deepEqual(accepted.map((entry) => entry.name), ["3"]);
    assert.match(problems[0]!, /4 was not added: a reply can carry 3 files at most/);
  });

  test("the bytes are one budget for the whole reply, and a file too big alone says so", () => {
    const together = checkFiles([file("a", 700)], [file("b", 400)], limits);
    assert.equal(together.accepted.length, 0);
    assert.match(together.problems[0]!, /would come to more than/);
    const alone = checkFiles([], [file("huge.zip", 5000)], limits);
    assert.match(alone.problems[0]!, /huge\.zip is 5 KB, more than the 1000 B one reply can carry/);
  });

  test("one bad file does not stop the next", () => {
    const { accepted } = checkFiles([], [file("big", 5000), file("ok", 10)], limits);
    assert.deepEqual(accepted.map((entry) => entry.name), ["ok"]);
  });

  test("the summary reads as a count and a budget", () => {
    assert.equal(filesSummary([file("a", 2048)], { maxFiles: 10, maxBytes: 8 * 1024 * 1024 }), "1 file, 2 KB of 8.0 MB");
    assert.equal(filesSummary([file("a", 1), file("b", 1)], limits), "2 files, 2 B of 1000 B");
  });

  test("the base64 is what follows the comma, and a bad address gives nothing", () => {
    assert.equal(base64FromDataUrl("data:image/png;base64,QUJD"), "QUJD");
    assert.equal(base64FromDataUrl("nonsense"), "");
  });

  test("only pictures a browser can draw get a preview", () => {
    assert.equal(previewable({ type: "image/png" }), true);
    assert.equal(previewable({ type: "image/svg+xml" }), false);
    assert.equal(previewable({ type: "application/pdf" }), false);
  });

  const replies: TicketSavedReplyDto[] = [
    { name: "Greeting", content: "Hi {user}, thanks for writing." },
    { name: "Appeals", content: "Use the form, ticket {number}." },
    { name: "Closing", content: "Anything else? Greeting again if so." },
  ];

  test("saved replies match by name first, then by text, keeping their order", () => {
    assert.deepEqual(matchSavedReplies(replies, "greeting").map((reply) => reply.name), ["Greeting", "Closing"]);
    assert.deepEqual(matchSavedReplies(replies, "  ").map((reply) => reply.name), ["Greeting", "Appeals", "Closing"]);
    assert.deepEqual(matchSavedReplies(replies, "zzz"), []);
  });

  test("a saved reply is filled in with this ticket and the person sending it", () => {
    const ticket = { id: 900, number: 12, typeName: "Reports", channelId: "300", opener: { userId: "111", name: "Rook" } } as never;
    assert.equal(savedReplyText(replies[1]!, ticket, "222"), "Use the form, ticket 12.");
    assert.equal(savedReplyText(replies[0]!, ticket, "222"), "Hi <@111>, thanks for writing.");
  });

  test("inserting keeps the words apart and puts the cursor after the text", () => {
    assert.deepEqual(insertText("", 0, 0, "Hello"), { text: "Hello", caret: 5 });
    assert.deepEqual(insertText("Hi", 2, 2, "there"), { text: "Hi there", caret: 8 });
    assert.deepEqual(insertText("Hi\n", 3, 3, "there"), { text: "Hi\nthere", caret: 8 });
    assert.deepEqual(insertText("abcdef", 2, 4, "X"), { text: "ab X ef", caret: 4 });
    assert.deepEqual(insertText("Hi", 2, 2, "a\nb"), { text: "Hi\na\nb", caret: 6 });
  });
});

describe("keyboard shortcuts", () => {
  const press = (key: string, target: { tagName?: string; type?: string; isContentEditable?: boolean } | null = { tagName: "BODY" }, held = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target,
    ...held,
  });

  test("each key maps to its action", () => {
    assert.equal(shortcutFor(press("j")), "next");
    assert.equal(shortcutFor(press("k")), "previous");
    assert.equal(shortcutFor(press("c")), "claim");
    assert.equal(shortcutFor(press("r")), "reply");
    assert.equal(shortcutFor(press("/")), "search");
    assert.equal(shortcutFor(press("?")), "help");
    assert.equal(shortcutFor(press("x")), null);
  });

  test("nothing fires while typing", () => {
    assert.equal(shortcutFor(press("j", { tagName: "TEXTAREA" })), null);
    assert.equal(shortcutFor(press("j", { tagName: "INPUT", type: "text" })), null);
    assert.equal(shortcutFor(press("j", { tagName: "INPUT", type: "search" })), null);
    assert.equal(shortcutFor(press("j", { tagName: "DIV", isContentEditable: true })), null);
    assert.equal(shortcutFor(press("j", { tagName: "SELECT" })), null);
  });

  test("a checkbox or a button is not a typing place", () => {
    assert.equal(isTyping(press("j", { tagName: "INPUT", type: "checkbox" })), false);
    assert.equal(shortcutFor(press("j", { tagName: "BUTTON" })), "next");
  });

  test("a browser shortcut with Ctrl, Cmd or Alt held is left alone", () => {
    assert.equal(shortcutFor(press("r", { tagName: "BODY" }, { ctrlKey: true })), null);
    assert.equal(shortcutFor(press("c", { tagName: "BODY" }, { metaKey: true })), null);
    assert.equal(shortcutFor(press("j", { tagName: "BODY" }, { altKey: true })), null);
  });

  test("j and k step through the rows and stop at the ends", () => {
    assert.equal(stepRow(-1, 5, 1), 0);
    assert.equal(stepRow(-1, 5, -1), 4);
    assert.equal(stepRow(2, 5, 1), 3);
    assert.equal(stepRow(2, 5, -1), 1);
    assert.equal(stepRow(4, 5, 1), null);
    assert.equal(stepRow(0, 5, -1), null);
    assert.equal(stepRow(0, 0, 1), null);
    assert.equal(stepRow(9, 5, 1), 0);
  });
});

describe("blocked members", () => {
  test("only real Discord ids are read, once each", () => {
    const settings = { general: { blocklist: { members: ["220000000000000002", "220000000000000002", "nope", 5, "123"] } } };
    assert.deepEqual(blockedIds(settings), ["220000000000000002"]);
    assert.deepEqual(blockedIds({}), []);
    assert.deepEqual(blockedIds({ general: { blocklist: { members: "x" } } }), []);
  });

  test("writing the list keeps everything around it", () => {
    const settings = {
      other: 1,
      general: { ticketLimit: 2, blocklist: { roles: ["9"], members: ["220000000000000001"] } },
    };
    const next = withBlocked(settings, ["220000000000000001", "220000000000000002", "220000000000000002"]);
    assert.deepEqual(next, {
      other: 1,
      general: { ticketLimit: 2, blocklist: { roles: ["9"], members: ["220000000000000001", "220000000000000002"] } },
    });
    assert.deepEqual(settings.general.blocklist.members, ["220000000000000001"]);
  });

  test("a settings object with no general part still takes a blocked member", () => {
    assert.deepEqual(withBlocked({}, ["220000000000000001"]), { general: { blocklist: { members: ["220000000000000001"] } } });
  });
});

describe("tickets quick setup", () => {
  const starter = {
    panels: [
      {
        id: "default",
        name: "Support",
        channel: "111111111111111111",
        types: [{ id: "support", name: "Support", handlers: ["22222222222222222"], opening: { mode: "channel", category: "333333333333333333" } }],
      },
    ],
    transcripts: { logChannel: "444444444444444444", postFile: true },
    general: { ticketLimit: 2 },
  };

  test("the questions start with what the server already answered", () => {
    assert.deepEqual(readAnswers(starter), {
      channelId: "111111111111111111",
      handlers: ["22222222222222222"],
      mode: "channel",
      category: "333333333333333333",
      logChannel: "444444444444444444",
    });
  });

  test("an empty server starts with nothing answered, in channel mode", () => {
    const answers = readAnswers({});
    assert.equal(answers.channelId, undefined);
    assert.deepEqual(answers.handlers, []);
    assert.equal(answers.mode, "channel");
    assert.deepEqual(unanswered(answers), ["channel", "handlers", "category"]);
  });

  test("a thread ticket needs no category", () => {
    assert.deepEqual(unanswered({ ...readAnswers({}), channelId: "1", handlers: ["2"], mode: "thread" }), []);
  });

  test("the missing answers read as one sentence", () => {
    assert.equal(unansweredSentence(["channel"]), "the panel's channel");
    assert.equal(unansweredSentence(["channel", "handlers"]), "the panel's channel and the roles that answer");
    assert.equal(
      unansweredSentence(["channel", "handlers", "category"]),
      "the panel's channel, the roles that answer and a category for the ticket channels",
    );
  });

  test("answers are written into the first panel and type, and nothing else moves", () => {
    const next = applyAnswers(starter, { channelId: "555555555555555555", handlers: ["66666666666666666"], mode: "thread", category: "333333333333333333", logChannel: undefined });
    const panel = (next.panels as Record<string, unknown>[])[0]!;
    const type = (panel.types as Record<string, unknown>[])[0]!;
    assert.equal(panel.channel, "555555555555555555");
    assert.equal(panel.id, "default");
    assert.deepEqual(type.handlers, ["66666666666666666"]);
    assert.deepEqual(type.opening, { mode: "thread", category: "333333333333333333" });
    assert.deepEqual(next.transcripts, { postFile: true });
    assert.deepEqual(next.general, { ticketLimit: 2 });
    assert.equal((starter.panels[0] as Record<string, unknown>).channel, "111111111111111111");
  });

  test("channel mode with no category leaves none behind", () => {
    const next = applyAnswers(starter, { channelId: "1", handlers: ["2"], mode: "channel", category: undefined, logChannel: "7" });
    const type = ((next.panels as Record<string, unknown>[])[0]!.types as Record<string, unknown>[])[0]!;
    assert.deepEqual(type.opening, { mode: "channel" });
    assert.deepEqual(next.transcripts, { logChannel: "7", postFile: true });
  });

  test("a server with no panel gets one, with ids the bot accepts", () => {
    const next = applyAnswers({}, { channelId: "1", handlers: ["2"], mode: "channel", category: "3", logChannel: undefined });
    const panel = (next.panels as Record<string, unknown>[])[0]!;
    const type = (panel.types as Record<string, unknown>[])[0]!;
    assert.match(String(panel.id), /^[A-Za-z0-9_-]{1,32}$/);
    assert.match(String(type.id), /^[A-Za-z0-9_-]{1,32}$/);
    assert.equal(panel.name, "Support");
    assert.equal(type.name, "Support");
  });

  test("other panels and types are passed through", () => {
    const two = { panels: [starter.panels[0], { id: "second", name: "Reports", types: [] }] };
    assert.equal(hasMoreThanSetupEdits(two), true);
    assert.equal(hasMoreThanSetupEdits(starter), false);
    const next = applyAnswers(two, readAnswers(two));
    assert.deepEqual((next.panels as unknown[])[1], two.panels[1]);
  });

  test("the link to a posted panel", () => {
    assert.equal(messageLink("1", "2", "3"), "https://discord.com/channels/1/2/3");
  });
});

describe("numbers and removal wording", () => {
  test("members' number is shown, and the internal id only stands in for an old bot", () => {
    assert.equal(ticketNumber({ id: 903, number: 7 }), 7);
    assert.equal(ticketNumber({ id: 903, number: null }), 903);
    assert.equal(ticketNumber({ id: 903 }), 903);
    assert.equal(ticketNumber({ id: 903, number: 0 }), 903);
    assert.equal(ticketTitle({ subject: "", channelName: "", id: 903, number: 7 }), "Ticket 7");
  });

  test("a deleted transcript names who and when, a pruned one names the retention", () => {
    const deleted = { transcript: { messages: 0, removal: { kind: "deleted" as const, at: "2026-10-16T10:00:00.000Z", by: { userId: "1", name: " Lux " } } }, closedAt: "x" };
    assert.deepEqual(removalNotice(deleted as never, { pruned: true, removal: null }), { kind: "deleted", by: "Lux", at: "2026-10-16T10:00:00.000Z" });
    assert.deepEqual(removalNotice({ transcript: undefined, closedAt: "x" } as never, { pruned: true, removal: { kind: "pruned", at: "2026-10-01T00:00:00.000Z" } }), {
      kind: "pruned",
      at: "2026-10-01T00:00:00.000Z",
    });
    assert.deepEqual(removalNotice({ transcript: undefined, closedAt: "x" } as never, { pruned: true, removal: null }), { kind: "pruned", at: null });
    assert.equal(removalNotice({ transcript: undefined, closedAt: null } as never, { pruned: false, removal: null }), null);
  });

  test("a transcript with no messages left would download as an empty file", () => {
    assert.equal(transcriptIsEmpty({ transcript: { messages: 0, removal: null } } as never, { items: [], pruned: false }), true);
    assert.equal(transcriptIsEmpty({ transcript: { messages: 4, removal: null } } as never, { items: [], pruned: false }), false);
    assert.equal(transcriptIsEmpty({ transcript: undefined } as never, { items: [], pruned: true }), true);
  });
});

describe("stats links", () => {
  test("a row opens the inbox with the query the bot worked out", () => {
    assert.equal(statsListHref("9", "status=all&type=reports"), "/guilds/9/tickets?status=all&type=reports");
    assert.equal(statsListHref("9", "?status=all&handler=123"), "/guilds/9/tickets?status=all&handler=123");
  });

  test("nothing, or something that is not a plain query, gives no link", () => {
    assert.equal(statsListHref("9", undefined), null);
    assert.equal(statsListHref("9", ""), null);
    assert.equal(statsListHref("9", "status=all#x"), null);
    assert.equal(statsListHref("9", "../admin"), null);
    assert.equal(statsListHref("9", "a b"), null);
  });
});
