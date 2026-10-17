import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { failureFromBody, ownerMessage, plainSystemText, readsAsSentence } from "../lib/bot-errors.ts";

describe("failureFromBody", () => {
  test("reads the bot's { error } instead of showing the JSON", () => {
    const failure = failureFromBody(500, JSON.stringify({ error: "boom" }));
    assert.doesNotMatch(failure.message, /[{}"]/);
    assert.equal(failure.message, "The bot ran into a problem with that. Try again, and check the bot's log if it keeps happening.");
  });

  test("turns the bot's internal wording into what an owner can act on", () => {
    assert.equal(
      failureFromBody(404, JSON.stringify({ error: "guild not found" })).message,
      "The bot is not in this server any more. Invite it again from Your servers.",
    );
    assert.equal(
      failureFromBody(404, JSON.stringify({ error: "unknown module" })).message,
      "This feature is not part of this install any more. Reload the page.",
    );
    assert.equal(
      failureFromBody(400, JSON.stringify({ error: "enabled must be a boolean" })).message,
      "The bot could not use that change. Reload the page and try again.",
    );
  });

  test("keeps a refusal that is already a sentence for a person", () => {
    const said = "Leveling is off on this server, so its rewards cannot be sent.";
    assert.equal(failureFromBody(409, JSON.stringify({ error: said })).message, said);
  });

  test("hands field errors on for the form and still gives one sentence", () => {
    const failure = failureFromBody(400, JSON.stringify({ errors: [{ path: "xp.min", message: "must be at least 1" }, { bad: true }] }));
    assert.deepEqual(failure.fieldErrors, [{ path: "xp.min", message: "must be at least 1" }]);
    assert.equal(typeof failure.message, "string");
  });

  test("copes with an empty body, plain text and an HTML error page", () => {
    assert.equal(failureFromBody(429, "").message, "The bot is busy. Wait a minute, then try again.");
    assert.equal(failureFromBody(503, "<html><body>Bad gateway</body></html>").message, "The dashboard could not reach the bot. Check the bot is running, then try again.");
    assert.equal(failureFromBody(500, "not json {").message.startsWith("The bot ran into a problem"), true);
  });

  test("falls back by status family for a status it has no sentence for", () => {
    assert.match(failureFromBody(599, "").message, /^The bot ran into a problem/);
    assert.equal(failureFromBody(418, "").message, "The bot did not accept that. Try again in a moment.");
  });
});

describe("plainSystemText", () => {
  test("rewrites a DNS failure and keeps what the module said around it", () => {
    assert.equal(
      plainSystemText("Nothing was sent: getaddrinfo ENOTFOUND retro-corner.example."),
      "Nothing was sent: the address retro-corner.example could not be found. Check it is spelled right.",
    );
  });

  test("rewrites the other network codes owners hit", () => {
    assert.match(plainSystemText("connect ECONNREFUSED 10.0.0.1:443"), /^The other end refused the connection/);
    assert.match(plainSystemText("read ECONNRESET"), /^The connection was cut off/);
    assert.match(plainSystemText("Could not fetch: unable to verify the first certificate"), /security certificate/);
  });

  test("leaves a message without a system code alone", () => {
    assert.equal(plainSystemText("Sent 3 posts."), "Sent 3 posts.");
  });

  test("is used for the bot's own error text too", () => {
    assert.match(ownerMessage(502, "getaddrinfo ENOTFOUND bot"), /could not be found/);
  });
});

describe("readsAsSentence", () => {
  test("tells a sentence from an internal code", () => {
    assert.equal(readsAsSentence("Leveling is off on this server."), true);
    assert.equal(readsAsSentence("guild not found"), false);
    assert.equal(readsAsSentence("Error: something at file.js:10"), false);
    assert.equal(readsAsSentence("ENOTFOUND"), false);
  });
});
