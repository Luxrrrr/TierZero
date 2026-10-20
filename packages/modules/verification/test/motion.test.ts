import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { encodeGif } from "../dist/gif.js";
import { FRAMES, FRAME_DELAY, GRAIN, TUNING, motionFrames, renderMotion } from "../dist/motion.js";

interface Decoded {
  width: number;
  height: number;
  delays: number[];
  loops: boolean;
  frames: Uint8Array[];
}

/** A plain GIF reader, written from the format and not from the writer, so the two can disagree. */
function decode(gif: Buffer): Decoded {
  assert.equal(gif.toString("ascii", 0, 6), "GIF89a");
  const width = gif.readUInt16LE(6);
  const height = gif.readUInt16LE(8);
  const packed = gif[10]!;
  assert.ok(packed & 0x80);
  let at = 13 + 3 * (1 << ((packed & 7) + 1));
  const result: Decoded = { width, height, delays: [], loops: false, frames: [] };
  for (;;) {
    const marker = gif[at++]!;
    if (marker === 0x3b) return result;
    if (marker === 0x21) {
      const label = gif[at++]!;
      if (label === 0xf9) result.delays.push(gif.readUInt16LE(at + 2));
      if (label === 0xff && gif.toString("ascii", at + 1, at + 12) === "NETSCAPE2.0") result.loops = true;
      while (gif[at]! !== 0) at += gif[at]! + 1;
      at++;
      continue;
    }
    assert.equal(marker, 0x2c);
    assert.equal(gif.readUInt16LE(at + 4), width);
    assert.equal(gif.readUInt16LE(at + 6), height);
    at += 9;
    const minCode = gif[at++]!;
    const data: number[] = [];
    while (gif[at]! !== 0) {
      data.push(...gif.subarray(at + 1, at + 1 + gif[at]!));
      at += gif[at]! + 1;
    }
    at++;
    result.frames.push(unpack(Uint8Array.from(data), minCode, width * height));
  }
}

function unpack(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const clear = 1 << minCode;
  const end = clear + 1;
  const out: number[] = [];
  let table: number[][] = [];
  const reset = (): void => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
  };
  reset();
  let size = minCode + 1;
  let previous: number[] | null = null;
  let bit = 0;
  for (;;) {
    let code = 0;
    for (let i = 0; i < size; i++) code |= ((data[(bit + i) >> 3]! >> ((bit + i) & 7)) & 1) << i;
    bit += size;
    if (code === clear) {
      reset();
      size = minCode + 1;
      previous = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < table.length) entry = table[code]!;
    else {
      assert.ok(previous, "a code with nothing before it");
      entry = [...previous, previous[0]!];
    }
    out.push(...entry);
    if (previous) table.push([...previous, entry[0]!]);
    previous = entry;
    if (table.length === 1 << size && size < 12) size++;
  }
  assert.equal(out.length, count);
  return Uint8Array.from(out);
}

describe("the GIF writer", () => {
  test("writes frames that read back exactly, including noise that fills the code table", () => {
    const width = 64;
    const height = 48;
    let state = 7;
    const random = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    const frames = [0, 1, 2].map(() => Uint8Array.from({ length: width * height }, () => (random() < 0.5 ? 1 : 0)));
    const read = decode(encodeGif(width, height, [[0, 0, 0], [255, 255, 255]], frames, 8));
    assert.equal(read.width, width);
    assert.equal(read.height, height);
    assert.equal(read.frames.length, 3);
    read.frames.forEach((frame, index) => assert.deepEqual(frame, frames[index]));
  });

  test("handles a picture of one flat colour", () => {
    const flat = new Uint8Array(200 * 100).fill(1);
    const read = decode(encodeGif(200, 100, [[0, 0, 0], [255, 255, 255]], [flat], 8));
    assert.deepEqual(read.frames[0], flat);
  });
});

