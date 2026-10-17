import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, REPLY_COLOR, applyVariables, type FieldDescriptor, type MessageBody } from "@tier0/core";
import tickets from "../dist/index.js";
import { REPLIES } from "../dist/messages.js";
import { DEFAULT_LABELS, closeReasonOf, topicOf, transcriptFileName, transcriptTexts } from "../dist/labels.js";
import { ticketChannelName } from "../dist/naming.js";
import { DEFAULT_TRANSCRIPT_TEXTS, renderTranscript } from "../dist/transcript.js";

const CATEGORY = "223456789012345678";
const ROLE = "323456789012345678";

const registry = new ModuleRegistry();
registry.register(tickets);

type Groups = Record<"refusals" | "opening" | "working" | "panel", Record<string, MessageBody>>;

function resolve(stored: unknown = {}) {
  const result = registry.resolveSettings("tickets", { category: CATEGORY, supportRoles: [ROLE], ...(stored as object) });
  assert.ok(result.ok, result.ok ? "" : result.errors[0]?.message);
  return result.value as {
    messages: Groups;
    labels: Record<string, unknown>;
    general: { channelName: string; blocklist: { message: MessageBody } };
    panels: { types: { form: { label: string }[] }[] }[];
    automation: { autoClose: { notice: boolean } };
  };
}

const TODAY = {
  notStaff: "You need a support role or Manage Channels to do that.",
  cannotClose: "You need to be the ticket opener, hold a support role, or have Manage Channels to close this.",
  cannotAdd: "You need to be the ticket opener, hold a support role, or have Manage Channels to do that.",
  notATicket: "This isn't an open ticket channel.",
  alreadyClosed: "This ticket is already closed.",
  channelMissing: "This ticket's channel is missing.",
  categoryGone: "The ticket category no longer exists. Ask a server admin to set a new one in the dashboard.",
  categoryFull: "The ticket category is full. Ask a server admin to close old tickets or choose a different category.",
  limitOne: "You already have an open ticket. Close it before opening another.",
  limitMany: "You already have {openCount} open tickets, the most this server allows. Close one before opening another.",
  noCategory: "No ticket category is set, or the one configured has been deleted. Ask a server admin to set one in the dashboard.",
  createFailed: "Something went wrong creating your ticket channel. Try again, or tell a server admin if it keeps happening.",
  noPanelChannel: "No panel channel is set, or the one configured has been deleted. Set one in the dashboard first.",
  panelFailed: "I couldn't post the panel there. Check that I can send messages and embed links in that channel.",
} as const;

const flat = (groups: Groups): Record<string, MessageBody> => ({ ...groups.refusals, ...groups.opening, ...groups.working, ...groups.panel });

describe("the refusals and failures", () => {
  test("every one in the catalogue is a setting, the blocklist's with the blocklist", () => {
    const resolved = resolve();
    const replies = { ...flat(resolved.messages), blocked: resolved.general.blocklist.message };
    assert.deepEqual(Object.keys(replies).sort(), Object.keys(REPLIES).sort());
    for (const [key, body] of Object.entries(replies)) {
      assert.deepEqual(body, REPLIES[key as keyof typeof REPLIES].starting, key);
    }
  });

  test("say what they always have until the owner writes another", () => {
    const replies = flat(resolve().messages);
    for (const [key, text] of Object.entries(TODAY)) {
      assert.equal(replies[key]?.embeds[0]?.description, text, key);
      assert.equal(replies[key]?.embeds[0]?.color, REPLY_COLOR.error, key);
      assert.equal(replies[key]?.content, "", key);
      assert.deepEqual(replies[key], REPLIES[key as keyof typeof REPLIES].starting, key);
    }
  });

  test("a limit message can name how many tickets the member has and the limit", () => {
    const { limitMany } = flat(resolve().messages);
    assert.equal(applyVariables(limitMany!.embeds[0]?.description ?? "", { openCount: "3", limit: "3" }), "You already have 3 open tickets, the most this server allows. Close one before opening another.");
    const names = (REPLIES.limitMany.variables ?? []).map((variable) => variable.name);
    assert.deepEqual(names, ["openCount", "limit"]);
  });

  test("use the owner's wording, and a plain string saved by hand still reads", () => {
    const { opening, refusals } = resolve({
      messages: {
        refusals: { notStaff: "Staff only, sorry." },
        opening: { limitOne: { content: "", embeds: [{ description: "One at a time, {limit} allowed." }] } },
      },
    }).messages;
    assert.equal(refusals.notStaff?.content, "Staff only, sorry.");
    assert.equal(opening.limitOne?.embeds[0]?.description, "One at a time, {limit} allowed.");
    assert.equal(refusals.cannotClose?.embeds[0]?.description, TODAY.cannotClose, "the others are untouched");
  });

  test("a message over Discord's limit is refused when it is saved", () => {
    const result = registry.resolveSettings("tickets", {
      category: CATEGORY,
      supportRoles: [ROLE],
      messages: { refusals: { notStaff: "x".repeat(2001) } },
    });
    assert.equal(result.ok, false);
  });
});

