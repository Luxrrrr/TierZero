import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TICKET_REPLY_QUOTE_MAX, readTicketReply, ticketReplyQuoteLine, ticketReplySnippet } from "../dist/index.js";

const ID = "140000000000000001";

describe("replying to a message", () => {
  test("the id of the message passes through, and a reply without one is unchanged", () => {
    assert.deepEqual(readTicketReply({ content: "hi", replyToMessageId: ID }), { ok: true, value: { content: "hi", replyToMessageId: ID } });
    assert.deepEqual(readTicketReply({ content: "hi", replyToMessageId: null }), { ok: true, value: { content: "hi" } });
    assert.deepEqual(readTicketReply({ content: "hi" }), { ok: true, value: { content: "hi" } });
  });

  test("anything that is not a message id is refused with a sentence", () => {
    for (const bad of ["abc", "12", "1".repeat(40), 123, {}, ""]) {
      const read = readTicketReply({ content: "hi", replyToMessageId: bad });
      assert.equal(read.ok, false, String(bad));
      if (!read.ok) assert.match(read.error, /replying to/);
    }
  });

  test("an id does not make an empty reply sendable", () => {
    assert.equal(readTicketReply({ content: "", replyToMessageId: ID }).ok, false);
  });
});

describe("the snippet quoted above a reply", () => {
  test("reads as one plain line with nothing in it that pings or formats", () => {
    assert.equal(ticketReplySnippet({ content: "**Hi** <@123456789012345678> and <@&123456789012345678>\n in <#123456789012345678>" }), "Hi @user and @role in #channel");
    assert.equal(ticketReplySnippet({ content: "see https://example.com/x?y=1 now" }), "see link now");
    assert.equal(ticketReplySnippet({ content: "-# small\n> quoted [a](b)" }), "small quoted a(b)");
    assert.equal(ticketReplySnippet({ content: "<:wave:123456789012345678> hi" }), ":wave: hi");
  });

  test("is cut to the limit with an ellipsis", () => {
    const snippet = ticketReplySnippet({ content: "word ".repeat(40) });
    assert.ok(snippet.length <= TICKET_REPLY_QUOTE_MAX);
    assert.ok(snippet.endsWith("…"));
    assert.equal(ticketReplySnippet({ content: "x".repeat(10) }, 5), "xxxx…");
  });

  test("a message with no text reads as what it carries", () => {
    assert.equal(ticketReplySnippet({ content: "", attachments: [{}] }), "an attachment");
    assert.equal(ticketReplySnippet({ content: " ", embeds: [{ title: "Receipt" }] }), "Receipt");
    assert.equal(ticketReplySnippet({ content: "", embeds: [{}] }), "an embed");
    assert.equal(ticketReplySnippet({ content: "" }), "a message");
  });
});

describe("the quote line", () => {
  test("is a small linked line, and a name cannot break out of it", () => {
    assert.equal(ticketReplyQuoteLine("Ada", "cannot log in", "https://discord.com/channels/1/2/3"), "-# ↩ [replying to @Ada: cannot log in](<https://discord.com/channels/1/2/3>)");
    const line = ticketReplyQuoteLine("**@everyone** <@123>](x)", "hi", "https://discord.com/channels/1/2/3");
    assert.ok(!line.includes("**"));
    assert.ok(!line.includes("<@"));
    assert.ok(line.startsWith("-# ↩ [replying to @everyone"));
  });
});
