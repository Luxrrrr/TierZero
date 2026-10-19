import { test } from "node:test";
import assert from "node:assert/strict";
import { plainReply, embedReply } from "@tier0/core";
import { DM_MESSAGE } from "../dist/messages.js";
import { moderationSettingsWith } from "./settings-helper.ts";

const parse = (dmMessage: unknown) => moderationSettingsWith({ dmMessage }).dmMessage;

// What the dashboard saved for a server that never touched the wording: the default as it was then.
const SAVED_OLD_DEFAULT = {
  content: "",
  embeds: [
    {
      name: "",
      title: "",
      url: "",
      description: "You were {action} in {server}.{reasonNote}{expiryNote}",
      color: "#f5a623",
      authorName: "",
      authorIconUrl: "",
      authorUrl: "",
      footerText: "",
      footerIconUrl: "",
      imageUrl: "",
      thumbnailUrl: "",
      timestamp: "",
      fields: [],
    },
  ],
  buttons: [],
  selects: [],
  reactions: [],
};

test("a server that saved the old default direct message gets the current one", () => {
  assert.deepEqual(parse(SAVED_OLD_DEFAULT), DM_MESSAGE);
});

test("wording an owner changed is kept as written", () => {
  const edited = embedReply("You were {action} in {server}. Please read the rules.", "warning");
  assert.equal(parse(edited).embeds[0]?.description, "You were {action} in {server}. Please read the rules.");
  assert.equal(parse(plainReply("Hello {server}")).content, "Hello {server}");
});
