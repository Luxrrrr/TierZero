import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { emptyEmbed } from "@tier0/core";
import { buildReply, storedReply } from "../dist/runtime/command-reply.js";

describe("storedReply", () => {
  test("reads a saved message back", () => {
    const body = { content: "Done", embeds: [{ ...emptyEmbed(), title: "Case {case}" }], buttons: [], selects: [], reactions: [] };
    const read = storedReply({ responseBody: JSON.stringify(body), response: null });
    assert.equal(read?.content, "Done");
    assert.equal(read?.embeds[0]?.title, "Case {case}");
  });

  test("reads text saved before replies were whole messages as a message of just that text", () => {
    const read = storedReply({ responseBody: null, response: "Warned {user}." });
    assert.equal(read?.content, "Warned {user}.");
    assert.deepEqual(read?.embeds, []);
  });

  test("a newer saved message wins over old text", () => {
    const read = storedReply({ responseBody: JSON.stringify({ content: "new" }), response: "old" });
    assert.equal(read?.content, "new");
  });

  test("a damaged or empty row means no reply", () => {
    assert.equal(storedReply(null), null);
    assert.equal(storedReply({ responseBody: null, response: null }), null);
    assert.equal(storedReply({ responseBody: null, response: "   " }), null);
    assert.equal(storedReply({ responseBody: "{not json", response: null }), null);
    assert.equal(storedReply({ responseBody: JSON.stringify({ content: "", embeds: [] }), response: null }), null);
  });
});

describe("buildReply", () => {
  test("fills in values, and keeps @everyone from pinging", () => {
    const options = buildReply({ content: "Warned {user}. @everyone", embeds: [], buttons: [], selects: [], reactions: [] }, { user: "ada" });
    assert.equal(options?.content, "Warned ada. @everyone");
    assert.deepEqual(options?.allowedMentions, { parse: ["users", "roles"] });
  });

  test("gives up, so the command says its own thing, when filling in breaks a limit", () => {
    const options = buildReply({ content: "{big}", embeds: [], buttons: [], selects: [], reactions: [] }, { big: "x".repeat(2001) });
    assert.equal(options, null);
  });
});
