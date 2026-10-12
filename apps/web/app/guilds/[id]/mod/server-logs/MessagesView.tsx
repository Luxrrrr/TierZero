import Link from "next/link";
import type { MessageLogResult } from "../../../../../lib/mod-api";
import { HistoryIcon } from "../../../../../components/Icons";
import { Pager } from "../../../../../components/mod/ModUi";
import { MessageFilters } from "./MessageFilters";
import { MessageList } from "./MessageList";
import { hasMessageLogFilters, messageLogHref, type MessageLogQuery } from "./message-params";

const clipExcerpt = (text: string) => (text.length > 40 ? `${text.slice(0, 39)}…` : text);

/** Names the single-message filter by who wrote it and what it said, so the chip is not just "one message". */
function oneMessage(item: MessageLogResult["items"][number] | undefined) {
  return item ? { author: item.author.name ?? `User ${item.author.userId.slice(-4)}`, excerpt: clipExcerpt(item.content.replace(/\s+/g, " ").trim()) } : null;
}

/** The saved text of what members posted, with every edit. Tick messages to take action on their author. */
export function MessagesView({ guildId, query, data }: { guildId: string; query: MessageLogQuery; data: MessageLogResult }) {
  const filtered = hasMessageLogFilters(query);

  return (
    <>
      <MessageFilters guildId={guildId} query={query} channels={data.channels} single={query.message ? oneMessage(data.items[0]) : null} />

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
            <p className="mod-empty-title">{query.message ? "That message isn't saved" : filtered ? "No messages match" : "Nothing has been saved yet"}</p>
            <p className="mod-empty-text">
              {query.message
                ? "It was posted before saving messages was turned on, or in a channel you can't read, or it has been pruned."
                : filtered
                  ? "Widen the dates or take a filter off. Searching also looks at earlier versions of edited messages."
                  : "Messages appear here as members post them."}
            </p>
            {filtered ? (
              <div className="mod-empty-action">
                <Link className="btn btn-secondary btn-sm" href={messageLogHref(guildId, {})}>
                  Clear all filters
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <MessageList guildId={guildId} items={data.items} />
      )}

      <Pager page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(page) => messageLogHref(guildId, { ...query, page })} />
    </>
  );
}
