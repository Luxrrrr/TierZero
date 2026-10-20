import { encodePng } from "./png.js";
import { GLYPH_HEIGHT, GLYPH_WIDTH, STROKES } from "./strokes.js";

/**
 * Draws the image captcha. Everything about a picture comes from its seed, so
 * a round only has to remember a number and the picture can be drawn again, or
 * not kept at all, while members are still answering.
 */

export type Rgb = readonly [number, number, number];

/** The colours a round can ask for. Kept far apart in hue so none is taken for another. */
export const COLOURS: Record<string, Rgb> = {
  red: [232, 64, 64],
  green: [84, 204, 100],
  blue: [80, 150, 255],
  yellow: [246, 212, 60],
};

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export const CELL = 46;
export const HEIGHT = 110;
const MARGIN = 24;

export interface TextLayout {
  width: number;
  height: number;
  /** How much of each pixel the characters cover, from 0 to 1. */
  mask: Float32Array;
  /** Which character covers each pixel most, or -1 for none. */
  owner: Int8Array;
}

type Segment = [number, number, number, number];

/** A stroke cut into short pieces, so bending it afterwards bends the line and not just its ends. */
function pieces(points: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const count = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.3));
    for (let k = 0; k < count; k++) out.push([x0 + ((x1 - x0) * k) / count, y0 + ((y1 - y0) * k) / count]);
  }
  const last = points[points.length - 1]!;
  out.push([last[0], last[1]]);
  return out;
}

function cover(layout: TextLayout, [x0, y0, x1, y1]: Segment, radius: number, character: number): void {
  const { width, height, mask, owner } = layout;
  const left = Math.max(0, Math.floor(Math.min(x0, x1) - radius - 1));
  const right = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + radius + 1));
  const top = Math.max(0, Math.floor(Math.min(y0, y1) - radius - 1));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + radius + 1));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = dx * dx + dy * dy;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const along = length > 0 ? clamp(((px - x0) * dx + (py - y0) * dy) / length, 0, 1) : 0;
      const distance = Math.hypot(px - (x0 + along * dx), py - (y0 + along * dy));
      const amount = clamp(radius + 0.5 - distance, 0, 1);
      const at = y * width + x;
      if (amount > mask[at]!) {
        mask[at] = amount;
        owner[at] = character;
      }
    }
  }
}

/**
 * Lays the characters out along a line and bends each its own way: slant,
 * tilt, size, thickness and position all differ, and a wave runs across the
 * whole row so no two characters are bent alike. `weight` thickens the lines,
 * `bend` scales how far everything is bent (below one is calmer) and `scale`
 * makes the whole picture bigger.
 */
export interface LayoutOptions {
  weight?: number;
  bend?: number;
  scale?: number;
  /** How wide each character is, as a share of its usual width. Below one leaves room between neighbours. */
  width?: number;
}

export function layoutText(code: string, random: Random, { weight = 1, bend = 1, scale = 1, width: narrow = 1 }: LayoutOptions = {}): TextLayout {
  const width = Math.round((code.length * CELL + MARGIN * 2) * scale);
  const height = Math.round(HEIGHT * scale);
  const layout: TextLayout = { width, height, mask: new Float32Array(width * height), owner: new Int8Array(width * height).fill(-1) };
  const waveX = (2 + random() * 2.2) * scale * bend;
  const waveY = (2 + random() * 2.2) * scale * bend;
  const periodX = (70 + random() * 40) * scale;
  const periodY = (90 + random() * 60) * scale;
  const phaseX = random() * Math.PI * 2;
  const phaseY = random() * Math.PI * 2;

  [...code].forEach((character, index) => {
    const centreX = (MARGIN + CELL * (index + 0.5) + (random() - 0.5) * 8 * bend) * scale;
    const centreY = (HEIGHT / 2 + (random() - 0.5) * 12 * bend) * scale;
    const unit = ((56 + random() * 12) * scale) / GLYPH_HEIGHT;
    const stretch = unit * narrow * (1 + (random() - 0.5) * 0.3 * bend);
    const tilt = (random() - 0.5) * 0.5 * bend;
    const slant = (random() - 0.5) * 0.5 * bend;
    const radius = unit * (0.24 + random() * 0.1) * weight;
    const [cos, sin] = [Math.cos(tilt), Math.sin(tilt)];
    for (const stroke of STROKES[character] ?? []) {
      const bent = pieces(stroke).map(([gx, gy]) => {
        const lx = gx - GLYPH_WIDTH / 2;
        const ly = gy - GLYPH_HEIGHT / 2;
        const sx = (lx + slant * ly) * stretch;
        const sy = ly * unit;
        const x = centreX + sx * cos - sy * sin;
        const y = centreY + sx * sin + sy * cos;
        return [x + waveX * Math.sin((2 * Math.PI * y) / periodY + phaseX), y + waveY * Math.sin((2 * Math.PI * x) / periodX + phaseY)] as const;
      });
      for (let i = 0; i < bent.length - 1; i++) cover(layout, [bent[i]![0], bent[i]![1], bent[i + 1]![0], bent[i + 1]![1]], radius, index);
    }
  });
  return layout;
}

