/**
 * Reads a request body without ever holding more than `limit` bytes of it. A
 * length check on the declared size is not enough, because a chunked request
 * declares none and request.text() would read all of it before anything could
 * be said. Free of Next imports so the tests can reach it.
 */

/** Room for the largest settings page, with a margin. Routes with a smaller need say so. */
export const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/** The body as text, or null when it is larger than `limit`. */
export async function readTextLimited(request: Request, limit: number = BODY_LIMIT_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read().catch(() => null);
    if (!next || next.done) break;
    const value = next.value;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const whole = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(whole);
}

export type JsonRead<T> = { ok: true; value: T } | { ok: false; reason: "too-large" | "invalid" };

/** The body parsed as JSON. An empty body reads as `{}`. */
export async function readJsonLimited(request: Request, limit: number = BODY_LIMIT_BYTES): Promise<JsonRead<unknown>> {
  const text = await readTextLimited(request, limit);
  if (text === null) return { ok: false, reason: "too-large" };
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** The same, for a route that only takes a JSON object. A list, a string or null is "invalid". */
export async function readJsonObjectLimited(request: Request, limit: number = BODY_LIMIT_BYTES): Promise<JsonRead<Record<string, unknown>>> {
  const read = await readJsonLimited(request, limit);
  if (!read.ok) return read;
  if (typeof read.value !== "object" || read.value === null || Array.isArray(read.value)) return { ok: false, reason: "invalid" };
  return { ok: true, value: read.value as Record<string, unknown> };
}
