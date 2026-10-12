import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { can } from "@tier0/core";
import { isProfileRead, isSameOriginWrite, modProxyPermission, utf8Length } from "../lib/mod-proxy.ts";

describe("modProxyPermission", () => {
  test("paths outside the allowlist are not served", () => {
    assert.equal(modProxyPermission("GET", ["config"]), null);
    assert.equal(modProxyPermission("GET", []), null);
    assert.equal(modProxyPermission("POST", ["guilds", "members"]), null);
  });

  test("dot segments are refused even under an allowed root", () => {
    assert.equal(modProxyPermission("GET", ["members", ".."]), null);
    assert.equal(modProxyPermission("GET", ["members", "."]), null);
    assert.equal(modProxyPermission("GET", ["members", ""]), null);
  });

  test("the CSV export needs the audit permission, so a moderator is refused", () => {
    const needed = modProxyPermission("GET", ["infractions", "export"]);
    assert.equal(needed, "audit.view");
    assert.equal(can("mod", needed!), false);
    assert.equal(can("admin", needed!), true);
    assert.equal(can("owner", needed!), true);
  });

  test("the plain action list stays open to every staff role", () => {
    assert.equal(modProxyPermission("GET", ["infractions"]), "view");
    assert.equal(modProxyPermission("GET", ["infractions", "42"]), "view");
  });

  test("audit and stats carry their own permissions", () => {
    assert.equal(modProxyPermission("GET", ["audit"]), "audit.view");
    assert.equal(modProxyPermission("GET", ["stats"]), "stats.view");
  });

  test("reading staff is open, changing it is owner only", () => {
    assert.equal(modProxyPermission("GET", ["staff"]), "view");
    assert.equal(modProxyPermission("POST", ["staff"]), "staff.manage");
    assert.equal(modProxyPermission("DELETE", ["staff", "123"]), "staff.manage");
  });

  test("member search is open to staff", () => {
    assert.equal(modProxyPermission("GET", ["member-search"]), "view");
  });
});

describe("modProxyPermission for taking action", () => {
  test("the action form's settings are readable by every staff role", () => {
    const needed = modProxyPermission("GET", ["actions", "context"]);
    assert.equal(needed, "view");
    for (const role of ["mod", "admin", "owner"] as const) assert.equal(can(role, needed!), true, role);
  });

  test("nothing else under the actions root is served", () => {
    assert.equal(modProxyPermission("POST", ["actions", "context"]), null);
    assert.equal(modProxyPermission("GET", ["actions"]), null);
    assert.equal(modProxyPermission("GET", ["actions", "other"]), null);
    assert.equal(modProxyPermission("GET", ["actions", "context", "extra"]), null);
  });

  test("a POST to a member's actions needs an action permission, which every staff role holds", () => {
    const needed = modProxyPermission("POST", ["members", "123", "actions"]);
    assert.equal(needed, "action.warn");
    for (const role of ["mod", "admin", "owner"] as const) assert.equal(can(role, needed!), true, role);
  });

  test("the actions path takes no other method", () => {
    for (const method of ["GET", "HEAD", "PATCH", "PUT", "DELETE"]) {
      assert.equal(modProxyPermission(method, ["members", "123", "actions"]), null, method);
    }
  });

  test("deeper paths under a member's actions are not served", () => {
    assert.equal(modProxyPermission("POST", ["members", "123", "actions", "ban"]), null);
    assert.equal(modProxyPermission("GET", ["members", "123", "actions", "ban"]), null);
  });

  test("dot segments are refused before the action rules apply", () => {
    assert.equal(modProxyPermission("POST", ["members", "..", "actions"]), null);
    assert.equal(modProxyPermission("GET", ["actions", ".."]), null);
  });

  test("unknown paths are still not served", () => {
    assert.equal(modProxyPermission("POST", ["ban"]), null);
    assert.equal(modProxyPermission("POST", ["action"]), null);
    assert.equal(modProxyPermission("GET", ["context"]), null);
  });

  test("the rest of a member's record keeps its permissions", () => {
    assert.equal(modProxyPermission("GET", ["members", "123"]), "view");
    assert.equal(modProxyPermission("POST", ["members", "123", "notes"]), "view");
  });
});

