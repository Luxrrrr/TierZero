"use client";

/**
 * The guard against losing unsaved edits by leaving the page.
 *
 * The browser only warns before it unloads a document, and moving between
 * dashboard pages never unloads one: the app router swaps the page in place.
 * So a page with a draft registers here, and while any registered draft is
 * dirty the guard intercepts in-app link clicks (sidebar, tabs, any `<a>`),
 * the browser's Back button, and navigation the page starts itself through
 * `confirmLeave`, and asks first: Stay, Discard changes, or Save and leave
 * when the page can save. Closing the tab or reloading still gets the
 * browser's own prompt.
 *
 * Using it on a page:
 *
 *   const guard = useUnsavedGuard({ dirty, onSave: save, onDiscard: discard });
 *   // ...render {guard.host} once anywhere in the page.
 *   // Before navigating from code: guard.confirmLeave(() => router.push(href)).
 *
 * `onSave` resolves to true once the draft is saved; a false or a throw keeps
 * the person on the page, where the page shows why. `onDiscard` throws the
 * draft away. Both are optional: without `onSave` the dialog offers only Stay
 * and Discard.
 *
 * `host` draws the dialog. Every page using the hook renders its own and only
 * one of them draws at a time, so pages need no provider above them; a layout
 * can still mount `UnsavedGuardProvider` once, which does the same. Wrap an
 * element in `data-unsaved-guard="ignore"` for links that must never ask, such
 * as a link that opens in a new tab without saying so.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { leavingTo } from "./leave-guard";
import { usePresence } from "./use-presence";

export interface UnsavedGuardOptions {
  dirty: boolean;
  /** Saves the draft. Resolves true when it was saved. */
  onSave?: () => Promise<boolean>;
  /** Throws the draft away. */
  onDiscard?: () => void;
}

export interface UnsavedGuard {
  /** Runs `go` now when nothing is unsaved, otherwise once the person has chosen to leave. */
  confirmLeave(go: () => void): void;
  /** The dialog. Render it once anywhere in the page. */
  host: ReactNode;
}

type Pending =
  | { kind: "link"; href: string }
  | { kind: "back" }
  | { kind: "custom"; go: () => void };

interface Registered {
  options: UnsavedGuardOptions;
  navigate(href: string): void;
}

const guards = new Map<string, Registered>();
const hosts: string[] = [];
const subscribers = new Set<() => void>();
let pending: Pending | null = null;
let installed = false;
/** A copy of the current history entry sits on top, so Back lands on it instead of leaving. */
let armed = false;
let armedAt = "";
/** Set once someone chose to leave, so the page unloading after it does not ask a second time. */
let released = false;

function notify() {
  for (const subscriber of subscribers) subscriber();
}

function dirtyGuards(): Registered[] {
  return [...guards.values()].filter((guard) => guard.options.dirty);
}

function anyDirty(): boolean {
  return dirtyGuards().length > 0;
}

function setPending(next: Pending | null) {
  pending = next;
  notify();
}

/** Runs `go` now, or after asking when there is something to lose. */
export function confirmLeave(go: () => void): void {
  request({ kind: "custom", go });
}

function request(next: Pending) {
  if (!anyDirty()) {
    proceed(next);
    return;
  }
  if (hosts.length === 0) {
    // A page that forgot to render its host still must not lose the draft.
    if (window.confirm("You have changes that are not saved. Leave and lose them?")) {
      discardAll();
      proceed(next);
    } else if (next.kind === "back") {
      arm();
    }
    return;
  }
  setPending(next);
}

function proceed(next: Pending) {
  if (next.kind === "custom") next.go();
  else if (next.kind === "link") {
    const navigate = [...guards.values()][0]?.navigate;
    if (navigate) navigate(next.href);
    else window.location.assign(next.href);
  } else window.history.back();
}

function discardAll() {
  released = true;
  for (const guard of dirtyGuards()) guard.options.onDiscard?.();
}

/** What the dialog's buttons do. */
async function choose(choice: "stay" | "discard" | "save"): Promise<"done" | "failed"> {
  const next = pending;
  if (!next) return "done";
  if (choice === "stay") {
    setPending(null);
    if (next.kind === "back") arm();
    return "done";
  }
  if (choice === "discard") {
    setPending(null);
    discardAll();
    proceed(next);
    return "done";
  }
  for (const guard of dirtyGuards()) {
    let saved: boolean;
    try {
      saved = guard.options.onSave ? await guard.options.onSave() : false;
    } catch {
      saved = false;
    }
    if (!saved) {
      setPending(null);
      if (next.kind === "back") arm();
      return "failed";
    }
  }
  setPending(null);
  proceed(next);
  return "done";
}

function arm() {
  if (armed || !anyDirty()) return;
  armed = true;
  armedAt = window.location.href;
  // The state is copied so the app router still recognises the entry as its own.
  window.history.pushState({ ...(window.history.state ?? {}) }, "", window.location.href);
}

