import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { partPatchProblem, resolveCommandKey } from "../dist/runtime/command-policy.js";

const commands = [
  { name: "ticket", subcommands: [{ key: "ticket close" }, { key: "ticket tag add" }] },
  { name: "Report message", subcommands: [] },
  { name: "ping", subcommands: [] },
];

describe("resolveCommandKey", () => {
  test("a stored key from before parts existed still names its command", () => {
    assert.equal(resolveCommandKey(commands, "ticket")?.kind, "command");
    assert.equal(resolveCommandKey(commands, "ping")?.kind, "command");
  });

  test("a right-click entry with a space is a whole command, not a part", () => {
    assert.deepEqual(resolveCommandKey(commands, "Report message"), { kind: "command", command: commands[1] });
  });

  test("a part is found under its command", () => {
    assert.deepEqual(resolveCommandKey(commands, "ticket close"), { kind: "part", command: commands[0], key: "ticket close" });
    assert.equal(resolveCommandKey(commands, "ticket tag add")?.kind, "part");
  });

  test("anything else is unknown", () => {
    assert.equal(resolveCommandKey(commands, "ticket explode"), null);
    assert.equal(resolveCommandKey(commands, "ping pong"), null);
  });
});

describe("partPatchProblem", () => {
  test("a part takes a switch and role and channel limits", () => {
    assert.equal(partPatchProblem({ enabled: false, allowRoles: [], denyChannels: [], allowChannels: [] }), null);
  });

  test("who sees it and how it replies stay on the whole command", () => {
    assert.ok(partPatchProblem({ permissions: "8" }));
    assert.ok(partPatchProblem({ ephemeral: true }));
    assert.ok(partPatchProblem({ customReply: null }));
  });
});