describe("isSameOriginWrite", () => {
  const base = { origin: null, secFetchSite: null, host: "dash.example:8080", forwardedHost: null };

  test("reads are never blocked", () => {
    assert.equal(isSameOriginWrite("GET", base), true);
  });

  test("a write from the same host passes", () => {
    assert.equal(
      isSameOriginWrite("POST", { ...base, origin: "http://dash.example:8080", secFetchSite: "same-origin" }),
      true,
    );
  });

  test("a write from another site is refused", () => {
    assert.equal(isSameOriginWrite("POST", { ...base, origin: "https://evil.example", secFetchSite: "cross-site" }), false);
    assert.equal(isSameOriginWrite("POST", { ...base, origin: "https://evil.example" }), false);
  });

  test("a same-site but different-origin request is refused", () => {
    assert.equal(
      isSameOriginWrite("PATCH", { ...base, origin: "http://dash.example:8080", secFetchSite: "same-site" }),
      false,
    );
  });

  test("a write with no Origin is refused", () => {
    assert.equal(isSameOriginWrite("DELETE", base), false);
  });

  test("a reverse proxy's forwarded host is accepted", () => {
    assert.equal(
      isSameOriginWrite("POST", {
        origin: "https://mod.example.org",
        secFetchSite: "same-origin",
        host: "web:3000",
        forwardedHost: "mod.example.org",
      }),
      true,
    );
  });

  test("a malformed Origin is refused", () => {
    assert.equal(isSameOriginWrite("POST", { ...base, origin: "not a url" }), false);
  });
});

test("utf8Length counts bytes, not characters", () => {
  assert.equal(utf8Length("abc"), 3);
  assert.equal(utf8Length("é"), 2);
});

describe("isProfileRead", () => {
  test("is true only for a GET of one member", () => {
    assert.equal(isProfileRead("GET", ["members", "123"]), true);
    assert.equal(isProfileRead("GET", ["members"]), false);
    assert.equal(isProfileRead("POST", ["members", "123", "notes"]), false);
    assert.equal(isProfileRead("GET", ["audit"]), false);
  });
});

describe("the danger zone", () => {
  test("only a DELETE is served, and it needs the owner-only purge permission", () => {
    assert.equal(modProxyPermission("DELETE", ["danger"]), "purge");
    assert.equal(modProxyPermission("GET", ["danger"]), null);
    assert.equal(modProxyPermission("DELETE", ["danger", "mod-logs"]), null);
    assert.equal(can("admin", "purge"), false);
    assert.equal(can("owner", "purge"), true);
  });
});

describe("editing a case", () => {
  test("only a PATCH of one case is served, with the edit permission", () => {
    assert.equal(modProxyPermission("PATCH", ["infractions", "4"]), "infraction.edit");
    assert.equal(can("mod", "infraction.edit"), true);
  });
});

describe("the message log", () => {
  test("reading needs the view permission and deleting needs purge", () => {
    assert.equal(modProxyPermission("GET", ["messages"]), "messages.view");
    assert.equal(modProxyPermission("GET", ["server-logs"]), "messages.view");
    assert.equal(modProxyPermission("DELETE", ["server-logs"]), "messages.purge");
    assert.equal(modProxyPermission("DELETE", ["messages"]), null);
  });

  test("nothing else under it is served", () => {
    assert.equal(modProxyPermission("POST", ["messages"]), null);
    assert.equal(modProxyPermission("GET", ["messages", "1"]), null);
    assert.equal(modProxyPermission("DELETE", ["messages", "1"]), null);
  });

  test("moderators can read it, and only the owner and admins can delete it", () => {
    assert.equal(can("mod", "messages.view"), true);
    assert.equal(can("mod", "messages.purge"), false);
    assert.equal(can("admin", "messages.purge"), true);
  });
});
