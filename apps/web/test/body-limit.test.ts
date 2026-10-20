import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readJsonLimited, readJsonObjectLimited, readTextLimited } from "../lib/body-limit.ts";

const streamOf = (chunks: string[], pulled: { count: number } = { count: 0 }) => {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) return controller.close();
      pulled.count += 1;
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  });
};

// A body given as a stream has no declared length, which is how a chunked request arrives.
const chunked = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request("http://dashboard.test/api", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("readTextLimited", () => {
  test("reads a body within the limit, in whole", async () => {
    assert.equal(await readTextLimited(chunked(streamOf(["he", "llo ", "wörld"])), 100), "hello wörld");
  });

  test("counts bytes and not characters", async () => {
    assert.equal(await readTextLimited(chunked(streamOf(["é".repeat(10)])), 19), null);
    assert.equal(await readTextLimited(chunked(streamOf(["é".repeat(10)])), 20), "é".repeat(10));
  });

  test("refuses a chunked body that grows past the limit, and stops reading it", async () => {
    const pulled = { count: 0 };
    const body = streamOf(Array.from({ length: 1000 }, () => "x".repeat(1000)), pulled);
    assert.equal(await readTextLimited(chunked(body), 5000), null);
    assert.ok(pulled.count < 20, `read ${pulled.count} chunks`);
  });

  test("refuses on the declared length without reading the body", async () => {
    const pulled = { count: 0 };
    const request = chunked(streamOf(["x"], pulled), { "content-length": "999999" });
    assert.equal(await readTextLimited(request, 1000), null);
    // A stream pulls one chunk ahead on its own. Nothing is read beyond that.
    assert.ok(pulled.count <= 1);
  });

  test("an empty body is an empty string", async () => {
    assert.equal(await readTextLimited(new Request("http://dashboard.test/api", { method: "POST" }), 10), "");
  });
});

describe("readJsonLimited", () => {
  test("parses JSON and reads an empty body as an empty object", async () => {
    assert.deepEqual(await readJsonLimited(chunked(streamOf(['{"a":', "1}"])), 100), { ok: true, value: { a: 1 } });
    assert.deepEqual(await readJsonLimited(new Request("http://dashboard.test/api", { method: "POST" }), 100), { ok: true, value: {} });
  });

  test("says whether a body was too large or not JSON", async () => {
    assert.deepEqual(await readJsonLimited(chunked(streamOf(["not json"])), 100), { ok: false, reason: "invalid" });
    assert.deepEqual(await readJsonLimited(chunked(streamOf(["x".repeat(50)])), 10), { ok: false, reason: "too-large" });
  });

  test("a body that is the JSON value null is read as null, not as too large", async () => {
    assert.deepEqual(await readJsonLimited(chunked(streamOf(["null"])), 100), { ok: true, value: null });
  });
});

describe("readJsonObjectLimited", () => {
  test("gives back an object, and an empty body as an empty object", async () => {
    assert.deepEqual(await readJsonObjectLimited(chunked(streamOf(['{"a":1}'])), 100), { ok: true, value: { a: 1 } });
    assert.deepEqual(await readJsonObjectLimited(new Request("http://dashboard.test/api", { method: "POST" }), 100), { ok: true, value: {} });
  });

  test("refuses a list, a string and null as invalid", async () => {
    for (const body of ["[1,2]", '"text"', "null", "7"]) {
      assert.deepEqual(await readJsonObjectLimited(chunked(streamOf([body])), 100), { ok: false, reason: "invalid" }, body);
    }
  });

  test("keeps telling too large from invalid", async () => {
    assert.deepEqual(await readJsonObjectLimited(chunked(streamOf(["{" + "x".repeat(50)])), 10), { ok: false, reason: "too-large" });
    assert.deepEqual(await readJsonObjectLimited(chunked(streamOf(["{bad"])), 100), { ok: false, reason: "invalid" });
  });
});
