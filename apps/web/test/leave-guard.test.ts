import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { leavingTo, type LinkClick } from "../lib/leave-guard.ts";

const HERE = "http://localhost:8081/guilds/1/leveling";

function click(overrides: Partial<LinkClick>): LinkClick {
  return { href: "/guilds/1/welcome", target: null, download: false, button: 0, modified: false, defaultPrevented: false, ...overrides };
}

describe("leavingTo", () => {
  test("catches an in-app link such as the sidebar's", () => {
    assert.equal(leavingTo(click({}), HERE), "/guilds/1/welcome");
    assert.equal(leavingTo(click({ href: "http://localhost:8081/guilds/1/mod?tab=a#x" }), HERE), "/guilds/1/mod?tab=a#x");
    assert.equal(leavingTo(click({ href: "?feature=roles" }), HERE), "/guilds/1/leveling?feature=roles");
  });

  test("lets a new tab, a download or a modified click go", () => {
    assert.equal(leavingTo(click({ target: "_blank" }), HERE), null);
    assert.equal(leavingTo(click({ download: true }), HERE), null);
    assert.equal(leavingTo(click({ modified: true }), HERE), null);
    assert.equal(leavingTo(click({ button: 1 }), HERE), null);
  });

  test("lets another site and other schemes go, which the browser asks about itself", () => {
    assert.equal(leavingTo(click({ href: "https://discord.com/app" }), HERE), null);
    assert.equal(leavingTo(click({ href: "mailto:ops@example.com" }), HERE), null);
  });

  test("does not ask about a jump within the same page", () => {
    assert.equal(leavingTo(click({ href: "#group-rewards" }), HERE), null);
    assert.equal(leavingTo(click({ href: "/guilds/1/leveling" }), HERE), null);
  });

  test("respects an opt-out and a click something else already handled", () => {
    assert.equal(leavingTo(click({ ignored: true }), HERE), null);
    assert.equal(leavingTo(click({ defaultPrevented: true }), HERE), null);
    assert.equal(leavingTo(click({ href: null }), HERE), null);
  });
});
