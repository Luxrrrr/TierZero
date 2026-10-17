import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, defineModule, s } from "@tier0/core";
import { leaderboardPage, moduleNotices } from "../src/control/public-pages.ts";

const guild = { id: "100000000000000090", name: "Night Raid" } as never;

function state(enabled: boolean, settings: unknown) {
  return {
    isEnabled: async () => enabled,
    context: async () => ({ settings }),
  } as never;
}

describe("the public leaderboard route", () => {
  test("answers the same for a server the bot is not in, one with leveling off and one with the page off", async () => {
    const answers = [
      await leaderboardPage(state(true, { publicPage: { enabled: true } }), undefined, null),
      await leaderboardPage(state(false, { publicPage: { enabled: true } }), guild, null),
      await leaderboardPage(state(true, { publicPage: { enabled: false } }), guild, null),
    ];
    for (const answer of answers) assert.deepEqual(answer, { status: 404, body: { error: "This leaderboard is not public." } });
  });
});

describe("module notices", () => {
  const registry = new ModuleRegistry();
  registry.register(defineModule({ id: "quiet", name: "Quiet", summary: "", settings: s.object({}) }));
  registry.register(
    defineModule({
      id: "broken",
      name: "Broken",
      summary: "",
      settings: s.object({}),
      notices: async () => {
        throw new Error("boom");
      },
    }),
  );
  registry.register(
    defineModule({
      id: "chatty",
      name: "Chatty",
      summary: "",
      settings: s.object({}),
      notices: async () => [{ tone: "info", text: "GG." }],
    }),
  );

  test("a module without any has none", async () => {
    assert.deepEqual(await moduleNotices(registry, state(true, {}), guild, "quiet"), { status: 200, body: { notices: [] } });
  });

  test("a hook that fails is logged and shows nothing, rather than breaking the settings page", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await moduleNotices(registry, state(true, {}), guild, "broken"), { status: 200, body: { notices: [] } });
    } finally {
      console.error = quiet;
    }
  });

  test("a module's lines are passed on as given", async () => {
    assert.deepEqual(await moduleNotices(registry, state(true, {}), guild, "chatty"), { status: 200, body: { notices: [{ tone: "info", text: "GG." }] } });
  });
});
