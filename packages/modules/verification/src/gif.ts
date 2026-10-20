/**
 * A GIF writer for the moving captcha: a fixed palette of up to four colours,
 * every frame the full size of the picture, looping for ever.
 */

const MIN_CODE_SIZE = 2;

function lzw(pixels: Uint8Array): Buffer {
  const clear = 1 << MIN_CODE_SIZE;
  const end = clear + 1;
  const out: number[] = [];
  let accumulator = 0;
  let held = 0;
  const put = (code: number, size: number): void => {
    accumulator |= code << held;
    held += size;
    while (held >= 8) {
      out.push(accumulator & 0xff);
      accumulator >>>= 8;
      held -= 8;
    }
  };

  let size = MIN_CODE_SIZE + 1;
  let next = end + 1;
  const dictionary = new Map<number, number>();
  put(clear, size);
  let prefix = pixels[0]!;
  for (let i = 1; i < pixels.length; i++) {
    const symbol = pixels[i]!;
    const key = (prefix << 8) | symbol;
    const known = dictionary.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    put(prefix, size);
    if (next < 4096) {
      dictionary.set(key, next++);
      // The decoder adds its entries one behind this, so the width grows one entry later than it looks.
      if (next > 1 << size && size < 12) size++;
    } else {
      put(clear, size);
      dictionary.clear();
      next = end + 1;
      size = MIN_CODE_SIZE + 1;
    }
    prefix = symbol;
  }
  put(prefix, size);
  put(end, size);
  if (held > 0) out.push(accumulator & 0xff);
  return Buffer.from(out);
}

function subBlocks(data: Buffer): Buffer {
  const parts: Buffer[] = [];
  for (let at = 0; at < data.length; at += 255) {
    const piece = data.subarray(at, at + 255);
    parts.push(Buffer.from([piece.length]), piece);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

const word = (value: number): Buffer => Buffer.from([value & 0xff, (value >> 8) & 0xff]);

/**
 * Frames hold a palette index per pixel, left to right and top to bottom.
 * `delay` is in hundredths of a second.
 */
export function encodeGif(
  width: number,
  height: number,
  palette: readonly (readonly [number, number, number])[],
  frames: readonly Uint8Array[],
  delay: number,
): Buffer {
  // The colour table has to be a power of two long; the extra entries are never used.
  const tableBits = Math.max(2, Math.ceil(Math.log2(palette.length)));
  const table = Buffer.alloc(3 << tableBits);
  palette.forEach(([r, g, b], index) => table.set([r, g, b], index * 3));

  const parts: Buffer[] = [
    Buffer.from("GIF89a", "ascii"),
    word(width),
    word(height),
    Buffer.from([0x80 | (7 << 4) | (tableBits - 1), 0, 0]),
    table,
    // Loop for ever.
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from("NETSCAPE2.0", "ascii"),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ];
  for (const frame of frames) {
    parts.push(
      Buffer.from([0x21, 0xf9, 0x04, 0x04]),
      word(delay),
      Buffer.from([0x00, 0x00]),
      Buffer.from([0x2c]),
      word(0),
      word(0),
      word(width),
      word(height),
      Buffer.from([0x00, MIN_CODE_SIZE]),
      subBlocks(lzw(frame)),
    );
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
