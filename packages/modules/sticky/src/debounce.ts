/**
 * Collects calls per key and runs the work once the key has been quiet for its
 * pause, or once `ceiling` has passed since the first call, whichever is first.
 * Without the ceiling a channel that never goes quiet would never get its
 * sticky back.
 */
export class Settler {
  private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout>; since: number }>();

  constructor(private readonly ceiling: number) {}

  /** Starts or restarts the wait for `key`. `work` runs once, with whatever the latest call passed. */
  touch(key: string, pause: number, work: () => void | Promise<void>): void {
    const now = Date.now();
    const existing = this.pending.get(key);
    const since = existing?.since ?? now;
    if (existing) clearTimeout(existing.timer);
    const wait = Math.max(0, Math.min(pause, since + this.ceiling - now));
    const timer = setTimeout(() => {
      this.pending.delete(key);
      void Promise.resolve(work()).catch(() => {});
    }, wait);
    timer.unref?.();
    this.pending.set(key, { timer, since });
  }

  cancel(key: string): void {
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    this.pending.delete(key);
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }
}
