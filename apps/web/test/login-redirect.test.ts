import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loginHref, needsSession, safeNext } from "../lib/login-redirect.ts";

describe("safeNext", () => {
  test("keeps a path on this dashboard, with its query", () => {
    assert.equal(safeNext("/guilds/1/tickets/42"), "/guilds/1/tickets/42");
    assert.equal(safeNext("/guilds/1/mod/members/2?case=118"), "/guilds/1/mod/members/2?case=118");
  });

  test("refuses anything that could leave the site", () => {
    assert.equal(safeNext("https://evil.example/guilds"), null);
    assert.equal(safeNext("//evil.example"), null);
    assert.equal(safeNext("/\\evil.example"), null);
    assert.equal(safeNext("guilds"), null);
    assert.equal(safeNext("/guilds\n/x"), null);
  });

  test("refuses the sign-in and first-run screens, which would go round in a circle", () => {
    assert.equal(safeNext("/login"), null);
    assert.equal(safeNext("/setup"), null);
    assert.equal(safeNext("/api/auth/signin"), null);
  });

  test("takes the first of repeated values and nothing from nothing", () => {
    assert.equal(safeNext(["/help", "/guilds"]), "/help");
    assert.equal(safeNext(undefined), null);
    assert.equal(safeNext(""), null);
  });
});

describe("loginHref", () => {
  test("carries the page asked for", () => {
    assert.equal(loginHref("/guilds/1/commands"), "/login?next=%2Fguilds%2F1%2Fcommands");
  });

  test("stays plain for the server list, where sign-in lands anyway, and for anything unsafe", () => {
    assert.equal(loginHref("/guilds"), "/login");
    assert.equal(loginHref("//evil.example"), "/login");
    assert.equal(loginHref(null), "/login");
  });
});

describe("needsSession", () => {
  test("covers the signed-in pages and nothing before sign-in", () => {
    assert.equal(needsSession("/guilds"), true);
    assert.equal(needsSession("/guilds/1/tickets/42"), true);
    assert.equal(needsSession("/help"), true);
    assert.equal(needsSession("/login"), false);
    assert.equal(needsSession("/setup"), false);
    assert.equal(needsSession("/guildsx"), false);
  });
});
