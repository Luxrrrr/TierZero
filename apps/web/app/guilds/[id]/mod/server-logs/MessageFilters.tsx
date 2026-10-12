"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MESSAGE_LOG_STATES } from "@tier0/core";
import { SearchIcon, XIcon } from "../../../../../components/Icons";
import { hasMessageLogFilters, messageLogHref, type MessageLogQuery } from "./message-params";
import { Combobox } from "../../../../../components/form/Combobox";
import { DateRangePicker } from "../../../../../components/form/DateRangePicker";

const STATE_LABEL: Record<(typeof MESSAGE_LOG_STATES)[number], string> = { all: "All messages", deleted: "Deleted", edited: "Edited" };

interface Props {
  guildId: string;
  query: MessageLogQuery;
  channels: { id: string; name: string }[];
  /** Who wrote the one message being shown and what it says, to name that filter. */
  single?: { author: string; excerpt: string } | null;
}

/**
 * The filters of the Messages view. They work like the Events filters: they apply as soon as they change,
 * and every one that is on, including a single message opened from an Events entry, shows as a chip that
 * can be taken off, so there is never a hidden filter and never a need to leave the view to reset it.
 */
export function MessageFilters({ guildId, query, channels, single }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(query.q);
  const [author, setAuthor] = useState(query.author);
  const first = useRef(true);
  const comboId = useId();

  function go(next: Partial<MessageLogQuery>) {
    start(() => router.replace(messageLogHref(guildId, { ...query, ...next, page: 1 }), { scroll: false }));
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (q === query.q && author === query.author) return;
    const timer = setTimeout(() => go({ q: q.trim(), author: author.trim() }), 350);
    return () => clearTimeout(timer);
  }, [q, author]);

  useEffect(() => {
    setQ(query.q);
    setAuthor(query.author);
  }, [query.q, query.author]);

  const channelName = channels.find((c) => c.id === query.channel)?.name ?? "unknown";

  const chips: { key: string; label: string; clear: Partial<MessageLogQuery> }[] = [
    ...(query.message ? [{ key: "message", label: single ? `Message by ${single.author}${single.excerpt ? `: "${single.excerpt}"` : ""}` : "One message", clear: { message: "" } }] : []),
    ...(query.q ? [{ key: "q", label: `"${query.q}"`, clear: { q: "" } }] : []),
    ...(query.author ? [{ key: "author", label: /^\d+$/.test(query.author) ? `Member ${query.author.slice(-4)}` : `Member "${query.author}"`, clear: { author: "" } }] : []),
    ...(query.channel ? [{ key: "channel", label: `#${channelName}`, clear: { channel: "" } }] : []),
    ...(query.state !== "all" ? [{ key: "state", label: STATE_LABEL[query.state], clear: { state: "all" as const } }] : []),
    ...(query.since || query.until
      ? [{ key: "dates", label: query.since && query.until ? `${query.since} to ${query.until}` : query.since ? `From ${query.since}` : `Until ${query.until}`, clear: { since: "", until: "" } }]
      : []),
  ];

  return (
    <div className="sl-filters" data-pending={pending ? "true" : undefined} role="search" aria-label="Search saved messages">
      {query.message ? (
        <p className="sl-banner" role="status">
          {single ? `Showing the message by ${single.author}, opened from a server log entry.` : "Showing one message, opened from a server log entry."}{" "}
          <button type="button" className="sl-banner-link" onClick={() => go({ message: "" })}>
            Show all messages
          </button>
        </p>
      ) : null}

      <div className="mod-toolbar sl-row">
        <div className="mod-search sl-search">
          <SearchIcon />
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search what was said" aria-label="Search saved messages" />
        </div>
        <input
          className="sl-member"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder="Member name or ID"
          aria-label="Member name or ID"
        />
        <div className="sl-combo">
          <Combobox
            id={`${comboId}-channel`}
            value={query.channel || undefined}
            onChange={(next) => go({ channel: next ?? "" })}
            options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}`, keywords: channel.name }))}
            placeholder="Any channel"
            clearable
            clearLabel="Any channel"
            searchPlaceholder="Find a channel"
            emptyText="No channel by that name"
          />
        </div>
      </div>

      <div className="mod-toolbar sl-row">
        <div className="mod-toolbar-group" role="group" aria-label="Which messages">
          {MESSAGE_LOG_STATES.map((state) => (
            <button key={state} type="button" className="mod-chip" aria-pressed={query.state === state} onClick={() => go({ state })}>
              {STATE_LABEL[state]}
            </button>
          ))}
        </div>
        <DateRangePicker since={query.since} until={query.until} onChange={(range) => go(range)} aria-label="Dates" />
      </div>

      {hasMessageLogFilters(query) ? (
        <div className="sl-active" aria-label="Filters that are on">
          {chips.map((chip) => (
            <button key={chip.key} type="button" className="sl-pill" onClick={() => go(chip.clear)} aria-label={`Remove the filter ${chip.label}`}>
              {chip.label}
              <XIcon />
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ q: "", author: "", message: "", channel: "", state: "all", since: "", until: "" })}>
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