describe("the labels", () => {
  test("default to the strings the module has always used", () => {
    const { labels } = resolve();
    const values = labels;
    for (const [key, text] of Object.entries(DEFAULT_LABELS)) {
      if (key === "fileName" || key === "unknownAuthor" || key === "unknownAuthorId") continue;
      assert.equal(values[key], text, key);
    }
    const transcript = values.transcript as Record<string, string>;
    assert.equal(transcript.fileName, "ticket-{number}.txt");
    assert.equal(transcript.unknownAuthor, "unknown user");
    assert.equal(transcript.unknownAuthorId, "unknown");
    assert.equal(values.modalTitle, "Open a ticket");
    assert.equal(values.closeButton, "Close ticket");
  });

  test("the form question and channel name moved, with their old values, to where types read them", () => {
    const moved = resolve();
    assert.equal(moved.panels[0]?.types[0]?.form[0]?.label, "What do you need help with?");
    assert.equal(moved.general.channelName, "ticket-{username}");
    const custom = resolve({ labels: { modalQuestion: "What's up?", channelName: "help-{username}" } });
    assert.equal(custom.panels[0]?.types[0]?.form[0]?.label, "What's up?");
    assert.equal(custom.general.channelName, "help-{username}");
    assert.equal(custom.labels.modalQuestion, undefined);
  });

  test("the topic, audit-log reason and file name read as before", () => {
    const { labels } = resolve();
    const typed = labels as never;
    assert.equal(topicOf(typed, "ada#0", "ada", "Cannot log in"), "Opened by ada#0: Cannot log in");
    assert.equal(topicOf(typed, "ada#0", "ada", null), "Opened by ada#0");
    assert.equal(closeReasonOf(typed, "grace#0"), "Ticket closed by grace#0");
    assert.equal(transcriptFileName(typed, 42), "ticket-42.txt");
  });

  test("a customised wording is used, and cut to what Discord accepts", () => {
    const { labels } = resolve({
      labels: {
        topicWithSubject: "{username}: {subject}",
        closeReason: "Closed by {tag}",
        transcript: { fileName: "case-{number}.log" },
      },
    });
    const typed = labels as never;
    assert.equal(topicOf(typed, "ada#0", "ada", "Help"), "ada: Help");
    assert.equal(topicOf(typed, "ada#0", "ada", "x".repeat(2000)).length <= 1024, true);
    assert.equal(closeReasonOf(typed, "grace#0"), "Closed by grace#0");
    assert.equal(transcriptFileName(typed, 7), "case-7.log");
  });

  test("a file name with path characters cannot escape the attachment", () => {
    const { labels } = resolve({ labels: { transcript: { fileName: "..\\logs/{number}.txt" } } });
    assert.equal(transcriptFileName(labels as never, 3), "..-logs-3.txt");
  });

  test("a template that names something the module cannot fill is refused", () => {
    const result = registry.resolveSettings("tickets", {
      category: CATEGORY,
      supportRoles: [ROLE],
      labels: { channelName: "ticket-{reason}" },
    });
    assert.equal(result.ok, false);
    assert.equal(registry.resolveSettings("tickets", { general: { channelName: "ticket-{opener}" } }).ok, false);
  });

  test("every limited string is held to Discord's limit", () => {
    const summary = registry.describe().find((entry) => entry.id === "tickets");
    const top = summary?.schema.fields as Record<string, FieldDescriptor>;
    const labels = top.labels;
    const fields = labels?.fields as Record<string, FieldDescriptor>;
    const general = top.general?.fields as Record<string, FieldDescriptor>;
    assert.equal(fields.modalTitle?.max, 45);
    assert.equal(fields.reasonTitle?.max, 45);
    assert.equal(fields.reasonQuestion?.max, 45);
    for (const key of ["closeButton", "claimButton", "unclaimButton", "reopenButton", "deleteButton", "requestCloseButton", "keepOpenButton"]) {
      assert.equal(fields[key]?.max, 80, key);
    }
    assert.ok((fields.closeReason?.max as number) <= 512);
    assert.ok((fields.topicWithSubject?.max as number) <= 1024);
    assert.equal(labels?.layout, "fields");
    assert.deepEqual(general.channelName?.placeholders, ["username", "type", "number"]);
    assert.equal(general.channelName?.max, 90);
  });
});

