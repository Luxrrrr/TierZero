import Link from "next/link";
import type { MessageLogResult } from "../../../../../lib/mod-api";
import { HistoryIcon, SearchIcon } from "../../../../../components/Icons";
import { Pager } from "../../../../../components/mod/ModUi";
import { MessageList } from "./MessageList";
import { hasMessageLogFilters, messageLogHref, type MessageLogQuery } from "./message-params";

const STATES = [
  { id: "all", label: "All messages" },
  { id: "deleted", label: "Deleted" },
  { id: "edited", label: "Edited" },
] as const;

/** The saved text of what members posted, with every edit. Tick messages to take action on their author. */
export function MessagesView({ guildId, query, data }: { guildId: string; query: MessageLogQuery; data: MessageLogResult }) {
  const filtered = hasMessageLogFilters(query);

  return (
    <>
      <form className="mod-toolbar ml-toolbar" method="get" role="search" aria-label="Search saved messages">
        <input type="hidden" name="view" value="messages" />
        {query.state !== "all" ? <input type="hidden" name="state" value={query.state} /> : null}
        {query.message ? <input type="hidden" name="message" value={query.message} /> : null}
        <div className="mod-search">
          <SearchIcon />
          <input name="q" type="search" defaultValue={query.q} placeholder="Search what was said" aria-label="Search saved messages" />
        </div>
        <input className="ml-author" name="author" defaultValue={query.author} placeholder="Member name or ID" aria-label="Member name or ID" />
        <select name="channel" className="mod-select ml-select" defaultValue={query.channel} aria-label="Channel">
          <option value="">Any channel</option>
          {data.channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
        <label className="ml-date">
          <span>From</span>
          <input type="date" name="since" defaultValue={query.since} max={query.until || undefined} />
        </label>
        <label className="ml-date">
          <span>To</span>
          <input type="date" name="until" defaultValue={query.until} min={query.since || undefined} />
        </label>
        <button type="submit" className="btn btn-secondary btn-sm">
          Apply
        </button>
      </form>

      <div className="mod-toolbar ml-chips">
        <div className="mod-toolbar-group" role="group" aria-label="Which messages">
          {STATES.map((state) => (
            <Link
              key={state.id}
              className="mod-chip"
              href={messageLogHref(guildId, { ...query, state: state.id, page: 1 })}
              aria-current={query.state === state.id ? "true" : undefined}
            >
              {state.label}
            </Link>
          ))}
        </div>
        {filtered ? (
          <Link className="btn btn-ghost btn-sm" href={messageLogHref(guildId, {})}>
            Clear filters
          </Link>
        ) : null}
      </div>

      <p className="ml-count" role="status">
        <strong>{data.total.toLocaleString("en")}</strong> {data.total === 1 ? "message" : "messages"}
        {filtered ? " match" : ` from the last ${data.days} ${data.days === 1 ? "day" : "days"}`}
        <span className="ml-tz"> · Dates are in UTC</span>
      </p>

      {data.items.length === 0 ? (
        <div className="mod-card">
          <div className="mod-empty">
            <span className="mod-empty-icon">
              <HistoryIcon />
            </span>
            <p className="mod-empty-title">{filtered ? "No messages match" : "Nothing has been saved yet"}</p>
            <p className="mod-empty-text">
              {filtered
                ? "Widen the dates or clear a filter. Searching also looks at earlier versions of edited messages."
                : "Messages appear here as members post them."}
            </p>
          </div>
        </div>
      ) : (
        <MessageList guildId={guildId} items={data.items} />
      )}

      <Pager page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(page) => messageLogHref(guildId, { ...query, page })} />
    </>
  );
}
