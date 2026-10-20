import Link from "next/link";
import type { ReactNode } from "react";
import { TICKET_STATS_PERIODS, type TicketStatsDto } from "@tier0/shared-tickets";
import { HourStrip } from "../../app/guilds/[id]/mod/StatsCharts";
import { EmptyState, LoadFailure, UserChip } from "../mod/ModUi";
import { ChartIcon, CheckIcon, ClockIcon, StarIcon } from "../Icons";
import { durationText } from "../../lib/ticket-format";
import { averageText, backlogText, isQuietPeriod, ratingBars, statsListHref } from "../../lib/ticket-stats";
import type { Loaded } from "./InboxScreen";
import { TicketDayChart } from "./TicketDayChart";

function Card({ title, desc, flush = false, children }: { title: string; desc?: string; flush?: boolean; children: ReactNode }) {
  return (
    <section className="mod-card">
      <div className="mod-card-head">
        <div>
          <h2 className="mod-card-title">{title}</h2>
          {desc ? <p className="mod-card-desc">{desc}</p> : null}
        </div>
      </div>
      <div className={`mod-card-body${flush ? " mod-card-body--flush" : ""}`}>{children}</div>
    </section>
  );
}

function Kpi({ label, value, foot, icon }: { label: string; value: string; foot?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mod-kpi">
      <span className="mod-kpi-label">
        {icon}
        {label}
      </span>
      <span className="mod-kpi-value">{value}</span>
      <span className="mod-kpi-foot">
        <span className="tk-kpi-note">{foot}</span>
      </span>
    </div>
  );
}

