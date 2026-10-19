/**
 * One piece of a control API path. The URL parser resolves a lone "." or ".."
 * even when it came from encodeURIComponent, which would let a request name a
 * different route than the one the proxy meant to call. Those two values name
 * nothing real, so they become an id no route matches.
 */
export function segment(value: string): string {
  return value === "." || value === ".." ? "%00" : encodeURIComponent(value);
}
