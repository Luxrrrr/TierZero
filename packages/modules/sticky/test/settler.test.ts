import { test } from "node:test";
import assert from "node:assert/strict";
import { Settler } from "../dist/debounce.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("runs once after the key has been quiet", async () => {
  const settler = new Settler(1000);
  let runs = 0;
  settler.touch("a", 30, () => void runs++);
  settler.touch("a", 30, () => void runs++);
  assert.ok(settler.has("a"));
  await sleep(90);
  assert.equal(runs, 1);
  assert.equal(settler.has("a"), false);
});

test("keeps waiting while messages keep coming, until the ceiling", async () => {
  const settler = new Settler(80);
  const started = Date.now();
  let first = 0;
  for (let i = 0; i < 8; i++) {
    settler.touch("a", 50, () => void (first ||= Date.now() - started));
    await sleep(25);
  }
  assert.ok(first > 0 && first < 150, `first run at ${first}ms`);
  settler.cancel("a");
});

test("keys do not affect each other, and cancel stops the work", async () => {
  const settler = new Settler(1000);
  const ran: string[] = [];
  settler.touch("a", 20, () => void ran.push("a"));
  settler.touch("b", 20, () => void ran.push("b"));
  settler.cancel("a");
  await sleep(60);
  assert.deepEqual(ran, ["b"]);
});
