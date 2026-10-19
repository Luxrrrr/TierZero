/**
 * Counts joins in a sliding window, so a burst of new members can be told from
 * the usual trickle. Kept free of discord.js so it can be tested on its own.
 */
export class JoinWindow {
  private readonly joins = new Map<string, number[]>();

  /** Notes a join and gives how many there have been within the window, this one included. */
  record(key: string, at: number, withinMs: number): number {
    const recent = this.within(key, at, withinMs);
    recent.push(at);
    this.joins.set(key, recent);
    return recent.length;
  }

  /** How many joins fall in the window as of `at`, without adding one. */
  count(key: string, at: number, withinMs: number): number {
    return this.within(key, at, withinMs).length;
  }

  private within(key: string, at: number, withinMs: number): number[] {
    return (this.joins.get(key) ?? []).filter((time) => at - time < withinMs);
  }
}
