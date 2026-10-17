"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { UserRef } from "@tier0/core";
import { Avatar, displayName } from "../mod/ModUi";
import { ticketsClient } from "../../lib/tickets-client";

const SEARCH_DELAY_MS = 300;

/**
 * Finds a member of the server by name, the way Moderation's "Find a member"
 * does, so nobody needs a Discord user ID. Arrow keys move through what was
 * found and Enter picks one. Without a pick, Enter hands over the name as
 * typed, for a caller that can work with that.
 */
export function MemberSearch({
  guildId,
  label,
  placeholder = "Search by name",
  exclude = [],
  disabled = false,
  autoFocus = false,
  onPick,
  onName,
}: {
  guildId: string;
  label: string;
  placeholder?: string;
  /** Members to leave out of the results, such as those already added. */
  exclude?: readonly string[];
  disabled?: boolean;
  autoFocus?: boolean;
  onPick(user: UserRef): void;
  /** Called with the typed name when Enter is pressed and nothing is highlighted. */
  onName?(name: string): void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserRef[]>([]);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<"idle" | "searching" | "done" | "failed">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const inputId = useId();
  const listId = useId();
  const statusId = useId();
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setState("idle");
      setActive(-1);
      return;
    }
    const ask = ++latest.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState("searching");
      const result = await ticketsClient.findMembers(guildId, q, controller.signal).catch(() => null);
      if (ask !== latest.current || controller.signal.aborted) return;
      if (!result || !result.ok) {
        setFailure(result && !result.ok ? result.error : null);
        setState("failed");
        setHits([]);
        return;
      }
      const skip = new Set(exclude);
      setHits(result.value.map((hit) => hit.user).filter((user) => !skip.has(user.userId)));
      setActive(-1);
      setState("done");
    }, SEARCH_DELAY_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // `exclude` is read when the answer lands; a new array each render must not search again.
  }, [guildId, query]);

  const pick = (user: UserRef | undefined) => {
    if (!user) return;
    onPick(user);
    setQuery("");
    setHits([]);
    setActive(-1);
    setState("idle");
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && hits.length > 0) {
      event.preventDefault();
      setActive((index) => (index + 1) % hits.length);
    } else if (event.key === "ArrowUp" && hits.length > 0) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? hits.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0) pick(hits[active]);
      else if (hits.length === 1) pick(hits[0]);
      else if (onName && query.trim() !== "") onName(query.trim());
    } else if (event.key === "Escape" && query !== "") {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  };

  const status =
    state === "searching"
      ? "Searching"
      : state === "failed"
        ? (failure ?? "The search did not work. Try again.")
        : state === "done"
          ? hits.length === 0
            ? "Nobody in the server has that name."
            : `${hits.length} found. Use the arrow keys to pick one.`
          : query.trim().length === 1
            ? "Type at least two letters."
            : "";

  return (
    <div className="tk-member-search">
      <label className="tk-small-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="input"
        type="search"
        autoComplete="off"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={statusId}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKey}
      />
      <p className="tk-small tk-muted" id={statusId} aria-live="polite">
        {status}
      </p>
      {hits.length > 0 ? (
        <ul className="tk-member-hits" role="listbox" id={listId} aria-label="Members found">
          {hits.map((user, index) => (
            <li
              key={user.userId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="tk-member-hit"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(user)}
              onMouseEnter={() => setActive(index)}
            >
              <Avatar user={user} size="sm" />
              <span className="tk-member-name">{displayName(user)}</span>
              {!user.inServer ? <span className="tk-muted tk-small">Not in the server</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
