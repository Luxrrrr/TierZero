"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { confirmLeave } from "../../lib/unsaved-guard";
import type { MemberSearchHit, MemberSummary, Page } from "@tier0/shared-moderation";
import { ChevronRightIcon, SearchIcon } from "../Icons";
import { Avatar, displayName } from "./ModUi";
import {
  fromSummaries,
  mergeResults,
  moveActive,
  opensPalette,
  paletteMessage,
  type PaletteResult,
} from "./palette";

const DEBOUNCE_MS = 200;

type Status = "idle" | "loading" | "ready" | "error";

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

/**
 * The header's member search. Opens from the button or Ctrl+K / Cmd+K. With
 * nothing typed it lists the members most recently actioned; with a query it
 * searches both records and the live member list, so someone who has left
 * can still be found.
 */
export function MemberSearch({ guildId }: { guildId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaletteResult[]>([]);
  const [recent, setRecent] = useState<PaletteResult[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState<number | null>(null);
  const [recentFailed, setRecentFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const [shortcut, setShortcut] = useState("Ctrl K");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const base = `/api/guilds/${encodeURIComponent(guildId)}/mod`;
  const q = query.trim();
  const shown = q === "" ? (recent ?? []) : results;
  const message = paletteMessage({
    query,
    recentCount: recent === null ? null : recent.length,
    recentFailed,
    status,
    resultCount: results.length,
    failure,
  });

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(-1);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (/Mac|iPhone|iPad/u.test(navigator.platform)) setShortcut("⌘ K");
  }, []);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (!open && opensPalette(event)) {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  useEffect(() => {
    if (!open || recent !== null) return;
    const controller = new AbortController();
    getJson<Page<MemberSummary>>(`${base}/members?sort=recent&pageSize=5`, controller.signal)
      .then((page) => setRecent(fromSummaries(page.items)))
      .catch(() => {
        if (controller.signal.aborted) return;
        setRecent([]);
        setRecentFailed(true);
      });
    return () => controller.abort();
  }, [open, recent, base]);

  useEffect(() => {
    const text = query.trim();
    if (!open || text === "") {
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(() => {
      const encoded = encodeURIComponent(text);
      Promise.allSettled([
        getJson<Page<MemberSummary>>(`${base}/members?q=${encoded}&pageSize=5`, controller.signal),
        getJson<MemberSearchHit[]>(`${base}/member-search?q=${encoded}`, controller.signal),
      ]).then(([records, members]) => {
        if (controller.signal.aborted) return;
        if (records.status === "rejected" && members.status === "rejected") {
          setFailure(Number((members.reason as Error).message) || null);
          setStatus("error");
          setResults([]);
          return;
        }
        setResults(
          mergeResults(
            records.status === "fulfilled" ? records.value.items : [],
            members.status === "fulfilled" ? members.value : [],
          ),
        );
        setActive(0);
        setStatus("ready");
      });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, base]);

  function go(result: PaletteResult) {
    close();
    // The search is in the header of every Moderation page, settings forms included, so an unsaved draft asks first.
    confirmLeave(() => router.push(`/guilds/${guildId}/mod/members/${result.user.userId}`));
  }

  // On the dialog rather than the input, so Escape and the arrows still work
  // after a click lands somewhere that cannot take focus.
  function onDialogKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => moveActive(current, event.key === "ArrowDown" ? 1 : -1, shown.length));
    } else if (event.key === "Enter") {
      const target = shown[active];
      if (target) {
        event.preventDefault();
        go(target);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      // The input is the only stop in the dialog; options are reached with arrows.
      event.preventDefault();
      inputRef.current?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="mod-palette-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <SearchIcon />
        <span className="mod-palette-trigger-label">Find a member</span>
        <kbd className="mod-kbd" suppressHydrationWarning>
          {shortcut}
        </kbd>
      </button>
      {/* Present from the first render so screen readers are already
          listening when its text changes. */}
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {open ? message.announce : ""}
      </p>

      {open ? (
        <div
          className="mod-palette-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            className="mod-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Find a member"
            onKeyDown={onDialogKey}
            onMouseDown={(event) => {
              // A press on anything but the input would otherwise move focus
              // to the page body, outside the dialog.
              if (event.target !== inputRef.current) event.preventDefault();
            }}
          >
            <div className="mod-palette-input">
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-label="Search by name or user ID"
                aria-expanded={shown.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={active >= 0 && shown[active] ? optionId(active) : undefined}
                placeholder="Search by name or user ID"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(-1);
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="mod-kbd">Esc</kbd>
            </div>
            <div className="mod-palette-body">
              {shown.length > 0 ? (
                <p className="mod-palette-group" aria-hidden="true">
                  {q === "" ? "Recently actioned" : "Members"}
                </p>
              ) : null}
              <ul
                className="mod-palette-list"
                role="listbox"
                id={listId}
                aria-label={q === "" ? "Recently actioned members" : "Matching members"}
              >
                {shown.map((result, index) => (
                  <li
                    key={result.user.userId}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === active}
                    className="mod-palette-option"
                    onMouseMove={() => setActive(index)}
                    onClick={() => go(result)}
                  >
                    <Avatar user={result.user} menu={false} />
                    <span className="mod-palette-option-text">
                      <span className="mod-palette-option-name">{displayName(result.user)}</span>
                      <span className="mod-palette-option-sub">
                        {result.detail ?? <span className="mod-id">{result.user.userId}</span>}
                        {!result.user.inServer && result.user.name !== null ? " · left the server" : null}
                      </span>
                    </span>
                    <ChevronRightIcon className="mod-palette-go" />
                  </li>
                ))}
              </ul>
              {message.shown ? (
                <p className="mod-palette-status" aria-hidden="true">
                  {message.shown}
                </p>
              ) : null}
            </div>
            <div className="mod-palette-foot" aria-hidden="true">
              <span>
                <kbd className="mod-kbd">↑</kbd>
                <kbd className="mod-kbd">↓</kbd> to move
              </span>
              <span>
                <kbd className="mod-kbd">Enter</kbd> to open
              </span>
              <span>
                <kbd className="mod-kbd">Esc</kbd> to close
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