export function hsl(hue: number, saturation: number, lightness: number): Rgb {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

export interface Canvas {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export function blend(canvas: Canvas, x: number, y: number, [r, g, b]: Rgb, alpha: number): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const at = (y * canvas.width + x) * 3;
  const p = canvas.pixels;
  p[at] = p[at]! + (r - p[at]!) * alpha;
  p[at + 1] = p[at + 1]! + (g - p[at + 1]!) * alpha;
  p[at + 2] = p[at + 2]! + (b - p[at + 2]!) * alpha;
}

/** A thin wandering line, drawn over the picture so it crosses the characters. */
export function curve(canvas: Canvas, random: Random, colour: Rgb, alpha: number): void {
  const { width, height } = canvas;
  const base = height * (0.2 + random() * 0.6);
  const amplitude = 8 + random() * 22;
  const period = 50 + random() * 90;
  const phase = random() * Math.PI * 2;
  const slope = (random() - 0.5) * 0.35;
  const radius = 0.7 + random() * 0.5;
  for (let x = 0; x < width; x += 0.5) {
    const y = base + amplitude * Math.sin((2 * Math.PI * x) / period + phase) + slope * (x - width / 2);
    for (let dy = -2; dy <= 2; dy++) {
      const py = Math.round(y) + dy;
      const amount = clamp(radius + 0.5 - Math.abs(py + 0.5 - y), 0, 1) * alpha;
      if (amount > 0) blend(canvas, Math.floor(x), py, colour, amount);
    }
  }
}

export function backdrop(width: number, height: number, random: Random): Canvas {
  const pixels = new Uint8Array(width * height * 3);
  const base: Rgb = [28 + random() * 14, 30 + random() * 14, 42 + random() * 16];
  const angle = random() * Math.PI * 2;
  const [gx, gy] = [Math.cos(angle), Math.sin(angle)];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lift = (((x / width - 0.5) * gx + (y / height - 0.5) * gy) * 22);
      const grain = (random() - 0.5) * 18;
      const at = (y * width + x) * 3;
      pixels[at] = base[0] + lift + grain;
      pixels[at + 1] = base[1] + lift + grain;
      pixels[at + 2] = base[2] + lift + grain;
    }
  }
  const canvas = { width, height, pixels };
  for (let i = 0; i < width * height * 0.012; i++) {
    const grey = 70 + random() * 70;
    blend(canvas, Math.floor(random() * width), Math.floor(random() * height), [grey, grey, grey + 10], 0.75);
  }
  return canvas;
}

export interface StillSpec {
  code: string;
  /** One colour per character, or none for a single light colour. */
  colours?: readonly Rgb[];
  seed: number;
}

/** What a character is drawn in: its own colour, nudged a little so no two match exactly. */
function inkFor(spec: StillSpec, index: number, tint: Rgb, random: Random): Rgb {
  const ink = spec.colours?.[index] ?? tint;
  const nudge = () => (random() - 0.5) * 24;
  return [clamp(ink[0] + nudge(), 0, 255), clamp(ink[1] + nudge(), 0, 255), clamp(ink[2] + nudge(), 0, 255)];
}

export function renderStill(spec: StillSpec): Buffer {
  const random = seeded(spec.seed);
  const layout = layoutText(spec.code, random, { width: 0.88 });
  const canvas = backdrop(layout.width, layout.height, random);
  const tint = hsl(random() * 360, 0.35, 0.84);
  // Lines drawn in the text's own colour, only fainter, so they cannot be told apart by colour.
  const lineColour: Rgb = spec.colours ? [140, 140, 150] : [tint[0] * 0.6 + 40, tint[1] * 0.6 + 40, tint[2] * 0.6 + 40];

  for (let i = 0; i < 2; i++) curve(canvas, random, lineColour, 0.5);

  const inks = [...spec.code].map((_, index) => inkFor(spec, index, tint, random));
  const { mask, owner } = layout;
  for (let i = 0; i < mask.length; i++) {
    const amount = mask[i]!;
    if (amount === 0) continue;
    blend(canvas, i % layout.width, Math.floor(i / layout.width), inks[owner[i]!]!, amount);
  }

  curve(canvas, random, lineColour, 0.6);
  return encodePng(canvas.width, canvas.height, canvas.pixels);
}
