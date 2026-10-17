import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isSameOriginRequest } from "../lib/mod-proxy.ts";

const request = (method: string, headers: Record<string, string>) => ({ method, headers: { get: (name: string) => headers[name] ?? null } });

describe("isSameOriginRequest", () => {
  test("lets a write from a dashboard page through", () => {
    assert.equal(isSameOriginRequest(request("PATCH", { host: "dash.example", origin: "https://dash.example", "sec-fetch-site": "same-origin" })), true);
  });

  test("refuses a write from another site, a sibling subdomain or with no origin", () => {
    assert.equal(isSameOriginRequest(request("PATCH", { host: "dash.example", origin: "https://evil.example", "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOriginRequest(request("POST", { host: "dash.example", origin: "https://blog.dash.example", "sec-fetch-site": "same-site" })), false);
    assert.equal(isSameOriginRequest(request("POST", { host: "dash.example" })), false);
  });
});

describe("the settings, commands and row action routes", () => {
  const routes = [
    "../app/api/guilds/[id]/modules/[moduleId]/route.ts",
    "../app/api/guilds/[id]/commands/[name]/route.ts",
    "../app/api/guilds/[id]/modules/[moduleId]/rows/[path]/actions/[action]/route.ts",
  ];

  test("check the origin of a write before they check anything else", () => {
    for (const route of routes) {
      const source = readFileSync(resolve(import.meta.dirname, route), "utf8");
      const check = source.indexOf("crossOriginWriteResponse(request)");
      assert.ok(check > 0, `${route} does not check the origin`);
      assert.ok(check < source.indexOf("requireGuildAccess(id)"), `${route} checks access first`);
    }
  });
});
