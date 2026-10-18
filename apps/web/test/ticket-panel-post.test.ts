import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { panelPostView, type PostViewInput } from "../lib/ticket-panel-post.ts";

const base: PostViewInput = { state: "posted", channel: "support", liveChannel: null, enabled: true, dirty: false, saved: true, refuse: null };

describe("panelPostView", () => {
  test("a posted panel says where, and its button updates it quietly", () => {
    const view = panelPostView(base);
    assert.equal(view.status, "Posted in #support");
    assert.equal(view.label, "Update in Discord");
    assert.equal(view.tone, "ok");
    assert.equal(view.blocked, null);
    assert.equal(view.primary, false);
  });

  test("a panel that is not up offers the main action to post it", () => {
    const view = panelPostView({ ...base, state: "unposted" });
    assert.equal(view.status, "Not posted yet");
    assert.equal(view.label, "Post to Discord");
    assert.equal(view.primary, true);
    assert.equal(view.up, false);
  });

  test("a changed panel says so and offers the update as the main action", () => {
    const view = panelPostView({ ...base, state: "changed" });
    assert.equal(view.label, "Update in Discord");
    assert.equal(view.primary, true);
    assert.match(view.note ?? "", /changed since it was posted/);
  });

  test("a panel still up in its old channel offers to move it", () => {
    const view = panelPostView({ ...base, state: "moved", liveChannel: "old-support" });
    assert.equal(view.label, "Move to #support");
    assert.match(view.status, /#old-support/);
    assert.match(view.note ?? "", /takes that copy down/);
  });

  test("a deleted or older-version panel is posted again", () => {
    assert.equal(panelPostView({ ...base, state: "deleted" }).label, "Post again");
    assert.equal(panelPostView({ ...base, state: "legacy" }).label, "Post again");
  });

  test("says why the button is blocked, in the order that matters", () => {
    assert.equal(panelPostView({ ...base, enabled: false, dirty: true }).blocked, "Turn Tickets on first.");
    assert.equal(panelPostView({ ...base, dirty: true }).blocked, "Save your changes first.");
    assert.equal(panelPostView({ ...base, saved: false }).blocked, "Save this panel first.");
    assert.equal(panelPostView({ ...base, state: "nochannel" }).blocked, "Pick a channel and save first.");
    assert.equal(panelPostView({ ...base, refuse: "Discord will refuse this panel." }).blocked, "Discord will refuse this panel.");
  });
});
