import { test } from "node:test";
import assert from "node:assert/strict";
import { channelNamePreview, fillTemplate, sampleValues } from "../lib/template-samples.ts";

test("a template preview fills placeholders from the schema, shared stand-ins, then the server", () => {
  const values = sampleValues(["position", "name", "level", "unknown"], { position: "3" }, "Northwind Gaming");
  assert.equal(values.position, "3");
  assert.equal(values.name, "FragMuffin");
  assert.equal(values.level, "5");
  assert.equal(values.server, "Northwind Gaming");
  assert.equal("unknown" in values, false);
});

test("a template preview without a server name says so plainly", () => {
  assert.equal(sampleValues([], undefined, undefined).server, "Your server");
});

test("a channel name previews the way Discord writes it", () => {
  assert.equal(channelNamePreview(fillTemplate("Ticket {username}", { username: "FragMuffin" })), "ticket-fragmuffin");
  assert.equal(channelNamePreview("  Bug   report!! #12 "), "bug-report-12");
  assert.equal(channelNamePreview("Жалоба игрока"), "жалоба-игрока");
  assert.equal(channelNamePreview("{unknown}"), "unknown");
  assert.equal(channelNamePreview("x".repeat(150)).length, 100);
});
