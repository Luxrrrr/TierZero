"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MobileTopbar } from "./MobileTopbar";
import { RailTooltip } from "./RailTooltip";
import { ToastProvider } from "./Toaster";

interface Props {
  /** The sidebar's contents, rendered on the server and passed through. */
  sidebar: ReactNode;
  /** Shown in the narrow-screen top bar, where the sidebar is hidden. */
  title: string;
  children: ReactNode;
}

const DRAWER_BREAKPOINT = "(max-width: 900px)";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The frame around every signed-in page. Below the breakpoint the sidebar
 * becomes a drawer, which is the only reason this is a client component: the
 * navigation itself is server-rendered and arrives as a prop.
 */
export function AppShell({ sidebar, title, children }: Props) {
  const [drawer, setDrawer] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Entrance motion for things that appear later, such as a chip added to a
  // list, is held back until the page has settled so a first load stays calm.
  useEffect(() => {
    const timer = window.setTimeout(() => document.documentElement.setAttribute("data-motion", "ready"), 500);
    return () => window.clearTimeout(timer);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const query = window.matchMedia(DRAWER_BREAKPOINT);
    const update = () => {
      setDrawer(query.matches);
      if (!query.matches) setOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Off-canvas is a transform, so without this the hidden sidebar keeps its
  // place in the tab order and a keyboard user falls into invisible links.
  useEffect(() => {
    sidebarRef.current?.toggleAttribute("inert", drawer && !open);
  }, [drawer, open]);

  // Navigating is the drawer's whole purpose, so a completed navigation
  // closes it. The ref keeps the very first render from counting as one.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (open) close();
  }, [pathname, open, close]);

  useEffect(() => {
    if (!open) return;

    const node = sidebarRef.current;
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !node) return;

      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!node.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  return (
    <ToastProvider>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="app">
        <aside id="app-sidebar" className="sidebar" data-open={open ? "true" : undefined} ref={sidebarRef}>
          {sidebar}
        </aside>

        <div
          className="sidebar-scrim"
          data-open={open ? "true" : undefined}
          onClick={close}
          aria-hidden="true"
        />

        <div className="app-main">
          <MobileTopbar
            title={title}
            open={open}
            onOpen={() => setOpen(true)}
            buttonRef={menuButtonRef}
          />
          <main className="app-content" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      <RailTooltip />
    </ToastProvider>
  );
}
