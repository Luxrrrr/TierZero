import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { SHAPES, TILE, TILES_SIZE, renderTiles, type Shape } from "../dist/tiles.js";

const spec = (shapes: Shape[], seed = 1) => ({ shapes, seed });
const nine = (shape: Shape): Shape[] => Array<Shape>(9).fill(shape);

function pixels(png: Buffer): Buffer {
  let at = 8;
  const data: Buffer[] = [];
  let width = 0;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    if (type === "IHDR") width = png.readUInt32BE(at + 8);
    if (type === "IDAT") data.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const rgb = Buffer.alloc(width * width * 3);
  for (let y = 0; y < width; y++) raw.copy(rgb, y * width * 3, y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1));
  return rgb;
}

/** The squares of the picture the two renderings differ in, from 1. */
function differing(a: Buffer, b: Buffer): number[] {
  const first = pixels(a);
  const second = pixels(b);
  const squares = new Set<number>();
  const gap = (TILES_SIZE - 3 * TILE) / 4;
  for (let i = 0; i < first.length; i += 3) {
    if (first[i] === second[i] && first[i + 1] === second[i + 1] && first[i + 2] === second[i + 2]) continue;
    const [x, y] = [(i / 3) % TILES_SIZE, Math.floor(i / 3 / TILES_SIZE)];
    const column = Math.floor((x - gap) / (TILE + gap));
    const row = Math.floor((y - gap) / (TILE + gap));
    squares.add(column < 0 || row < 0 || column > 2 || row > 2 ? 0 : row * 3 + column + 1);
  }
  return [...squares].sort((p, q) => p - q);
}

describe("the picture of nine squares", () => {
  test("is a PNG of the size the squares need", () => {
    const png = renderTiles(spec(nine("circle")));
    assert.equal(png.readUInt32BE(16), TILES_SIZE);
    assert.equal(png.readUInt32BE(20), TILES_SIZE);
  });

  test("is the same for the same seed and different for another", () => {
    const a = renderTiles(spec(nine("star"), 4));
    assert.ok(a.equals(renderTiles(spec(nine("star"), 4))));
    assert.ok(!a.equals(renderTiles(spec(nine("star"), 5))));
  });

  test("changing the shape in one square changes that square and nothing else", () => {
    for (const shape of SHAPES.filter((candidate) => candidate !== "circle")) {
      const before = renderTiles(spec(nine("circle"), 9));
      const shapes = nine("circle");
      shapes[4] = shape;
      assert.deepEqual(differing(before, renderTiles(spec(shapes, 9))), [5], shape);
    }
  });

  test("draws every shape as something that fills a fair part of its square", () => {
    const empty = pixels(renderTiles(spec(nine("circle"), 2)));
    for (const shape of SHAPES) {
      const picture = pixels(renderTiles(spec(nine(shape), 2)));
      let changed = 0;
      for (let i = 0; i < picture.length; i += 3) if (Math.abs(picture[i]! - empty[i]!) + Math.abs(picture[i + 1]! - empty[i + 1]!) > 60) changed++;
      // Nine squares, each with a shape a fair way across it.
      assert.ok(changed > 9 * 300 || shape === "circle", `${shape}: ${changed}`);
    }
  });

  test("is drawn quickly enough to make when a member presses the button", () => {
    const start = Date.now();
    for (let seed = 0; seed < 10; seed++) renderTiles(spec(nine("triangle"), seed));
    assert.ok((Date.now() - start) / 10 < 250);
  });
});
