/** The version this dashboard was built from, set from the root package's version at build time. */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

/** A release tag such as "v0.2.1" or "0.2.1" as three numbers, or null when it is not one. Anything after a dash is ignored. */
export function parseVersion(text: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Positive when `a` is newer than `b`, negative when older, 0 when the same or when either is not a version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x[i]! !== y[i]!) return x[i]! - y[i]!;
  }
  return 0;
}