describe("the moving picture", () => {
  const spec = { code: "K7MAC", seed: 4 };

  test("is a looping GIF of the frames, at the pace set", () => {
    const read = decode(renderMotion(spec));
    assert.equal(read.frames.length, FRAMES);
    assert.ok(read.loops);
    assert.ok(read.delays.every((delay) => delay === FRAME_DELAY));
    const { frames } = motionFrames(spec);
    read.frames.forEach((frame, index) => assert.deepEqual(frame, frames[index]));
  });

  test("is the same for the same seed and different for another", () => {
    assert.ok(renderMotion(spec).equals(renderMotion(spec)));
    assert.ok(!renderMotion(spec).equals(renderMotion({ ...spec, seed: 5 })));
  });

  test("stays small enough to send", () => {
    assert.ok(renderMotion(spec).length < 400 * 1024);
  });

  test("shows nothing of the characters in any one frame, and the loop averages out to flat grey", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { width, height, frames, inside } = motionFrames({ code: "2HXWP", seed });
      const area = width * height;
      let inked = 0;
      for (let i = 0; i < area; i++) inked += inside[i]!;

      // The share of lit specks inside the letters and outside them, in each frame, is the same.
      for (const frame of frames) {
        let lit = 0;
        let litOutside = 0;
        for (let i = 0; i < area; i++) {
          if (inside[i]) lit += frame[i]!;
          else litOutside += frame[i]!;
        }
        const gap = Math.abs(lit / inked - litOutside / (area - inked));
        // Specks are lit by chance, so the gap is allowed what chance gives: five standard deviations of it.
        const cell = TUNING.grain ** 2;
        const allowed = 5 * 0.5 * Math.sqrt(cell / inked + cell / (area - inked));
        assert.ok(gap < allowed, `seed ${seed}: ${gap} against ${allowed}`);
      }

      // Averaged over the whole loop every pixel is lit exactly half the time, inside a letter or out.
      const average = new Float64Array(area);
      for (const frame of frames) for (let i = 0; i < area; i++) average[i]! += frame[i]! / frames.length;
      for (let i = 0; i < area; i++) assert.ok(Math.abs(average[i]! - 0.5) < 1e-9, `seed ${seed}: pixel ${i} averages ${average[i]}`);
    }
  });

  test("has no part of a frame that repeats another, since that would show where the letters end", () => {
    assert.ok(TUNING.period > Math.ceil(motionFrames({ code: "2HXW", seed: 1 }).height / TUNING.grain));
    for (let seed = 1; seed <= 6; seed++) {
      const { width, height, frames, inside } = motionFrames({ code: "2HXW", seed });
      const frame = frames[seed]!;
      // How often a speck matches the one this many specks below it, for pairs inside a letter, outside, and across the edge.
      for (const offset of [6, 12, 24, 36]) {
        const hits = { within: [0, 0], backdrop: [0, 0], across: [0, 0] };
        for (let y = 0; y + offset * TUNING.grain < height; y += TUNING.grain) {
          for (let x = 0; x < width; x += TUNING.grain) {
            const here = y * width + x;
            const there = (y + offset * TUNING.grain) * width + x;
            const kind = inside[here] && inside[there] ? "within" : !inside[here] && !inside[there] ? "backdrop" : "across";
            hits[kind][1]!++;
            if (frame[here] === frame[there]) hits[kind][0]!++;
          }
        }
        for (const [kind, [same, all]] of Object.entries(hits) as [string, number[]][]) {
          if (all! < 200) continue;
          const rate = same! / all!;
          assert.ok(Math.abs(rate - 0.5) < 5 * 0.5 * Math.sqrt(1 / all!) + 0.02, `seed ${seed}, ${offset} specks apart, ${kind}: ${rate}`);
        }
      }
    }
  });

  test("gives the characters up to anything that follows the motion, as the eye does", () => {
    // Compare each frame with the next, shifted one speck up and one speck down. Letters match when
    // shifted up, the backdrop when shifted down, so the difference of the two draws the letters.
    for (let seed = 1; seed <= 6; seed++) {
      const { width, height, frames, inside } = motionFrames({ code: "2HXW", seed });
      const score = new Float64Array(width * height);
      for (let t = 0; t < frames.length - 1; t++) {
        const [now, next] = [frames[t]!, frames[t + 1]!];
        for (let y = GRAIN; y < height - GRAIN; y++) {
          for (let x = 0; x < width; x++) {
            const same = (shift: number) => (next[y * width + x] === now[(y + shift) * width + x] ? 1 : 0);
            score[y * width + x]! += same(GRAIN) - same(-GRAIN);
          }
        }
      }
      // Smooth over a small window, as a motion detector does, then call each pixel by its sign.
      const radius = 3;
      let agree = 0;
      let counted = 0;
      for (let y = radius + GRAIN; y < height - radius - GRAIN; y++) {
        for (let x = radius; x < width - radius; x++) {
          let sum = 0;
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) sum += score[(y + dy) * width + x + dx]!;
          if ((sum > 0 ? 1 : 0) === inside[y * width + x]) agree++;
          counted++;
        }
      }
      assert.ok(agree / counted > 0.93, `seed ${seed}: ${agree / counted}`);
    }
  });
});
