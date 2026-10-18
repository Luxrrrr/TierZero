"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { MemberSearchHit, UserRef } from "@tier0/core";
import { SearchIcon } from "../../../../../components/Icons";
import { Avatar, displayName } from "../../../../../components/mod/ModUi";
import { ADD_SEARCH_ID } from "./ids";

const SEARCH_DELAY_MS = 250;

type SearchState = "idle" | "loading" | "done" | "error";

export interface MemberSearchProps {
  guildId: string;
  existing: ReadonlySet<string>;
  labelId: string;
  onPick(user: UserRef): void;
}

export function MemberSearch({ guildId, existing, labelId, onPick }: MemberSearchProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberSearchHit[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (text === "") {
      setHits([]);
      setState("idle");
      return;
    }
    setState("loading");
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/guilds/${guildId}/mod/member-search?q=${encodeURIComponent(text)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        setHits((await response.json()) as MemberSearchHit[]);
        setActive(0);
        setState("done");
      } catch {
        if (controller.signal.aborted) return;
        setHits([]);
        setState("error");
      }
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, guildId]);

  function pick(hit: MemberSearchHit | undefined) {
    if (!hit) return;
    if (existing.has(hit.user.userId)) {
      setRefusal(`${displayName(hit.user)} already has access. Change their level in the list above, or choose someone else.`);
      return;
    }
    onPick(hit.user);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && hits.length > 0) {
      event.preventDefault();
      setOpen(true);
      setRefusal(null);
      setActive((index) => (index + 1) % hits.length);
    } else if (event.key === "ArrowUp" && hits.length > 0) {
      event.preventDefault();
      setRefusal(null);
      setActive((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === "Home" && open && hits.length > 0) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && open && hits.length > 0) {
      event.preventDefault();
      setActive(hits.length - 1);
    } else if (event.key === "Enter" && open && hits.length > 0) {
      event.preventDefault();
      pick(hits[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const showList = open && query.trim() !== "";
  const expanded = showList && hits.length > 0;
  const status =
    state === "loading"
      ? "Searching…"
      : state === "error"
        ? "Search failed. You can still add someone by their user id."
        : state === "done" && hits.length === 0
          ? "No member matches that. If they are not in the server, add them by user id instead."
          : state === "done"
            ? `${hits.length} ${hits.length === 1 ? "member" : "members"} found. Use the arrow keys to move through them.`
            : null;
  const note = refusal ?? (state === "done" && hits.length > 0 ? null : status);
  const announcement = showList ? (refusal ?? status ?? "") : "";

  return (
    <div className="access-search">
      <div className="mod-search">
        <SearchIcon />
        <input
          id={ADD_SEARCH_ID}
          type="text"
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={expanded}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={expanded ? `${baseId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search this server by name"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setRefusal(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {showList ? (
        <div className="access-results">
          {note ? <p className="access-results-note">{note}</p> : null}
          <div id={listId} role="listbox" aria-label="Matching members">
            {hits.map((hit, index) => {
              const already = existing.has(hit.user.userId);
              return (
                <div
                  key={hit.user.userId}
                  id={`${baseId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={already || undefined}
                  className="access-result"
                  data-active={index === active ? "true" : undefined}
                  // Pointer down rather than click: the input's blur would close the list first.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(hit);
                  }}
                  onMouseMove={() => setActive(index)}
                >
                  <Avatar user={hit.user} menu={false} />
                  <span className="access-result-text">
                    <span className="access-result-name">{displayName(hit.user)}</span>
                    <span className="mod-id">{hit.user.userId}</span>
                  </span>
                  {already ? <span className="access-result-note">Already has access</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
