import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isTabCurrent, modTabsFor } from "../lib/mod-tabs.ts";

const ids = (role: "owner" | "admin" | "mod") => modTabsFor("1", role).map((tab) => tab.id);

describe("modTabsFor", () => {
  test("a moderator sees the shared tabs", () => {
    assert.deepEqual(ids("mod"), ["overview", "members", "logs", "serverlogs"]);
  });

  test("an admin adds appeals and the raid tools", () => {
    assert.deepEqual(ids("admin"), ["overview", "members", "logs", "serverlogs", "appeals", "raid"]);
  });

  test("only the owner sees access", () => {
    assert.deepEqual(ids("owner"), ["overview", "members", "logs", "serverlogs", "appeals", "raid", "access", "danger"]);
  });

  test("appeals and raid tools link to their pages", () => {
    const tabs = modTabsFor("7", "admin");
    assert.equal(tabs.find((tab) => tab.id === "appeals")?.href, "/guilds/7/mod/appeals");
    assert.equal(tabs.find((tab) => tab.id === "raid")?.href, "/guilds/7/mod/raid");
    assert.equal(tabs.find((tab) => tab.id === "raid")?.label, "Raid tools");
  });

  test("settings appears only for someone who can manage the server", () => {
    assert.deepEqual(
      modTabsFor("1", "owner", true).map((tab) => tab.id),
      ["overview", "members", "logs", "serverlogs", "appeals", "raid", "access", "settings", "danger"],
    );
    assert.deepEqual(
      modTabsFor("1", "mod", true).map((tab) => tab.id),
      ["overview", "members", "logs", "serverlogs", "settings"],
    );
  });

  test("staff without Manage Server never see settings, whatever their level", () => {
    for (const role of ["mod", "admin", "owner"] as const) {
      assert.equal(ids(role).includes("settings" as never), false);
      assert.equal(modTabsFor("1", role, false).some((tab) => tab.id === "settings"), false);
    }
  });

  test("a manager who is not listed staff sees settings alone", () => {
    assert.deepEqual(
      modTabsFor("1", null, true).map((tab) => tab.id),
      ["settings"],
    );
    assert.deepEqual(modTabsFor("1", null, false), []);
  });

  test("links carry the guild id", () => {
    assert.equal(modTabsFor("42", "mod")[1]?.href, "/guilds/42/mod/members");
  });
});

describe("isTabCurrent", () => {
  test("settings stays current on the automod sub-page", () => {
    const settings = modTabsFor("1", "mod", true).find((tab) => tab.id === "settings")!;
    assert.equal(isTabCurrent(settings, "/guilds/1/mod/settings"), true);
    assert.equal(isTabCurrent(settings, "/guilds/1/mod/settings/automod"), true);
    assert.equal(isTabCurrent(settings, "/guilds/1/mod/members"), false);
  });

  const [overview, members] = modTabsFor("1", "mod");

  test("overview matches only its own path", () => {
    assert.equal(isTabCurrent(overview!, "/guilds/1/mod"), true);
    assert.equal(isTabCurrent(overview!, "/guilds/1/mod/members"), false);
  });

  test("a tab stays current on its sub-pages", () => {
    assert.equal(isTabCurrent(members!, "/guilds/1/mod/members/123"), true);
    assert.equal(isTabCurrent(members!, "/guilds/1/mod/membership"), false);
  });
});

describe("the logs tab", () => {
  const logs = modTabsFor("1", "admin").find((tab) => tab.id === "logs")!;

  test("stays current on both logs it holds", () => {
    assert.equal(isTabCurrent(logs, "/guilds/1/mod/actions"), true);
    assert.equal(isTabCurrent(logs, "/guilds/1/mod/audit"), true);
    assert.equal(isTabCurrent(logs, "/guilds/1/mod/members"), false);
  });
});
