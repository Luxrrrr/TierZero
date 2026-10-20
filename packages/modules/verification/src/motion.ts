import { encodeGif } from "./gif.js";
import { layoutText, seeded, type LayoutOptions } from "./image.js";

/**
 * The moving captcha. Every frame is plain noise: the characters are only there
 * in how the noise moves. Inside the letters it scrolls up and outside it
 * scrolls down, which the eye picks out at once and a single frame gives away
 * nothing of.
 *
 * Each column of noise holds as many lit specks as dark ones and repeats every
 * `period` rows, and the picture plays exactly one period. So over a whole loop
 * every pixel is lit half the time, inside the letters and outside them alike:
 * the average of all the frames is flat grey. The period is longer than the
 * picture is tall, so no frame contains a repeat that one part of it could be
 * matched against another with, which is how a repeating pattern would give
 * away where the letters end. The two kinds of noise are made apart for the same
 * reason. What this does not hide is the motion itself, which anything that
 * compares one frame with the next can follow.
 */

export interface MotionSpec {
  code: string;
  seed: number;
}

export interface Tuning {
  /** Each speck of noise is this many pixels across. */
  grain: number;
  /** Rows of specks before a column repeats, which is also how many frames there are. Even, so columns can be balanced, and taller than the picture. */
  period: number;
  /** Letters are drawn bigger, thicker, straighter and further apart than in a still picture: a thin or twisting line has too little noise in it to be seen moving, and thick letters that touch run together. */
  layout: LayoutOptions;
}

export const TUNING: Tuning = { grain: 3, period: 60, layout: { weight: 1.6, bend: 0.15, scale: 1.4, width: 0.72 } };
export const GRAIN = TUNING.grain;
export const FRAMES = TUNING.period;
/** Hundredths of a second between frames. */
export const FRAME_DELAY = 8;

const PALETTE: readonly (readonly [number, number, number])[] = [
  [26, 28, 40],
  [214, 220, 236],
];

type Random = () => number;

/** Columns of specks, each with exactly half of its rows lit, in a random order. */
function noise(columns: number, period: number, random: Random): Uint8Array {
  const cells = new Uint8Array(columns * period);
  for (let column = 0; column < columns; column++) {
    const rows = Array.from({ length: period }, (_, row): number => (row < period / 2 ? 1 : 0));
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
    cells.set(rows, column * period);
  }
  return cells;
}

/** The frames as palette indexes, with the picture's size. Kept apart from the encoding so tests can look at them. */
export function motionFrames(spec: MotionSpec, tuning: Tuning = TUNING): { width: number; height: number; frames: Uint8Array[]; inside: Uint8Array } {
  const random = seeded(spec.seed);
  const { grain, period } = tuning;
  const layout = layoutText(spec.code, random, tuning.layout);
  const { width, height } = layout;
  const columns = Math.ceil(width / grain);

  const inside = new Uint8Array(width * height);
  for (let i = 0; i < inside.length; i++) inside[i] = layout.mask[i]! > 0.5 ? 1 : 0;

  const letters = noise(columns, period, random);
  const backdrop = noise(columns, period, random);
  const frames: Uint8Array[] = [];
  for (let frame = 0; frame < period; frame++) {
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = Math.floor(y / grain);
      const up = (row + frame) % period;
      const down = (((row - frame) % period) + period) % period;
      for (let x = 0; x < width; x++) {
        const column = Math.floor(x / grain) * period;
        pixels[y * width + x] = inside[y * width + x] ? letters[column + up]! : backdrop[column + down]!;
      }
    }
    frames.push(pixels);
  }
  return { width, height, frames, inside };
}

export function renderMotion(spec: MotionSpec): Buffer {
  const { width, height, frames } = motionFrames(spec);
  return encodeGif(width, height, PALETTE, frames, FRAME_DELAY);
}
