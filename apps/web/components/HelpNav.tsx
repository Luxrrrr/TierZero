"use client";

import { useEffect, useState } from "react";

interface Item {
  id: string;
  label: string;
}

/**
 * The jump bar stays under the top of the page while you read, and marks the
 * section you are in. The links are plain anchors, so the bar still works
 * with scripting off; the highlight is the only part that needs it.
 */
export function HelpNav({ items }: { items: Item[] }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;

    // A band across the upper third of the viewport: whichever section is in
    // it is the one being read, however tall or short it is.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: "-15% 0px -65% 0px" },
    );
    for (const section of sections) observer.observe(section);

    // The last sections can be too short to ever reach the band above, so at
    // the very bottom of the page the final one is taken to be the one read.
    const last = sections[sections.length - 1];
    function onScroll() {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && last) setCurrent(last.id);
    }
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [items]);

  return (
    <nav className="help-nav" aria-label="On this page">
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          aria-current={current === item.id ? "true" : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
