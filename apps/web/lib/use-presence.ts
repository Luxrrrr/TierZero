"use client";

import { useEffect, useState } from "react";

/**
 * Keeps something on screen for a moment after it stops being wanted, so it
 * can play an exit. `mounted` is what to render; `leaving` is true during the
 * exit and is what to hang the exit styles on.
 */
export function usePresence(open: boolean, ms = 160): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(timer);
  }, [open, mounted, ms]);

  return { mounted: open || mounted, leaving: !open && mounted };
}
