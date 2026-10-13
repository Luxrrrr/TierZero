import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { messageSummary, plainText } from "../lib/message-summary.ts";

describe("plainText", () => {
  test("removes formatting marks and keeps the words", () => {
    assert.equal(plainText("**Bold** and __under__ and ~~gone~~ and `code`"), "Bold and under and gone and code");
  });

  test("keeps the text of a link and drops the address", () => {
    assert.equal(plainText("Read [the rules](https://example.com/rules) first"), "Read the rules first");
  });

  test("turns a custom emoji into its name", () => {
    assert.equal(plainText("Hi <:wave:123456789012345678>"), "Hi :wave:");
  });

  test("strips heading, quote and list markers from line starts", () => {
    assert.equal(plainText("# Title\n> quoted\n- item"), "Title quoted item");
  });

  test("leaves variables alone", () => {
    assert.equal(plainText("Welcome {user} to {server}"), "Welcome {user} to {server}");
  });

  test("collapses whitespace", () => {
    assert.equal(plainText("a \n\n  b"), "a b");
  });
});

describe("messageSummary", () => {
  test("prefers the text of the message", () => {
    const message = { content: "Deleted a message", embeds: [{ title: "T", description: "D" }] };
    assert.equal(messageSummary(message), "Deleted a message");
  });

  test("falls back to the first embed title, then its description", () => {
    assert.equal(messageSummary({ content: "  ", embeds: [{ title: "Member warned", description: "D" }] }), "Member warned");
    assert.equal(messageSummary({ content: "", embeds: [{ title: "", description: "{user} was warned" }] }), "{user} was warned");
  });

  test("reads text saved before the setting held messages", () => {
    assert.equal(messageSummary("Welcome in"), "Welcome in");
  });

  test("says so when a message has no text at all", () => {
    assert.equal(messageSummary({ content: "", embeds: [] }), "No text");
    assert.equal(messageSummary(null), "No text");
    assert.equal(messageSummary({ content: "", embeds: [{}] }), "Embed");
  });

  test("cuts a long message with an ellipsis", () => {
    const text = messageSummary({ content: "word ".repeat(60) }, 40);
    assert.ok(text.endsWith("…"));
    assert.ok(text.length <= 40);
  });
});
