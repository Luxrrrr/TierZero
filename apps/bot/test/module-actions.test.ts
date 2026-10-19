import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ModuleRegistry, defineModule, s } from "@tier0/core";
import { runModuleAction } from "../dist/control/rows.js";

const calls: unknown[] = [];

const registry = new ModuleRegistry();
registry.register(
  defineModule({
    id: "demo",
    name: "Demo",
    summary: "A module with an action.",
    settings: s.object({}),
    actions: {
      hello: {
        label: "Say hello",
        input: s.object({ times: s.integer({ label: "Times", min: 1, max: 3, default: 1 }) }),
        async run({ input }) {
          calls.push(input);
          return { ok: true, message: `Said hello ${String(input.times)} times.` };
        },
      },
      boom: {
        label: "Fail",
        async run() {
          throw new Error("no");
        },
      },
    },
  }),
);

const guild = { id: "1" } as never;
const stateWith = (enabled: boolean) => ({ isEnabled: async () => enabled, context: async () => ({ settings: {} }) }) as never;

describe("module actions", () => {
  test("are described for the dashboard", () => {
    const summary = registry.describe().find((entry) => entry.id === "demo");
    assert.deepEqual(summary?.actions.map((action) => action.id), ["hello", "boom"]);
    assert.ok(summary?.actions[0]?.input);
  });

  test("run with validated input", async () => {
    const reply = await runModuleAction(registry, stateWith(true), guild, "demo", "hello", { times: 2 });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { ok: true, message: "Said hello 2 times." });
  });

  test("refuse input the schema refuses", async () => {
    const reply = await runModuleAction(registry, stateWith(true), guild, "demo", "hello", { times: 9 });
    assert.equal(reply.status, 422);
  });

  test("need the feature switched on", async () => {
    const reply = await runModuleAction(registry, stateWith(false), guild, "demo", "hello", {});
    assert.equal((reply.body as { ok: boolean }).ok, false);
  });

  test("answer 404 for an unknown action and hide a thrown error", async () => {
    assert.equal((await runModuleAction(registry, stateWith(true), guild, "demo", "nope", {})).status, 404);
    const reply = await runModuleAction(registry, stateWith(true), guild, "demo", "boom", {});
    assert.equal((reply.body as { ok: boolean }).ok, false);
  });
});
