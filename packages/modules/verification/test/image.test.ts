import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { CELL, COLOURS, HEIGHT, layoutText, renderStill, seeded } from "../dist/image.js";
import { ALPHABET } from "../dist/strokes.js";

function decode(png: Buffer): { width: number; height: number; rgb: Buffer } {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8);
      assert.equal(body[9], 2);
    }
    if (type === "IDAT") data.push(body);
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  assert.equal(raw.length, (width * 3 + 1) * height);
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 3 + 1)], 0);
    raw.copy(rgb, y * width * 3, y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1));
  }
  return { width, height, rgb };
}

describe("the picture", () => {
  test("is a valid PNG of the size its characters need", () => {
    const { width, height } = decode(renderStill({ code: "K7MAC", seed: 1 }));
    assert.equal(width, 5 * CELL + 48);
    assert.equal(height, HEIGHT);
  });

  test("is the same for the same seed and different for another", () => {
    const a = renderStill({ code: "K7MAC", seed: 5 });
    assert.ok(a.equals(renderStill({ code: "K7MAC", seed: 5 })));
    assert.ok(!a.equals(renderStill({ code: "K7MAC", seed: 6 })));
    assert.ok(!a.equals(renderStill({ code: "K7MAH", seed: 5 })));
  });

  test("draws every character, and keeps all of it inside the picture", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const code = "2HXWPTE";
      const layout = layoutText(code, seeded(seed));
      const seen = new Set<number>();
      let inked = 0;
      for (let i = 0; i < layout.mask.length; i++) {
        if (layout.mask[i]! > 0.5) {
          seen.add(layout.owner[i]!);
          inked++;
        }
      }
      assert.equal(seen.size, code.length, `seed ${seed}`);
      assert.ok(inked > code.length * 120, `seed ${seed} drew ${inked} pixels`);
      // Nothing may be cut off by the edge: the border rows and columns stay empty.
      for (let x = 0; x < layout.width; x++) {
        assert.equal(layout.mask[x], 0, `seed ${seed} top edge`);
        assert.equal(layout.mask[(layout.height - 1) * layout.width + x], 0, `seed ${seed} bottom edge`);
      }
      for (let y = 0; y < layout.height; y++) {
        assert.equal(layout.mask[y * layout.width], 0, `seed ${seed} left edge`);
        assert.equal(layout.mask[y * layout.width + layout.width - 1], 0, `seed ${seed} right edge`);
      }
    }
  });

  test("keeps the characters in order from left to right", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const layout = layoutText("2HXWPTE", seeded(seed));
      const sums = new Array<number>(7).fill(0);
      const counts = new Array<number>(7).fill(0);
      for (let i = 0; i < layout.mask.length; i++) {
        const owner = layout.owner[i]!;
        if (owner >= 0 && layout.mask[i]! > 0.5) {
          sums[owner]! += i % layout.width;
          counts[owner]!++;
        }
      }
      const centres = sums.map((sum, index) => sum / counts[index]!);
      for (let i = 1; i < centres.length; i++) assert.ok(centres[i]! > centres[i - 1]!, `seed ${seed}: ${centres.join(", ")}`);
    }
  });

  test("shows each character in its own colour", () => {
    const colours = [COLOURS.red!, COLOURS.blue!, COLOURS.red!];
    const { rgb } = decode(renderStill({ code: "2HX", colours, seed: 3 }));
    const layout = layoutText("2HX", seeded(3));
    // A pixel the second character covers fully, and nothing is drawn over it but a faint line at most, leans to blue.
    let blue = 0;
    let checked = 0;
    for (let i = 0; i < layout.mask.length; i++) {
      if (layout.mask[i]! < 1 || layout.owner[i] !== 1) continue;
      checked++;
      if (rgb[i * 3 + 2]! > rgb[i * 3]!) blue++;
    }
    assert.ok(checked > 100);
    assert.ok(blue / checked > 0.9, `${blue} of ${checked} pixels were blue`);
  });

  test("has strokes for every character in the alphabet", () => {
    for (const character of ALPHABET) assert.doesNotThrow(() => renderStill({ code: character.repeat(3), seed: 1 }));
  });
});

describe("the picture of a round", () => {
  test("is a PNG for a still round and a GIF for a moving one", async () => {
    const { renderRound } = await import("../dist/render.js");
    const { makeRound } = await import("../dist/rounds.js");
    for (const type of ["text", "colour", "motion"] as const) {
      const round = makeRound(type);
      if (round.type === "block" || round.type === "question") throw new Error("not a picture");
      const [data, { name }] = renderRound(round);
      assert.equal(name, type === "motion" ? "captcha.gif" : "captcha.png");
      assert.equal(data.toString("ascii", type === "motion" ? 0 : 1, type === "motion" ? 3 : 4), type === "motion" ? "GIF" : "PNG");
    }
  });
});
