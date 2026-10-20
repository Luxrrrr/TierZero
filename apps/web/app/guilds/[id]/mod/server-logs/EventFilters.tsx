"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SERVER_LOG_CATEGORIES, type ServerLogCategoryId } from "@tier0/shared-moderation";
import { ChevronDownIcon, SearchIcon, XIcon } from "../../../../../components/Icons";
import { Combobox } from "../../../../../components/form/Combobox";
import { DateRangePicker } from "../../../../../components/form/DateRangePicker";
import { activeFilters, hasServerLogFilters, serverLogHref, type ServerLogQuery } from "./params";

interface Props {
  guildId: string;
  query: ServerLogQuery;
  channels: { id: string; name: string }[];
  counts: Record<string, number>;
  /** Which kinds of event the server is saving. */
  recording: Record<string, boolean>;
}

/**
 * Every filter for the events view. They apply as soon as they are changed, so there is no Apply button to
 * forget, and each one that is on shows as a chip that can be taken off. Typing waits a moment before it
 * searches so the list does not jump on every key.
 */
export function EventFilters({ guildId, query, channels, counts, recording }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(query.q);
  const [member, setMember] = useState(query.member);
  const first = useRef(true);
  const comboId = useId();

  function go(next: Partial<ServerLogQuery>) {
    start(() => router.replace(serverLogHref(guildId, { ...query, ...next, page: 1 }), { scroll: false }));
  }

  // Typed text is sent after a pause. The first run is skipped, since nothing has been typed yet.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (q === query.q && member === query.member) return;
    const timer = setTimeout(() => go({ q: q.trim(), member: member.trim() }), 350);
    return () => clearTimeout(timer);
  }, [q, member]);

  // The address changed from outside, such as a chip being cleared, so the boxes follow it.
  useEffect(() => {
    setQ(query.q);
    setMember(query.member);
  }, [query.q, query.member]);

  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? "unknown";
  const filters = activeFilters(query, channelName);

  function toggleCategory(id: ServerLogCategoryId) {
    go({ category: query.category.includes(id) ? query.category.filter((c) => c !== id) : [...query.category, id] });
  }
  function toggleType(id: string) {
    go({ type: query.type.includes(id) ? query.type.filter((t) => t !== id) : [...query.type, id] });
  }

  // With categories chosen, only their event types are offered.
  const typeGroups = SERVER_LOG_CATEGORIES.filter((c) => query.category.length === 0 || query.category.includes(c.id));

  return (
    <div className="sl-filters" data-pending={pending ? "true" : undefined} role="search" aria-label="Filter the server logs">
      <div className="mod-toolbar sl-row">
        <div className="mod-search sl-search">
          <SearchIcon />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search anything: names, channels, what was said"
            aria-label="Search the server logs"
          />
        </div>
        <input
          className="sl-member"
          value={member}
          onChange={(event) => setMember(event.target.value)}
          placeholder="Member name or ID"
          aria-label="Member name or ID. Matches who did it and who it happened to"
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

      <div className="mod-toolbar sl-row sl-categories" role="group" aria-label="What happened">
        <button type="button" className="mod-chip" aria-pressed={query.category.length === 0} onClick={() => go({ category: [] })}>
          Everything
        </button>
        {SERVER_LOG_CATEGORIES.map((category) => {
          const on = query.category.includes(category.id);
          const off = recording[category.id] === false;
          return (
            <button
              key={category.id}
              type="button"
              className="mod-chip"
              data-off={off ? "true" : undefined}
              aria-pressed={on}
              title={off ? `${category.label} are not being saved. Turn them on in the Server logs settings.` : category.description}
              onClick={() => toggleCategory(category.id)}
            >
              {category.label}
              <span className="sl-count">{(counts[category.id] ?? 0).toLocaleString("en")}</span>
            </button>
          );
        })}
      </div>

      <div className="mod-toolbar sl-row sl-dates">
        <DateRangePicker since={query.since} until={query.until} onChange={(range) => go(range)} aria-label="Dates" />

        <details className="sl-types">
          <summary className="mod-chip">
            Event types
            {query.type.length > 0 ? <span className="sl-count">{query.type.length}</span> : null}
            <ChevronDownIcon className="sl-chevron" />
          </summary>
          <div className="sl-types-panel">
            {typeGroups.map((group) => (
              <fieldset key={group.id} className="sl-type-group">
                <legend>{group.label}</legend>
                {group.types.map((type) => (
                  <label key={type.id} className="sl-type">
                    <input type="checkbox" checked={query.type.includes(type.id)} onChange={() => toggleType(type.id)} />
                    {type.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </details>
      </div>

      {hasServerLogFilters(query) ? (
        <div className="sl-active" aria-label="Filters that are on">
          {filters.map((filter) => (
            <button key={filter.key} type="button" className="sl-pill" onClick={() => go(filter.clear)} aria-label={`Remove the filter ${filter.label}`}>
              {filter.label}
              <XIcon />
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ q: "", category: [], type: [], member: "", channel: "", since: "", until: "" })}>
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