describe("the channel name", () => {
  test("is ticket- and the member's name by default", () => {
    assert.equal(ticketChannelName("Alex"), "ticket-alex");
    assert.equal(ticketChannelName("Alex Smith!!", "ticket-{username}"), "ticket-alex-smith");
  });

  test("follows the owner's pattern and is still made safe for Discord", () => {
    assert.equal(ticketChannelName("Alex", "Help Desk {username}"), "help-desk-alex");
    assert.equal(ticketChannelName("Alex", "{username}__support"), "alex__support");
    assert.equal(ticketChannelName("!!!", "help-{username}"), "help-member");
  });

  test("falls back to the default shape when the pattern leaves nothing", () => {
    assert.equal(ticketChannelName("Alex", "!!!"), "ticket-alex");
  });

  test("stays under the length Discord accepts", () => {
    assert.ok(ticketChannelName("a".repeat(200), "{username}{username}").length <= 90);
  });
});

describe("the transcript wording", () => {
  const meta = {
    guildName: "Northwind",
    channelName: "ticket-ada",
    ticketId: 7,
    openerTag: "ada",
    subject: null,
    openedAt: Date.parse("2026-01-01T00:00:00.000Z"),
    closedAt: Date.parse("2026-01-01T01:00:00.000Z"),
    closedByTag: "grace",
  };
  const message = {
    authorTag: "ada",
    authorId: "1",
    timestamp: Date.parse("2026-01-01T00:05:00.000Z"),
    content: null,
    attachmentUrls: ["https://cdn.example/a.png"],
  };

  test("the settings default to the built-in wording", () => {
    const { labels } = resolve();
    assert.deepEqual(transcriptTexts(labels as never), DEFAULT_TRANSCRIPT_TEXTS);
    assert.equal(
      renderTranscript(meta, [message], transcriptTexts(labels as never)),
      renderTranscript(meta, [message]),
    );
  });

  test("the default text is the transcript the module has always written", () => {
    assert.equal(
      renderTranscript(meta, [message]),
      [
        "Ticket #7 - Northwind / #ticket-ada",
        "Opened by ada at 2026-01-01 00:00:00 UTC",
        "Subject: (none given)",
        "Closed by grace at 2026-01-01 01:00:00 UTC",
        "",
        "[2026-01-01 00:05:00 UTC] ada (1)",
        "(message content unavailable)",
        "  attachment: https://cdn.example/a.png",
        "",
      ].join("\n"),
    );
    assert.ok(renderTranscript(meta, []).endsWith("(no messages were sent in this ticket)"));
  });

  test("every line can be reworded", () => {
    const { labels } = resolve({
      labels: {
        transcript: {
          title: "Ticket {number} on {server} ({channel})",
          opened: "Started by {opener} on {time}",
          subject: "About: {subject}",
          noSubject: "nothing",
          closed: "Finished by {closer} on {time}",
          line: "{author} said, at {time}:",
          attachment: "file: {url}",
          unavailable: "(gone)",
        },
      },
    });
    const text = renderTranscript(meta, [message], transcriptTexts(labels as never));
    assert.deepEqual(text.split("\n").slice(0, 8), [
      "Ticket 7 on Northwind (ticket-ada)",
      "Started by ada on 2026-01-01 00:00:00 UTC",
      "About: nothing",
      "Finished by grace on 2026-01-01 01:00:00 UTC",
      "",
      "ada said, at 2026-01-01 00:05:00 UTC:",
      "(gone)",
      "file: https://cdn.example/a.png",
    ]);
  });

  test("the empty-ticket line is its own setting", () => {
    const { labels } = resolve({ labels: { transcript: { empty: "Nobody spoke." } } });
    assert.ok(renderTranscript(meta, [], transcriptTexts(labels as never)).endsWith("\nNobody spoke."));
  });
});

describe("the inactivity setting", () => {
  test("the closing message before an automatic close is off unless asked for", () => {
    const off = resolve({ autoClose: { enabled: true } });
    assert.equal(off.automation.autoClose.notice, false);
    const on = resolve({ autoClose: { enabled: true, notice: true } });
    assert.equal(on.automation.autoClose.notice, true);
  });
});
