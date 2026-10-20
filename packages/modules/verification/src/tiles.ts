import { backdrop, blend, clamp, curve, hsl, seeded, type Canvas, type Rgb } from "./image.js";
import { encodePng } from "./png.js";
import { GLYPH_HEIGHT, NUMBER_STROKES } from "./strokes.js";

/**
 * The picture for the tile round: nine squares in three rows, each with a shape
 * in it, and a number in the corner of each that the buttons under the picture
 * share. Which squares have which shape is only in the picture.
 */

export const SHAPES = ["circle", "square", "triangle", "star", "cross"] as const;
export type Shape = (typeof SHAPES)[number];

export interface TilesSpec {
  /** The shape in each square, left to right and top to bottom. */
  shapes: readonly Shape[];
  seed: number;
}

export const TILE = 110;
const GAP = 6;
export const TILES_SIZE = 3 * TILE + 4 * GAP;

type Point = readonly [number, number];

function polygon(points: readonly Point[], angle: number, scale: number): Point[] {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return points.map(([x, y]) => [(x * cos - y * sin) * scale, (x * sin + y * cos) * scale] as const);
}

function star(): Point[] {
  return Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? 1 : 0.42;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
  });
}

const OUTLINES: Record<Exclude<Shape, "circle">, readonly Point[]> = {
  square: [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]],
  triangle: [[0, -1], [0.95, 0.7], [-0.95, 0.7]],
  star: star(),
  cross: [[-0.3, -1], [0.3, -1], [0.3, -0.3], [1, -0.3], [1, 0.3], [0.3, 0.3], [0.3, 1], [-0.3, 1], [-0.3, 0.3], [-1, 0.3], [-1, -0.3], [-0.3, -0.3]],
};

/** How far a shape may be turned. A square or a cross turned far would be taken for a diamond or an X, so they stay near upright. */
const TURN: Record<Shape, number> = { circle: 0, square: 0.35, triangle: Math.PI * 2, star: Math.PI * 2, cross: 0.35 };

/** Distance from a point to the outline, negative inside it. */
function distance(x: number, y: number, outline: readonly Point[]): number {
  let nearest = Infinity;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [x0, y0] = outline[j]!;
    const [x1, y1] = outline[i]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const along = clamp(((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy), 0, 1);
    nearest = Math.min(nearest, Math.hypot(x - (x0 + along * dx), y - (y0 + along * dy)));
    if (y0 > y !== y1 > y && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) inside = !inside;
  }
  return inside ? -nearest : nearest;
}

function drawShape(canvas: Canvas, shape: Shape, centreX: number, centreY: number, radius: number, angle: number, ink: Rgb): void {
  const outline = shape === "circle" ? null : polygon(OUTLINES[shape], angle, radius);
  const reach = Math.ceil(radius * 1.5);
  for (let y = Math.floor(centreY - reach); y <= Math.ceil(centreY + reach); y++) {
    for (let x = Math.floor(centreX - reach); x <= Math.ceil(centreX + reach); x++) {
      const [px, py] = [x + 0.5 - centreX, y + 0.5 - centreY];
      const d = outline ? distance(px, py, outline) : Math.hypot(px, py) - radius;
      const amount = clamp(0.5 - d, 0, 1);
      if (amount > 0) blend(canvas, x, y, ink, amount);
    }
  }
}

/** A small number in the corner of a square, drawn with lines like the captcha's own characters. */
function drawNumber(canvas: Canvas, digit: string, left: number, top: number): void {
  const height = 17;
  const unit = height / GLYPH_HEIGHT;
  for (const stroke of NUMBER_STROKES[digit] ?? []) {
    for (let i = 0; i < stroke.length - 1; i++) {
      const [x0, y0] = stroke[i]!;
      const [x1, y1] = stroke[i + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * unit * 2));
      for (let s = 0; s <= steps; s++) {
        const x = left + (x0 + ((x1 - x0) * s) / steps) * unit;
        const y = top + (y0 + ((y1 - y0) * s) / steps) * unit;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blend(canvas, Math.round(x + dx - 0.5), Math.round(y + dy - 0.5), [225, 228, 236], dx === 0 && dy === 0 ? 0.95 : 0.4);
      }
    }
  }
}

export function renderTiles(spec: TilesSpec): Buffer {
  const random = seeded(spec.seed);
  const canvas = backdrop(TILES_SIZE, TILES_SIZE, random);
  const lineColour: Rgb = [120, 122, 134];
  curve(canvas, random, lineColour, 0.35);

  spec.shapes.forEach((shape, index) => {
    const left = GAP + (index % 3) * (TILE + GAP);
    const top = GAP + Math.floor(index / 3) * (TILE + GAP);
    // The square is a little lighter than what is round it, and has an edge.
    for (let y = top; y < top + TILE; y++) {
      for (let x = left; x < left + TILE; x++) {
        const edge = x < left + 2 || y < top + 2 || x >= left + TILE - 2 || y >= top + TILE - 2;
        blend(canvas, x, y, edge ? [150, 154, 170] : [70, 74, 92], edge ? 0.8 : 0.45);
      }
    }
    const ink = hsl(random() * 360, 0.7, 0.62);
    const radius = 26 + random() * 5;
    const centreX = left + TILE / 2 + (random() - 0.5) * 10;
    const centreY = top + TILE / 2 + 4 + (random() - 0.5) * 8;
    drawShape(canvas, shape, centreX, centreY, radius, (random() * 2 - 1) * (TURN[shape] / 2), ink);
    drawNumber(canvas, String(index + 1), left + 8, top + 7);
  });
  curve(canvas, random, lineColour, 0.3);
  // Specks over everything, shapes included, so no square is a clean cut-out.
  for (let i = 0; i < TILES_SIZE * TILES_SIZE * 0.02; i++) {
    const grey = random() < 0.5 ? 30 : 235;
    blend(canvas, Math.floor(random() * TILES_SIZE), Math.floor(random() * TILES_SIZE), [grey, grey, grey], 0.55);
  }
  return encodePng(canvas.width, canvas.height, canvas.pixels);
}
