"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { applyPrePaint, type PrePaintArgs } from "../lib/pre-paint";

const subscribe = () => () => undefined;

/**
 * The inline script that applies the saved theme and sidebar before first
 * paint.
 *
 * A page rendered on the server carries the script in its HTML, and it runs
 * there. `code` is that script as the server wrote it, so hydration finds
 * the same text. Hydration renders the same element so the trees match, and it is
 * dropped once hydration is over. A page Next.js renders in the browser from
 * scratch, as it does for a 403 or 404 that refused before any HTML was
 * streamed, would otherwise create the script element with React, which never
 * runs it and warns about it; there the element is left out and the same
 * function runs in a layout effect, which still comes before the browser paints.
 */
export function PrePaint({ code, args }: { code: string; args: PrePaintArgs }) {
  const fromServer = useSyncExternalStore(subscribe, () => false, () => true);
  const hydrated = useRef(fromServer);

  useLayoutEffect(() => {
    if (!hydrated.current) applyPrePaint(...args);
  }, [args]);

  return fromServer ? <script dangerouslySetInnerHTML={{ __html: code }} /> : null;
}
