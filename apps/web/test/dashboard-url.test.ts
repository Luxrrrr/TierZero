import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isLocalOrigin,
  normaliseOrigin,
  originFromHeaders,
  shouldStoreDashboardUrl,
} from "../lib/dashboard-url.ts";

const headers = (extra: Partial<Parameters<typeof originFromHeaders>[0]>) => ({
  host: null,
  forwardedHost: null,
  forwardedProto: null,
  ...extra,
});

describe("originFromHeaders", () => {
  test("uses the forwarded host and protocol behind a proxy", () => {
    assert.equal(
      originFromHeaders(headers({ host: "web:8080", forwardedHost: "mod.example.com", forwardedProto: "https" })),
      "https://mod.example.com",
    );
  });

  test("falls back to host, assuming http", () => {
    assert.equal(originFromHeaders(headers({ host: "192.168.1.20:8081" })), "http://192.168.1.20:8081");
  });

  test("takes the first of a comma separated forwarded list", () => {
    assert.equal(
      originFromHeaders(headers({ forwardedHost: "a.example.com, b.example.com", forwardedProto: "https, http" })),
      "https://a.example.com",
    );
  });

  test("keeps an IPv6 literal and drops a default port", () => {
    assert.equal(originFromHeaders(headers({ host: "[::1]:3000" })), "http://[::1]:3000");
    assert.equal(originFromHeaders(headers({ host: "example.com:443", forwardedProto: "https" })), "https://example.com");
  });

  test("refuses hosts carrying a path, query, credentials or spaces", () => {
    for (const host of ["evil.com/x", "evil.com?x=1", "user:pw@evil.com", "a b.com", "evil.com#f", ""]) {
      assert.equal(originFromHeaders(headers({ host })), null, host);
    }
  });

  test("refuses protocols other than http and https", () => {
    assert.equal(originFromHeaders(headers({ host: "example.com", forwardedProto: "javascript" })), null);
    assert.equal(originFromHeaders(headers({ host: "example.com", forwardedProto: "ftp" })), null);
  });

  test("returns null with no host at all", () => {
    assert.equal(originFromHeaders(headers({})), null);
  });
});

describe("normaliseOrigin", () => {
  test("reduces a stored value to its origin", () => {
    assert.equal(normaliseOrigin("https://mod.example.com/some/path?x=1"), "https://mod.example.com");
  });

  test("rejects empty, malformed, non-http and credentialed values", () => {
    for (const value of [null, undefined, "", "not a url", "ftp://example.com", "https://u:p@example.com"]) {
      assert.equal(normaliseOrigin(value), null, String(value));
    }
  });
});

describe("isLocalOrigin", () => {
  test("recognises addresses only this machine can open", () => {
    for (const origin of [
      "http://localhost:8081",
      "http://127.0.0.1:8080",
      "http://127.1.2.3",
      "http://[::1]:3000",
      "http://dash.localhost",
      "http://0.0.0.0:8080",
    ]) {
      assert.equal(isLocalOrigin(origin), true, origin);
    }
  });

  test("does not mistake public or LAN addresses for local", () => {
    for (const origin of ["https://example.com", "http://192.168.1.20:8081", "https://notlocalhost.com", "https://localhost.example.com"]) {
      assert.equal(isLocalOrigin(origin), false, origin);
    }
  });
});

describe("shouldStoreDashboardUrl", () => {
  const local = "http://localhost:8081";
  const publicA = "https://mod.example.com";
  const publicB = "https://dash.example.org";

  test("stores anything when nothing is stored", () => {
    assert.equal(shouldStoreDashboardUrl(null, publicA), true);
    assert.equal(shouldStoreDashboardUrl(undefined, local), true);
    assert.equal(shouldStoreDashboardUrl("", publicA), true);
  });

  test("replaces a local address with a public one", () => {
    assert.equal(shouldStoreDashboardUrl(local, publicA), true);
  });

  test("never stores a local address over a public one", () => {
    assert.equal(shouldStoreDashboardUrl(publicA, local), false);
    assert.equal(shouldStoreDashboardUrl(publicA, "http://127.0.0.1:8081"), false);
  });

  test("never swaps one local address for another", () => {
    assert.equal(shouldStoreDashboardUrl(local, "http://localhost:3000"), false);
  });

  test("the latest public address wins", () => {
    assert.equal(shouldStoreDashboardUrl(publicA, publicB), true);
  });

  test("does nothing when the address is unchanged, even if written with a path", () => {
    assert.equal(shouldStoreDashboardUrl(publicA, publicA), false);
    assert.equal(shouldStoreDashboardUrl(`${publicA}/`, publicA), false);
  });

  test("replaces a stored value that is not a usable address", () => {
    assert.equal(shouldStoreDashboardUrl("garbage", publicA), true);
  });

  test("ignores a missing or malformed candidate", () => {
    assert.equal(shouldStoreDashboardUrl(publicA, null), false);
    assert.equal(shouldStoreDashboardUrl(null, "javascript:alert(1)"), false);
  });
});
