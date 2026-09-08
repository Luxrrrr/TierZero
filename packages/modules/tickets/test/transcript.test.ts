import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderTranscript } from "../dist/transcript.js";

const META = {
  guildName: "Test Guild",
  channelName: "ticket-alex",
  ticketId: 7,
  openerTag: "alex#0001",
  subject: "Cannot access my order",
  openedAt: Date.parse("2026-01-01T00:00:00.000Z"),
  closedAt: Date.parse("2026-01-01T01:00:00.000Z"),
  closedByTag: "staff#0002",
};

describe("renderTranscript", () => {
  test("includes the header fields", () => {
    const text = renderTranscript(META, []);
    assert.match(text, /Ticket #7 - Test Guild \/ #ticket-alex/);
    assert.match(text, /Opened by alex#0001/);
    assert.match(text, /Subject: Cannot access my order/);
    assert.match(text, /Closed by staff#0002/);
  });

  test("says plainly when no messages were sent", () => {
    const text = renderTranscript(META, []);
    assert.match(text, /no messages were sent/);
  });

  test("renders messages in the order given, with attachments listed", () => {
    const text = renderTranscript(META, [
      {
        authorTag: "alex#0001",
        authorId: "1",
        timestamp: Date.parse("2026-01-01T00:05:00.000Z"),
        content: "Here is a screenshot",
        attachmentUrls: ["https://cdn.example/a.png"],
      },
      {
        authorTag: "staff#0002",
        authorId: "2",
        timestamp: Date.parse("2026-01-01T00:10:00.000Z"),
        content: "Looking into it",
        attachmentUrls: [],
      },
    ]);
    const screenshotIndex = text.indexOf("Here is a screenshot");
    const lookingIndex = text.indexOf("Looking into it");
    assert.ok(screenshotIndex > -1 && lookingIndex > -1);
    assert.ok(screenshotIndex < lookingIndex);
    assert.match(text, /attachment: https:\/\/cdn\.example\/a\.png/);
  });

  test("marks a message with unknown content rather than printing undefined", () => {
    const text = renderTranscript(META, [
      { authorTag: "alex#0001", authorId: "1", timestamp: META.openedAt, content: null, attachmentUrls: [] },
    ]);
    assert.doesNotMatch(text, /undefined/);
    assert.match(text, /content unavailable/);
  });

  test("shows a placeholder subject when none was given", () => {
    const text = renderTranscript({ ...META, subject: null }, []);
    assert.match(text, /Subject: \(none given\)/);
  });
});
