import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { embedReply, s, type FieldDescriptor, type FieldTopic } from "@tier0/core";
import {
  collectMessageRows,
  currentMessage,
  filterMessages,
  groupBySection,
  groupByTopic,
  isChanged,
  listedFields,
  listedMessages,
  topicSize,
  viewOf,
} from "../lib/bot-messages.ts";

const TOPICS: FieldTopic[] = [
  { id: "open", label: "While a ticket is open" },
  { id: "closes", label: "When a ticket closes" },
  { id: "wrong", label: "When something goes wrong" },
  { id: "denied", label: "Not allowed", within: "wrong" },
  { id: "busy", label: "Cannot do that right now", within: "wrong" },
];

const say = (label: string, text: string, extra: Record<string, unknown> = {}) =>
  s.message({ label, help: `When ${label.toLowerCase()}.`, starting: embedReply(text, "info"), compact: true, ...extra });

const schema = s
  .object({
    transcripts: s.object({
      postFile: s.boolean({ label: "Post the transcript file", default: true }),
      message: say("Transcript posted", "Transcript for #{number}", { topic: "closes", audience: "public", when: { field: "postFile", equals: true } }),
      notListed: say("Not listed", "Stays in its own section"),
    }),
    messages: s.object(
      {
        claimed: say("Claimed", "{user} claimed this", { topic: "open", audience: "public" }),
        closing: say("Closing", "Closing this ticket", { topic: "closes" }),
        loose: say("Loose", "Names no heading"),
        refusals: s.object(
          {
            notStaff: say("Support staff only", "You need a support role"),
            alreadyClosed: say("Already closed", "This ticket is already closed", { topic: "busy" }),
          },
          { topic: "denied" },
        ),
      },
      { label: "What the bot says", layout: "messages", topics: TOPICS },
    ),
  })
  .describe();
const rootFields = schema.fields as Record<string, FieldDescriptor>;

describe("a messages list", () => {
  test("lists its own messages under their headings, then messages elsewhere that name one", () => {
    const entries = listedMessages("messages", rootFields, {});
    assert.deepEqual(
      entries.map((entry) => [entry.path, entry.topic]),
      [
        ["messages.claimed", "open"],
        ["messages.closing", "closes"],
        ["messages.loose", null],
        ["messages.refusals.notStaff", "denied"],
        ["messages.refusals.alreadyClosed", "busy"],
        ["transcripts.message", "closes"],
      ],
    );
    assert.equal(entries[0]?.audience, "public");
    assert.equal(entries[1]?.audience, null);
  });

  test("says when a borrowed message is not sent because its switch is off", () => {
    const on = listedMessages("messages", rootFields, {}).find((entry) => entry.path === "transcripts.message");
    assert.equal(on?.unused, null);
    const off = listedMessages("messages", rootFields, { transcripts: { postFile: false } }).find((entry) => entry.path === "transcripts.message");
    assert.equal(off?.unused, "Not sent while Post the transcript file is off.");
  });

  test("groups by heading in declared order, nesting sub-headings and ending with the rest", () => {
    const groups = groupByTopic(listedMessages("messages", rootFields, {}), TOPICS, "Other messages");
    assert.deepEqual(
      groups.map((group) => [group.label, group.items.map((item) => item.label), group.children.map((child) => [child.label, child.items.length])]),
      [
        ["While a ticket is open", ["Claimed"], []],
        ["When a ticket closes", ["Closing", "Transcript posted"], []],
        ["When something goes wrong", [], [["Not allowed", 1], ["Cannot do that right now", 1]]],
        ["Other messages", ["Loose"], []],
      ],
    );
    assert.equal(topicSize(groups[2]!), 2);
  });

  test("leaves out a heading with nothing under it", () => {
    const groups = groupByTopic([{ topic: "open" }], TOPICS, "Other");
    assert.deepEqual(groups.map((group) => group.id), ["open"]);
  });

  test("knows a customised message from one saved with the default's wording", () => {
    const [claimed] = listedMessages("messages", rootFields, {});
    assert.ok(claimed);
    assert.equal(currentMessage(claimed, {}).customised, false);
    const same = { messages: { claimed: embedReply("{user} claimed this", "info") } };
    assert.equal(currentMessage(claimed, same).customised, false);
    const changed = { messages: { claimed: embedReply("{user} is on it", "info") } };
    assert.equal(currentMessage(claimed, changed).customised, true);
    assert.equal(currentMessage(claimed, changed).body.embeds[0]?.description, "{user} is on it");
  });

  test("searches the title, the when line and the current wording, and can show only customised ones", () => {
    const root = { messages: { closing: embedReply("Wrapping up, gg", "info") } };
    const entries = listedMessages("messages", rootFields, root);
    const paths = (query: string, customisedOnly = false) => filterMessages(entries, root, query, customisedOnly).map((entry) => entry.path);
    assert.deepEqual(paths("claimed"), ["messages.claimed"]);
    assert.deepEqual(paths("gg wrapping"), ["messages.closing"]);
    assert.deepEqual(paths("when already"), ["messages.refusals.alreadyClosed"]);
    assert.deepEqual(paths("", true), ["messages.closing"]);
    assert.deepEqual(paths("claimed", true), []);
  });
});

describe("a fields list", () => {
  test("files each setting under its own heading or its group's", () => {
    const group = s
      .object(
        {
          closeButton: s.string({ default: "Close ticket", topic: "buttons" }),
          formTitle: s.string({ default: "Open a ticket", topic: "forms" }),
          transcript: s.object({ fileName: s.string({ default: "ticket.txt" }) }, { topic: "transcript" }),
          other: s.string({ default: "x" }),
        },
        { layout: "fields", topics: [{ id: "buttons", label: "Buttons" }, { id: "forms", label: "Forms" }, { id: "transcript", label: "Transcript" }] },
      )
      .describe();
    assert.deepEqual(
      listedFields(group).map((entry) => [entry.key, entry.topic]),
      [
        ["closeButton", "buttons"],
        ["formTitle", "forms"],
        ["transcript", "transcript"],
        ["other", null],
      ],
    );
  });

  test("counts a setting as changed only when it holds something other than its default", () => {
    const field = s.string({ default: "Claim" }).describe();
    assert.equal(isChanged(field, undefined), false);
    assert.equal(isChanged(field, ""), false);
    assert.equal(isChanged(field, "Claim"), false);
    assert.equal(isChanged(field, "Grab it"), true);
  });
});

describe("the Bot messages page", () => {
  test("files a feature's messages under its headings, after the sections it does not head", () => {
    const module = { id: "tickets", name: "Tickets", enabled: true, schema: schema as Record<string, unknown>, commands: [] };
    const rows = collectMessageRows([module], { tickets: {} });
    const views = new Map(rows.map((row) => [row.key, viewOf(row, { tickets: {} }, {})]));
    assert.deepEqual(
      groupBySection(rows, views).map((section) => [section.title, section.rows.map((row) => row.label)]),
      [
        ["Transcripts", ["Not listed"]],
        ["What the bot says", ["Loose"]],
        ["While a ticket is open", ["Claimed"]],
        ["When a ticket closes", ["Transcript posted", "Closing"]],
        ["Not allowed", ["Support staff only"]],
        ["Cannot do that right now", ["Already closed"]],
      ],
    );
  });
});
