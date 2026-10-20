/**
 * The characters of the image captcha, drawn as lines rather than taken from a
 * font. That keeps the container free of fonts and lets every character be
 * bent, slanted and thickened a different way each time. The set leaves out the
 * characters that are easily taken for another (0 O Q, 1 I, S, Z,
 * B, G, V, F, R and Y).
 */

export type Point = readonly [number, number];
export type Stroke = readonly Point[];

/** Every glyph sits in a box four wide and six tall, with y growing downwards. */
export const GLYPH_WIDTH = 4;
export const GLYPH_HEIGHT = 6;

const SIX: Stroke = [
  [3.4, 0.6], [2.6, 0.1], [1.6, 0.2], [0.7, 1], [0.2, 2.4], [0.1, 4], [0.4, 5.3], [1.2, 5.9], [2.2, 6], [3.2, 5.5],
  [3.7, 4.4], [3.3, 3.3], [2.4, 2.8], [1.4, 3], [0.5, 3.8],
];

const turned = (stroke: Stroke): Stroke => stroke.map(([x, y]) => [GLYPH_WIDTH - x, GLYPH_HEIGHT - y] as const);

export const STROKES: Record<string, readonly Stroke[]> = {
  "2": [[[0.3, 1.3], [0.8, 0.4], [1.6, 0], [2.4, 0], [3.2, 0.4], [3.7, 1.2], [3.3, 2.3], [2, 3.5], [0.2, 6], [3.9, 6]]],
  "3": [[[0.3, 0.8], [1, 0.1], [2, 0], [3, 0.2], [3.6, 1], [3.2, 2], [1.7, 2.8], [3.2, 3.5], [3.8, 4.5], [3.4, 5.5], [2.4, 6], [1.2, 5.9], [0.2, 5.2]]],
  "4": [[[2.8, 6], [2.8, 0], [0, 4.3], [4, 4.3]]],
  "5": [[[3.6, 0], [0.7, 0], [0.4, 2.8], [1.5, 2.4], [2.6, 2.5], [3.5, 3.3], [3.7, 4.4], [3.2, 5.4], [2.2, 6], [1, 5.9], [0.2, 5.2]]],
  "6": [SIX],
  "7": [[[0, 0], [4, 0], [1.6, 6]]],
  "9": [turned(SIX)],
  A: [[[0, 6], [2, 0], [4, 6]], [[0.9, 4], [3.1, 4]]],
  C: [[[3.7, 1], [3, 0.2], [2, 0], [1, 0.4], [0.3, 1.6], [0.1, 3], [0.3, 4.4], [1, 5.6], [2, 6], [3, 5.8], [3.7, 5]]],
  E: [[[3.8, 0], [0.4, 0], [0.4, 6], [3.8, 6]], [[0.4, 3], [3, 3]]],
  H: [[[0.4, 0], [0.4, 6]], [[3.6, 0], [3.6, 6]], [[0.4, 3], [3.6, 3]]],
  K: [[[0.4, 0], [0.4, 6]], [[3.8, 0], [0.4, 3.2], [3.8, 6]]],
  L: [[[0.4, 0], [0.4, 6], [3.6, 6]]],
  M: [[[0.2, 6], [0.2, 0], [2, 3.6], [3.8, 0], [3.8, 6]]],
  N: [[[0.3, 6], [0.3, 0], [3.7, 6], [3.7, 0]]],
  P: [[[0.4, 6], [0.4, 0], [2.4, 0], [3.4, 0.5], [3.8, 1.4], [3.4, 2.4], [2.4, 2.9], [0.4, 2.9]]],
  T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
  U: [[[0.3, 0], [0.3, 4.4], [0.8, 5.4], [1.6, 5.95], [2.4, 5.95], [3.2, 5.4], [3.7, 4.4], [3.7, 0]]],
  W: [[[0, 0], [1, 6], [2, 2.4], [3, 6], [4, 0]]],
  X: [[[0, 0], [4, 6]], [[4, 0], [0, 6]]],
};

export const ALPHABET = Object.keys(STROKES);

/** The digits the tile picture numbers its squares with. The captcha alphabet has no 1, since it is easily taken for another character. */
export const NUMBER_STROKES: Record<string, readonly Stroke[]> = {
  ...Object.fromEntries(["2", "3", "4", "5", "6", "7", "9"].map((digit) => [digit, STROKES[digit]!])),
  "1": [[[0.9, 1.3], [2.1, 0], [2.1, 6]]],
  "8": [[[2, 0], [3, 0.3], [3.5, 1.1], [3, 2], [2, 2.7], [1, 3.2], [0.4, 4.2], [0.8, 5.3], [2, 6], [3.2, 5.3], [3.6, 4.2], [3, 3.2], [2, 2.7], [1, 2], [0.5, 1.1], [1, 0.3], [2, 0]]],
};
