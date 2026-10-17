import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { modGate, restOfPath, ticketsGate } from "../lib/page-gate.ts";
import { applyPrePaint, prePaintScript } from "../lib/pre-paint.ts";

const G = "1100000000000000001";
const OK = { kind: "ok" };
const NO = { kind: "forbidden" };
const toSettings = { kind: "redirect", href: `/guilds/${G}/mod/settings` };

describe("restOfPath", () => {
  test("reads the part after the area, without a query or trailing slash", () => {
    assert.equal(restOfPath(`/guilds/${G}/mod`, G, "mod"), "");
    assert.equal(restOfPath(`/guilds/${G}/mod/`, G, "mod"), "");
    assert.equal(restOfPath(`/guilds/${G}/mod/access?x=1`, G, "mod"), "access");
    assert.equal(restOfPath(`/guilds/${G}/mod/members/220000000000000001`, G, "mod"), "members/220000000000000001");
  });

  test("is null for an address outside the area, so nothing is decided from it", () => {
    assert.equal(restOfPath("", G, "mod"), null);
    assert.equal(restOfPath(`/guilds/${G}/moderation`, G, "mod"), null);
    assert.equal(restOfPath(`/guilds/9/mod/access`, G, "mod"), null);
  });
});

describe("modGate, the 14 refusals that used to answer 200", () => {
  test("a ticket handler or a plain member who reached the layout is refused everywhere", () => {
    for (const rest of ["", "members", "actions", "audit", "server-logs", "access", "danger", "settings"]) {
      assert.deepEqual(modGate(rest, null, false, G), NO, rest);
    }
  });

  test("a manager who is not staff is sent to Settings, and refused on Access", () => {
    for (const rest of ["", "members", "members/220000000000000001", "actions", "audit", "server-logs", "danger"]) {
      assert.deepEqual(modGate(rest, null, true, G), toSettings, rest);
    }
    assert.deepEqual(modGate("access", null, true, G), NO);
    assert.deepEqual(modGate("settings", null, true, G), OK);
    assert.deepEqual(modGate("settings/automod", null, true, G), OK);
  });

  test("staff reach what their level allows and nothing else", () => {
    assert.deepEqual(modGate("access", "admin", false, G), NO);
    assert.deepEqual(modGate("audit", "admin", false, G), OK);
    assert.deepEqual(modGate("danger", "admin", false, G), NO);
    assert.deepEqual(modGate("settings", "admin", false, G), NO);
    assert.deepEqual(modGate("access", "mod", false, G), NO);
    assert.deepEqual(modGate("audit", "mod", false, G), NO);
    assert.deepEqual(modGate("members", "mod", false, G), OK);
    for (const rest of ["", "access", "danger", "audit"]) assert.deepEqual(modGate(rest, "owner", true, G), OK, rest);
  });

  test("Appeals and Raid tools are for admins and the owner", () => {
    for (const rest of ["appeals", "appeals/3", "raid"]) {
      assert.deepEqual(modGate(rest, "mod", false, G), NO, rest);
      assert.deepEqual(modGate(rest, null, false, G), NO, rest);
      assert.deepEqual(modGate(rest, "admin", false, G), OK, rest);
      assert.deepEqual(modGate(rest, "owner", true, G), OK, rest);
      assert.deepEqual(modGate(rest, null, true, G), toSettings, rest);
    }
  });

  test("an address it does not know is left to the page", () => {
    assert.deepEqual(modGate("something-new", null, false, G), OK);
    assert.deepEqual(modGate(null, null, false, G), OK);
  });
});

describe("ticketsGate", () => {
  test("Settings and the quick setup need Manage Server", () => {
    for (const level of ["handler", "admin"] as const) {
      assert.deepEqual(ticketsGate("settings", level, false), NO);
      assert.deepEqual(ticketsGate("setup", level, false), NO);
    }
    assert.deepEqual(ticketsGate("settings", "manager", true), OK);
  });

  test("the workspace needs a ticket level, or Manage Server", () => {
    assert.deepEqual(ticketsGate("", "handler", false), OK);
    assert.deepEqual(ticketsGate("45", "handler", false), OK);
    assert.deepEqual(ticketsGate("transcripts", null, false), NO);
    assert.deepEqual(ticketsGate("stats", null, true), OK);
  });
});

describe("the pre-paint script", () => {
  function run(stored: Record<string, string>, code?: string) {
    const attributes = new Map<string, string>([["data-theme", "stale"]]);
    const fake = {
      document: {
        documentElement: {
          setAttribute: (name: string, value: string) => attributes.set(name, value),
          removeAttribute: (name: string) => attributes.delete(name),
        },
      },
      localStorage: { getItem: (key: string) => stored[key] ?? null },
    };
    const saved = { document: (globalThis as Record<string, unknown>).document, localStorage: (globalThis as Record<string, unknown>).localStorage };
    Object.assign(globalThis, fake);
    try {
      if (code) new Function(code)();
      else applyPrePaint("theme", "sidebar", "data-sidebar");
    } finally {
      Object.assign(globalThis, saved);
    }
    return attributes;
  }

  test("puts the saved theme and the collapsed sidebar on the document", () => {
    const attributes = run({ theme: "dark", sidebar: "collapsed" });
    assert.equal(attributes.get("data-theme"), "dark");
    assert.equal(attributes.get("data-sidebar"), "collapsed");
  });

  test("falls back to the system theme for anything else", () => {
    assert.equal(run({ theme: "purple" }).has("data-theme"), false);
  });

  test("the inline script is the same function, called with its keys", () => {
    const attributes = run({ k1: "light", k2: "collapsed" }, prePaintScript(["k1", "k2", "data-side"]));
    assert.equal(attributes.get("data-theme"), "light");
    assert.equal(attributes.get("data-side"), "collapsed");
  });
});
