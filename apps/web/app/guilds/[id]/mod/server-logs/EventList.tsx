import Link from "next/link";
import type { ServerLogResult } from "../../../../../lib/mod-api";
import { HistoryIcon } from "../../../../../components/Icons";
import { Pager } from "../../../../../components/mod/ModUi";
import { groupByDay } from "../audit/params";
import { EventRow } from "./EventRow";
import { hasServerLogFilters, serverLogHref, type ServerLogQuery } from "./params";

/** The entries on one page, grouped by day, with how many there are and how to get further. */
export function EventList({ guildId, query, data }: { guildId: string; query: ServerLogQuery; data: ServerLogResult }) {
  const filtered = hasServerLogFilters(query);
  const groups = groupByDay(data.items);
  const nothingOn = Object.values(data.recording).every((on) => !on);

  return (
    <>
      <p className="sl-count-line" role="status">
        <strong>{data.total.toLocaleString("en")}</strong> {data.total === 1 ? "entry" : "entries"}
        {filtered ? " match these filters" : ` from the last ${data.days} ${data.days === 1 ? "day" : "days"}`}
        <span className="sl-tz"> · Dates are in UTC</span>
      </p>

      {data.items.length === 0 ? (
        <div className="mod-card">
          <div className="mod-empty">
            <span className="mod-empty-icon">
              <HistoryIcon />
            </span>
            {filtered ? (
              <>
                <p className="mod-empty-title">Nothing matches these filters</p>
                <p className="mod-empty-text">Widen the dates, take a filter off, or search for less. Searching also looks inside what was said in edited and deleted messages.</p>
                <div className="mod-empty-action">
                  <Link className="btn btn-secondary btn-sm" href={serverLogHref(guildId, {})}>
                    Clear all filters
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="mod-empty-title">{nothingOn ? "Nothing is being recorded" : "Nothing has been logged yet"}</p>
                <p className="mod-empty-text">
                  {nothingOn
                    ? "Every kind of event is switched off in the Server logs settings."
                    : "Entries appear here as things happen on the server. It only has what happened after it was turned on."}
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="mod-card">
          {groups.map((group) => (
            <div className="audit-day" key={group.key} role="group" aria-labelledby={`sl-day-${group.key}`}>
              <h3 className="audit-day-title" id={`sl-day-${group.key}`}>
                {group.label}
                <span className="audit-day-count">
                  {group.items.length} {group.items.length === 1 ? "entry" : "entries"}
                </span>
              </h3>
              <ol className="sl-list">
                {group.items.map((entry) => (
                  <EventRow key={entry.id} guildId={guildId} entry={entry} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      <Pager page={data.page} pageSize={data.pageSize} total={data.total} hrefFor={(page) => serverLogHref(guildId, { ...query, page })} />
    </>
  );
}
