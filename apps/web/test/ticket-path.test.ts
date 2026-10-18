import { test } from "node:test";
import assert from "node:assert/strict";
import { isTicketWorkspacePath } from "../lib/ticket-path.ts";

const G = "123456789012345678";

test("the workspace pages are told apart from settings and setup", () => {
  assert.equal(isTicketWorkspacePath(`/guilds/${G}/tickets`), true);
  assert.equal(isTicketWorkspacePath(`/guilds/${G}/tickets/66`), true);
  assert.equal(isTicketWorkspacePath(`/guilds/${G}/tickets/transcripts`), true);
  assert.equal(isTicketWorkspacePath(`/guilds/${G}/tickets/stats?range=7`), true);
  assert.equal(isTicketWorkspacePath(`/guilds/${G}/tickets/settings`), false);
  assert.equal(isTicketWorkspacePath(`/guilds/${G}/tickets/setup`), false);
  assert.equal(isTicketWorkspacePath(`/guilds/${G}/mod`), false);
  assert.equal(isTicketWorkspacePath(""), false);
});
