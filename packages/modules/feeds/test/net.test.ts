import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, safeFetch } from "../dist/net.js";

describe("isPublicAddress", () => {
  test("accepts ordinary public addresses", () => {
    for (const address of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"]) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });

  test("refuses loopback and private ranges", () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "0.0.0.0"]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  test("refuses link-local addresses, where cloud metadata services live", () => {
    assert.equal(isPublicAddress("169.254.169.254"), false);
    assert.equal(isPublicAddress("fe80::1"), false);
  });

  test("refuses carrier-grade NAT and multicast", () => {
    assert.equal(isPublicAddress("100.64.0.1"), false);
    assert.equal(isPublicAddress("224.0.0.1"), false);
  });

  test("refuses IPv6 loopback and unique-local addresses", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1"]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  test("looks through an IPv4-mapped IPv6 address", () => {
    assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
    assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
  });

  test("refuses text that is not an address at all", () => {
    assert.equal(isPublicAddress("localhost"), false);
    assert.equal(isPublicAddress(""), false);
  });
});

describe("safeFetch", () => {
  test("will not connect to a loopback address", async () => {
    await assert.rejects(safeFetch("http://127.0.0.1:8081/"), /public internet/);
  });

  test("will not connect to a loopback address written in IPv6 or as a single number", async () => {
    await assert.rejects(safeFetch("http://[::1]:8081/"), /public internet/);
    await assert.rejects(safeFetch("http://2130706433:8081/"), /public internet/);
  });

  test("will not resolve a name to a private address", async () => {
    await assert.rejects(safeFetch("http://localhost:8081/"), /public internet/);
  });

  test("rejects schemes other than http and https", async () => {
    await assert.rejects(safeFetch("file:///etc/passwd"), /http and https/);
  });

  test("rejects an address that cannot be parsed", async () => {
    await assert.rejects(safeFetch("not a url"), /valid address/);
  });
});