function onClick(event: MouseEvent) {
  if (!anyDirty()) return;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const href = leavingTo(
    {
      href: anchor.getAttribute("href"),
      target: anchor.getAttribute("target"),
      download: anchor.hasAttribute("download"),
      button: event.button,
      modified: event.ctrlKey || event.metaKey || event.shiftKey || event.altKey,
      defaultPrevented: event.defaultPrevented,
      ignored: anchor.closest('[data-unsaved-guard="ignore"]') !== null,
    },
    window.location.href,
  );
  if (href === null) return;
  // Capture phase on the document runs before the router's own handler on the
  // app root, so stopping here means it never starts the navigation.
  event.preventDefault();
  event.stopPropagation();
  request({ kind: "link", href });
}

function onPopState() {
  if (!armed || window.location.href !== armedAt) return;
  // Back took the copy off the top: the page is still the same one.
  armed = false;
  if (anyDirty()) request({ kind: "back" });
  else window.history.back();
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (released || !anyDirty()) return;
  event.preventDefault();
  // Older browsers only prompt when this is set.
  event.returnValue = "";
}

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener("click", onClick, true);
  window.addEventListener("popstate", onPopState);
  window.addEventListener("beforeunload", onBeforeUnload);
}

function uninstall() {
  if (!installed || guards.size > 0) return;
  installed = false;
  armed = false;
  document.removeEventListener("click", onClick, true);
  window.removeEventListener("popstate", onPopState);
  window.removeEventListener("beforeunload", onBeforeUnload);
}

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Registers a draft with the guard for as long as the component is mounted.
 * See the top of this file for how a page uses it.
 */
export function useUnsavedGuard(options: UnsavedGuardOptions): UnsavedGuard {
  const id = useId();
  const router = useRouter();
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const entry: Registered = {
      get options() {
        return latest.current;
      },
      navigate: (href) => router.push(href),
    };
    guards.set(id, entry);
    install();
    return () => {
      guards.delete(id);
      uninstall();
      notify();
    };
  }, [id, router]);

  useEffect(() => {
    if (options.dirty) {
      released = false;
      arm();
    }
    notify();
  }, [options.dirty]);

  const confirm = useCallback((go: () => void) => confirmLeave(go), []);
  return { confirmLeave: confirm, host: <UnsavedGuardHost /> };
}

/** For a layout: draws the dialog for every page under it. Pages do not need it. */
export function UnsavedGuardProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <UnsavedGuardHost />
    </>
  );
}

/** A guard as an element, for a page that would rather not call the hook. */
export function UnsavedChangesGuard(props: UnsavedGuardOptions) {
  return useUnsavedGuard(props).host;
}

function UnsavedGuardHost() {
  const id = useId();
  const current = useSyncExternalStore(subscribe, () => pending, () => null);
  const [first, setFirst] = useState(false);

  useEffect(() => {
    hosts.push(id);
    const update = () => setFirst(hosts[0] === id);
    update();
    const unsubscribe = subscribe(update);
    notify();
    return () => {
      const at = hosts.indexOf(id);
      if (at !== -1) hosts.splice(at, 1);
      unsubscribe();
      notify();
    };
  }, [id]);

  const open = first && current !== null;
  const presence = usePresence(open, 180);
  // What the dialog offered stays as it was while it plays its exit.
  const canSave = useRef(false);
  if (open) canSave.current = dirtyGuards().every((guard) => guard.options.onSave !== undefined);

  if (!first || !presence.mounted) return null;
  return <LeaveDialog canSave={canSave.current} leaving={presence.leaving} />;
}

const FOCUSABLE = "button:not([disabled])";

function LeaveDialog({ canSave, leaving }: { canSave: boolean; leaving: boolean }) {
  const titleId = useId();
  const textId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stayRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) void choose("stay");
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const firstNode = nodes[0];
    const lastNode = nodes[nodes.length - 1];
    if (!firstNode || !lastNode) return;
    if (event.shiftKey && document.activeElement === firstNode) {
      event.preventDefault();
      lastNode.focus();
    } else if (!event.shiftKey && document.activeElement === lastNode) {
      event.preventDefault();
      firstNode.focus();
    }
  }

  async function save() {
    setSaving(true);
    await choose("save");
    setSaving(false);
  }

  return createPortal(
    <div className="sheet-layer leave-layer" data-leaving={leaving ? "true" : undefined}>
      <div className="sheet-scrim" aria-hidden="true" onClick={() => !saving && void choose("stay")} />
      <div
        ref={dialogRef}
        className="msg-dialog leave-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={onKeyDown}
      >
        <div className="msg-dialog-head">
          <h2 className="msg-dialog-title" id={titleId}>
            Leave without saving?
          </h2>
        </div>
        <div className="msg-dialog-body">
          <p id={textId}>
            {canSave
              ? "Some changes on this page are not saved yet. Save them first, or leave and lose them."
              : "Some changes on this page are not saved yet. If you leave now, they are lost."}
          </p>
        </div>
        <div className="msg-dialog-foot leave-dialog-foot">
          <button type="button" className="btn btn-ghost" ref={stayRef} disabled={saving} onClick={() => void choose("stay")}>
            Stay on this page
          </button>
          <button type="button" className="btn btn-danger" disabled={saving} onClick={() => void choose("discard")}>
            Discard changes
          </button>
          {canSave ? (
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? <span className="spinner" aria-hidden="true" /> : null}
              {saving ? "Saving…" : "Save and leave"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
