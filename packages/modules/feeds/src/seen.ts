const REMEMBER = 200;

export interface Selection<T> {
  /** Items to post, oldest first, so the channel reads in order. */
  post: T[];
  /** The updated list of ids to remember. */
  seen: string[];
}

/**
 * Decides what a poll should post. Sources arrive newest first.
 *
 * The first poll of a source posts only its newest item: enough to show the
 * feed is working without dumping a backlog into the channel. After that, a
 * source that suddenly returns a lot (a feed that was down, or a site that
 * changed its ids) is capped, and the rest are marked seen rather than posted.
 */
export function selectNew<T extends { id: string }>(
  items: T[],
  seen: string[] | null,
  cap: number,
): Selection<T> {
  const ids = items.map((item) => item.id);

  if (seen === null) {
    const newest = items[0];
    return { post: newest ? [newest] : [], seen: ids.slice(0, REMEMBER) };
  }

  const known = new Set(seen);
  const fresh = items.filter((item) => !known.has(item.id));
  const post = fresh.slice(0, cap).reverse();
  const merged = [...ids, ...seen.filter((id) => !ids.includes(id))].slice(0, REMEMBER);
  return { post, seen: merged };
}
