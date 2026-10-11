"use client";

import { useEffect, useRef, useState } from "react";

interface Tip {
  text: string;
  top: number;
  left: number;
}

const HOVER_DELAY = 300;
const LEAVE_DELAY = 120;
const COLLAPSED = '[data-sidebar="collapsed"]';
const DRAWER_QUERY = "(max-width: 900px)";

/**
 * One tooltip for the whole sidebar, drawn outside it. The rail clips its own
 * contents, so a tooltip inside would be cut off at the edge; this one is
 * fixed-position and measured from the element it describes.
 *
 * It follows WCAG 1.4.13: it appears on keyboard focus as well as hover, the
 * pointer can move onto it without it vanishing, and Escape dismisses it. It
 * is hidden from assistive technology on purpose. The element it describes
 * already has the same text as its accessible name, so reading it twice would
 * only be noise.
 *
 * `data-tip` always applies. `data-rail-tip` applies only while the sidebar is
 * collapsed, because expanded entries already show their label.
 */
export function RailTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  // After Escape the same element stays quiet until the pointer or focus has
  // left it, otherwise the next mouse twitch would bring it straight back.
  const dismissedRef = useRef<HTMLElement | null>(null);
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    function railActive(): boolean {
      return (
        document.documentElement.matches(COLLAPSED) && !window.matchMedia(DRAWER_QUERY).matches
      );
    }

    function find(node: EventTarget | null): HTMLElement | null {
      if (!(node instanceof Element)) return null;
      const el = node.closest<HTMLElement>("[data-tip], [data-rail-tip]");
      if (!el) return null;
      if (el.dataset.tip) return el;
      return el.dataset.railTip && railActive() ? el : null;
    }

    function clearTimers() {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
    }

    function hideNow() {
      clearTimers();
      targetRef.current = null;
      setTip(null);
    }

    function hideSoon() {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(hideNow, LEAVE_DELAY);
    }

    function reveal(el: HTMLElement) {
      // A menu that is already open says everything the tooltip would.
      if (el.getAttribute("aria-haspopup") && el.getAttribute("aria-expanded") === "true") return;
      const text = el.dataset.tip ?? el.dataset.railTip;
      if (!text) return;
      const rect = el.getBoundingClientRect();
      targetRef.current = el;
      setTip({ text, top: rect.top + rect.height / 2, left: rect.right });
    }

    function show(el: HTMLElement, delay: number) {
      if (dismissedRef.current === el) return;
      window.clearTimeout(hideTimer.current);
      if (targetRef.current === el) return;
      window.clearTimeout(showTimer.current);
      if (delay === 0) reveal(el);
      else showTimer.current = window.setTimeout(() => reveal(el), delay);
    }

    function onPointerOver(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      if (tipRef.current?.contains(event.target as Node)) {
        window.clearTimeout(hideTimer.current);
        return;
      }
      const el = find(event.target);
      if (dismissedRef.current && dismissedRef.current !== el) dismissedRef.current = null;
      if (el) show(el, targetRef.current ? 0 : HOVER_DELAY);
      else hideSoon();
    }

    function onFocusIn(event: FocusEvent) {
      const el = find(event.target);
      if (dismissedRef.current && dismissedRef.current !== el) dismissedRef.current = null;
      // Focus that arrived by mouse already has the hover tooltip; this is for
      // the keyboard path.
      if (el?.matches(":focus-visible")) show(el, 0);
      else hideNow();
    }

    function onFocusOut() {
      hideNow();
    }

    // Focus can scroll the nav to reveal the item, and that scroll arrives
    // around the time the tooltip does. A focused item keeps its tooltip,
    // moved to where the item now is; anything else is pointing at the wrong
    // thing once the list moves.
    function onScroll() {
      const active = document.activeElement;
      const el = find(active);
      if (el && el === active && el.matches(":focus-visible") && dismissedRef.current !== el) {
        reveal(el);
      } else {
        hideNow();
      }
    }

    // Activating a control can change what its tooltip says (the sidebar
    // toggle flips between collapse and expand), so read it again afterwards.
    function onClick() {
      const el = targetRef.current;
      if (!el) return;
      window.setTimeout(() => {
        if (document.activeElement === el) reveal(el);
      }, 50);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !targetRef.current) return;
      dismissedRef.current = targetRef.current;
      hideNow();
    }

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerdown", hideNow);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    // The nav scrolls under a stationary pointer; a tooltip left behind would
    // point at the wrong entry.
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("click", onClick);
    window.addEventListener("resize", hideNow);

    return () => {
      clearTimers();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", hideNow);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("click", onClick);
      window.removeEventListener("resize", hideNow);
    };
  }, []);

  if (!tip) return null;

  return (
    <div
      ref={tipRef}
      className="rail-tip"
      aria-hidden="true"
      style={{ top: tip.top, left: tip.left }}
    >
      <span className="rail-tip-body">{tip.text}</span>
    </div>
  );
}
