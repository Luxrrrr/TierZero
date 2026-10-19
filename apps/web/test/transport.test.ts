import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hostnameOf, isExposedPlainHttp, isPrivateHost } from "../lib/transport.ts";

const open = (host: string, forwardedProto: string | null = null, protocol = "http:") =>
  isExposedPlainHttp({ host, forwardedProto, protocol });

describe("hostnameOf", () => {
  test("drops the port and the IPv6 brackets", () => {
    assert.equal(hostnameOf("localhost:8080"), "localhost");
    assert.equal(hostnameOf("[::1]:8080"), "::1");
    assert.equal(hostnameOf("Example.COM."), "example.com");
    assert.equal(hostnameOf("192.168.1.20"), "192.168.1.20");
  });
});

describe("isPrivateHost", () => {
  test("loopback, home network and Tailscale addresses are private", () => {
    for (const host of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.20", "169.254.1.1", "100.101.102.103", "::1", "fd12:3456::1", "fe80::1", "::ffff:192.168.1.5", "::ffff:c0a8:105"]) {
      assert.equal(isPrivateHost(host), true, host);
    }
  });

  test("public addresses are not private", () => {
    for (const host of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "100.63.0.1", "100.128.0.1", "192.169.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808", ""]) {
      assert.equal(isPrivateHost(host), false, host);
    }
  });

  test("a machine's own name and local-network suffixes are private, a public domain is not", () => {
    for (const host of ["localhost", "my-pc", "my-pc.local", "nas.lan", "box.home.arpa", "pc.tailnet-name.ts.net"]) {
      assert.equal(isPrivateHost(host), true, host);
    }
    for (const host of ["tierzero.example.com", "example.com", "localhost.example.com", "evil.ts.net.example.com"]) {
      assert.equal(isPrivateHost(host), false, host);
    }
  });
});

describe("isExposedPlainHttp", () => {
  test("plain HTTP on this machine, a home network or Tailscale is fine", () => {
    for (const host of ["localhost:8080", "127.0.0.1:8081", "192.168.1.20:8080", "my-pc.tailnet-name.ts.net:8080", "100.101.102.103:8080"]) {
      assert.equal(open(host), false, host);
    }
  });

  test("plain HTTP to a public address or domain is exposed", () => {
    for (const host of ["203.0.113.7:8080", "tierzero.example.com", "tierzero.example.com:8080", "[2606:4700:4700::1111]:8080"]) {
      assert.equal(open(host), true, host);
    }
  });

  test("HTTPS is fine anywhere, whether the connection or the proxy says so", () => {
    assert.equal(open("tierzero.example.com", null, "https:"), false);
    assert.equal(open("tierzero.example.com", "https"), false);
    assert.equal(open("tierzero.example.com", "https, http"), false);
  });

  test("a proxy that reports http does not make a public address safe", () => {
    assert.equal(open("tierzero.example.com", "http", "https:"), true);
  });

  test("a missing host counts as exposed", () => {
    assert.equal(isExposedPlainHttp({ host: null, forwardedProto: null, protocol: "http:" }), true);
  });
});
