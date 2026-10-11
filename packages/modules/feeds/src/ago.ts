const UNITS: [string, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "5 minutes ago", for a status line that has to read at a glance. */
export function ago(then: Date, now: Date = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - then.getTime());
  for (const [name, size] of UNITS) {
    if (elapsed >= size) {
      const count = Math.floor(elapsed / size);
      return `${count} ${name}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}
