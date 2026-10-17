import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { channelModeOf, channelSummary, commandCounts, commandStatus, liveCountShown } from "../lib/commands.ts";

const command = (over: Partial<{ enabled: boolean; allowRoles: string[]; denyChannels: string[]; allowChannels: string[] }> = {}) => ({
  enabled: true,
  allowRoles: [],
  denyChannels: [],
  allowChannels: [],
  ...over,
});

describe("commandCounts", () => {
  test("a feature that is off puts none of its commands in Discord", () => {
    const counts = commandCounts([
      { enabled: false, alwaysOn: false, commands: [command(), command()] },
      { enabled: true, alwaysOn: false, commands: [command(), command({ enabled: false })] },
    ]);
    assert.deepEqual(counts, { total: 4, live: 1, hidden: 1, featureOff: 2, restricted: 0 });
  });

  test("a built-in part of the bot counts as on", () => {
    assert.equal(commandCounts([{ enabled: false, alwaysOn: true, commands: [command()] }]).live, 1);
  });

  test("a channel allow list counts as a restriction", () => {
    assert.equal(commandCounts([{ enabled: true, alwaysOn: false, commands: [command({ allowChannels: ["1"] })] }]).restricted, 1);
  });
});

describe("commandStatus", () => {
  test("the feature being off wins over everything", () => {
    assert.equal(commandStatus(false, true, 2), "featureOff");
    assert.equal(commandStatus(true, false, 2), "off");
    assert.equal(commandStatus(true, true, 1), "customized");
    assert.equal(commandStatus(true, true, 0), "default");
  });
});

describe("channel rules", () => {
  test("an allow list makes it only in those channels", () => {
    assert.equal(channelModeOf({ denyChannels: [], allowChannels: ["1"] }), "only");
    assert.equal(channelModeOf({ denyChannels: ["1"] }), "except");
    assert.equal(channelModeOf({ denyChannels: [] }), "everywhere");
  });

  test("the summary says which", () => {
    assert.equal(channelSummary({ denyChannels: [], allowChannels: ["1"] }), "Only in 1 channel");
    assert.equal(channelSummary({ denyChannels: ["1", "2"] }), "Off in 2 channels");
    assert.equal(channelSummary({ denyChannels: [] }), "Everywhere");
  });
});

describe("liveCountShown", () => {
  test("uses what the bot registered once it has settled", () => {
    assert.equal(liveCountShown(5, { registered: 4, pending: false }), 4);
  });

  test("uses the settings while a change is on its way or before the first registration", () => {
    assert.equal(liveCountShown(5, { registered: 4, pending: true }), 5);
    assert.equal(liveCountShown(5, { registered: null, pending: false }), 5);
    assert.equal(liveCountShown(5, null), 5);
  });
});