export function StatsPeriods({ guildId, days }: { guildId: string; days: number }) {
  return (
    <div className="mod-toolbar stats-toolbar">
      <p className="stats-period">
        <ClockIcon />
        <span>
          <strong>Last {days} days</strong>
          <span className="stats-period-note"> · hours are UTC</span>
        </span>
      </p>
      <span className="mod-toolbar-spacer" />
      <nav className="stats-seg" aria-label="Time range">
        {TICKET_STATS_PERIODS.map((range) => (
          <Link
            key={range}
            href={`/guilds/${guildId}/tickets/stats?days=${range}`}
            aria-current={range === days ? "true" : undefined}
            scroll={false}
          >
            {range === days ? <CheckIcon /> : null}
            {range} days
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * How the team is doing on tickets: what came in and went out, how fast,
 * how members rated it, by type, by person, and by hour.
 */
export function TicketStatsScreen({ guildId, days, stats }: { guildId: string; days: number; stats: Loaded<TicketStatsDto> }) {
  if (!stats.ok) {
    return (
      <div className="mod-page stats-page">
        <StatsPeriods guildId={guildId} days={days} />
        <div className="mod-card">
          <LoadFailure status={stats.status} what="the statistics" retryHref={`/guilds/${guildId}/tickets/stats?days=${days}`} />
        </div>
      </div>
    );
  }
  const s = stats.value;

  if (isQuietPeriod(s)) {
    return (
      <div className="mod-page stats-page">
        <StatsPeriods guildId={guildId} days={days} />
        <section className="mod-card">
          <EmptyState icon={<ChartIcon />} title={`A quiet ${days} days`}>
            No tickets were opened or closed in this range, and none are open now. Numbers appear here as members use the
            panel.
          </EmptyState>
        </section>
      </div>
    );
  }

  const bars = ratingBars(s.ratingDistribution);
  const ratedTypes = s.byType.length > 0;

  return (
    <div className="mod-page stats-page">
      <StatsPeriods guildId={guildId} days={days} />

      <h2 className="visually-hidden">Totals for the last {days} days</h2>
      <section className="stats-kpis tk-kpis" aria-label="Totals for the range">
        <Kpi label="Open now" value={s.openNow.toLocaleString("en")} foot="Across every type you handle" />
        <Kpi label="Opened" value={s.opened.toLocaleString("en")} foot={backlogText(s.opened, s.closed)} />
        <Kpi label="Closed" value={s.closed.toLocaleString("en")} foot={`In the last ${days} days`} />
        <Kpi label="First answer" value={durationText(s.medianFirstResponseMs)} foot="Median wait for staff" />
        <Kpi label="Time to close" value={durationText(s.medianResolutionMs)} foot="Median, open to closed" />
        <Kpi
          label="Rating"
          icon={<StarIcon />}
          value={averageText(s.averageRating)}
          foot={s.ratingCount === 0 ? "Nobody has rated yet" : `From ${s.ratingCount} ${s.ratingCount === 1 ? "rating" : "ratings"}`}
        />
      </section>

      <div className="stats-row stats-row--chart">
        <Card title="Opened and closed" desc="Per day. A gap between the lines is work building up or clearing.">
          <TicketDayChart perDay={s.perDay} />
        </Card>
        <Card title="Ratings" desc={s.ratingCount === 0 ? "Turn ratings on under Settings, then Ratings." : `${s.ratingCount} in this range`}>
          <ul className="tk-ratingbars">
            {bars.map((bar) => (
              <li key={bar.stars}>
                <span className="tk-ratingbars-label">
                  {bar.stars} <StarIcon filled />
                  <span className="visually-hidden">{bar.stars === 1 ? " star" : " stars"}</span>
                </span>
                <span className="tk-ratingbars-track" aria-hidden="true">
                  <span className="tk-ratingbars-fill" style={{ width: `${bar.percent}%` }} />
                </span>
                <span className="tk-ratingbars-count">
                  {bar.count}
                  <span className="visually-hidden"> ({bar.percent}%)</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {ratedTypes ? (
        <Card title="By type" desc="What members open tickets about, and how each is going." flush>
          <div className="mod-table-wrap">
            <table className="mod-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col" className="mod-num">
                    Open now
                  </th>
                  <th scope="col" className="mod-num">
                    Opened
                  </th>
                  <th scope="col" className="mod-num">
                    Closed
                  </th>
                  <th scope="col" className="mod-num">
                    First answer
                  </th>
                  <th scope="col" className="mod-num">
                    Time to close
                  </th>
                  <th scope="col" className="mod-num">
                    Rating
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.byType.map((type) => {
                  const href = statsListHref(guildId, type.listQuery);
                  return (
                  <tr key={type.typeId ?? type.typeName}>
                    <td data-label="">
                      {href ? (
                        <Link className="tk-stats-link" href={href} title={`Every ${type.typeName || "ticket"} ticket`}>
                          <strong>{type.typeName || "Ticket"}</strong>
                        </Link>
                      ) : (
                        <strong>{type.typeName || "Ticket"}</strong>
                      )}
                    </td>
                    <td data-label="Open now" className="mod-num">
                      {type.openNow}
                    </td>
                    <td data-label="Opened" className="mod-num">
                      {type.opened}
                    </td>
                    <td data-label="Closed" className="mod-num">
                      {type.closed}
                    </td>
                    <td data-label="First answer" className="mod-num">
                      {durationText(type.medianFirstResponseMs)}
                    </td>
                    <td data-label="Time to close" className="mod-num">
                      {durationText(type.medianResolutionMs)}
                    </td>
                    <td data-label="Rating" className="mod-num">
                      {type.ratingCount === 0 ? <span className="tk-muted">None</span> : `${averageText(type.averageRating)} (${type.ratingCount})`}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <div className="stats-stack">
        <Card
          title="Handlers"
          desc="Who claimed, closed and answered tickets in this range. First answer is how long the member waited for theirs."
          flush
        >
          {s.byHandler.length === 0 ? (
            <EmptyState compact title="Nobody yet">
              Claims and closes by staff show here.
            </EmptyState>
          ) : (
            <div className="mod-table-wrap">
              <table className="tk-handlers">
                <thead>
                  <tr>
                    <th scope="col">Handler</th>
                    <th scope="col">Claimed</th>
                    <th scope="col">Closed</th>
                    <th scope="col" className="tk-col-minor">Answered first</th>
                    <th scope="col">First answer</th>
                    <th scope="col">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byHandler.map((row) => {
                    const href = statsListHref(guildId, row.listQuery);
                    return (
                      <tr key={row.user.userId}>
                        <th scope="row">
                          {href ? (
                            <Link className="tk-stats-link" href={href} title={`Tickets ${row.user.name ?? "they"} worked`}>
                              <UserChip user={row.user} menuButton={false} />
                            </Link>
                          ) : (
                            <UserChip user={row.user} />
                          )}
                        </th>
                        <td>{row.claims}</td>
                        <td>{row.closes}</td>
                        <td className="tk-col-minor">{row.firstResponses ?? <span className="tk-muted">-</span>}</td>
                        <td>{row.medianFirstResponseMs === undefined ? <span className="tk-muted">-</span> : durationText(row.medianFirstResponseMs)}</td>
                        <td>
                          {!row.ratingCount ? (
                            <span className="tk-muted">None</span>
                          ) : (
                            `${averageText(row.averageRating ?? null)} (${row.ratingCount})`
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Busiest hours" desc="When tickets are opened, across the whole range.">
          <HourStrip byHour={s.byHour} noun="ticket" />
        </Card>
      </div>
    </div>
  );
}
