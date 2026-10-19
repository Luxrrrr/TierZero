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

/** The body parsed as JSON, null when it is too large, or undefined when it is not JSON. An empty body reads as `{}`. */
export async function readJsonLimited(request: Request, limit: number = BODY_LIMIT_BYTES): Promise<unknown | null | undefined> {
  const text = await readTextLimited(request, limit);
  if (text === null) return null;
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
