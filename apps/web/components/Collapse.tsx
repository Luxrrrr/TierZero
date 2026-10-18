"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePresence } from "../lib/use-presence";

/**
 * Opens and closes its content by animating a grid row between 0fr and 1fr, so
 * the height follows the content without being measured. Pass the content only
 * while it should be open (`open ? <Body /> : null`); the last content stays
 * on screen while it closes. With `keep`, the content stays mounted and is
 * only hidden, for panels that hold state or have to be in the page for a
 * control to point at. Content that is already open on first render starts
 * open without animating.
 */
export function Collapse({ open, keep = false, children }: { open: boolean; keep?: boolean; children: ReactNode }) {
  const { mounted } = usePresence(open, 260);
  const [expanded, setExpanded] = useState(open);
  const last = useRef<ReactNode>(children);
  const node = useRef<HTMLDivElement>(null);
  if (children) last.current = children;

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setExpanded(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open]);

  const shown = keep ? open : expanded;

  // Clipping is only needed while the height moves; once open, a picker that
  // drops out of the content must not be cut off.
  const [settled, setSettled] = useState(shown);
  useEffect(() => {
    if (!shown) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setSettled(true), 260);
    return () => window.clearTimeout(timer);
  }, [shown]);

  // React 18 does not pass `inert` through, so it is set on the element.
  useEffect(() => {
    node.current?.toggleAttribute("inert", !open);
  });

  if (!keep && !mounted) return null;
  return (
    <div className="collapse" ref={node} data-open={shown ? "true" : "false"} data-settled={settled ? "true" : "false"}>
      <div className="collapse-inner">{keep ? children : last.current}</div>
    </div>
  );
}
