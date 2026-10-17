import Link from "next/link";
import type { MemberSummary, Page } from "@tier0/core";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BanIcon,
  ClockIcon,
  DoorIcon,
  NoteIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
  WarnTriangleIcon,
  XIcon,
} from "../../../../../components/Icons";
import { Avatar, Pager, PastEnd, displayName, isPastEnd } from "../../../../../components/mod/ModUi";
import { RelativeTime } from "../../../../../components/mod/RelativeTime";
import { fmtDateUtc } from "../../../../../components/mod/format";
import { ClickableRow, MemberSearchForm, SortSelect } from "./MemberControls";
import {
  MEMBER_FILTERS,
  MEMBER_SORTS,
  activityTotal,
  ariaSortFor,
  isNarrowed,
  memberListHref,
  memberProfileHref,
  sparkPoints,
  type MemberListQuery,
  type MemberSort,
} from "./params";

/** Presentational: everything arrives as props so it can be previewed with fixtures. */

const SPARK_W = 88;
const SPARK_H = 24;

function CountPills({ member }: { member: MemberSummary }) {
  const entries = [
    { action: "warn", count: member.warnCount, one: "warn", many: "warns", icon: <WarnTriangleIcon /> },
    { action: "timeout", count: member.timeoutCount, one: "timeout", many: "timeouts", icon: <ClockIcon /> },
    { action: "kick", count: member.kickCount, one: "kick", many: "kicks", icon: <DoorIcon /> },
    { action: "ban", count: member.banCount, one: "ban", many: "bans", icon: <BanIcon /> },
    // Automod's entries are on the record too and count toward "Last 14 days", so the column shows them.
    { action: "automod", count: member.automodCount ?? 0, one: "automod action", many: "automod actions", icon: <ShieldIcon /> },
  ].filter((entry) => entry.count > 0);
  const expired = member.expiredWarnCount ?? 0;
  const expiredNote =
    expired > 0 ? (
      <span className="members-expired" title={`${expired} ${expired === 1 ? "warning has" : "warnings have"} passed the warn expiry and no longer count`}>
        +{expired} expired
      </span>
    ) : null;
  if (entries.length === 0) return expiredNote ?? <span className="members-dash">None</span>;
  return (
    <span className="members-pills">
      {entries.map((entry) => {
        const label = `${entry.count} ${entry.count === 1 ? entry.one : entry.many}`;
        return (
          <span key={entry.action} className="mod-badge" data-action={entry.action}>
            {entry.icon}
            <span aria-hidden="true">{entry.count}</span>
            <span className="visually-hidden">{label}</span>
          </span>
        );
      })}
      {expiredNote}
    </span>
  );
}

function Trend({ values }: { values: number[] }) {
  const total = activityTotal(values);
  if (values.length < 2 || total === 0) return <span className="members-dash">Quiet</span>;
  const points = sparkPoints(values, SPARK_W, SPARK_H);
  const label = `${total} ${total === 1 ? "action" : "actions"} in the last ${values.length} days`;
  return (
    <span className="members-trend">
      <span className="mod-spark" aria-hidden="true">
        <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none">
          <polygon className="mod-spark-area" points={`2,${SPARK_H - 2} ${points} ${SPARK_W - 2},${SPARK_H - 2}`} />
          <polyline points={points} />
        </svg>
      </span>
      <span aria-hidden="true">{total}</span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

function SortHeader({
  guildId,
  query,
  column,
  label,
  numeric = false,
}: {
  guildId: string;
  query: MemberListQuery;
  column: MemberSort;
  label: string;
  numeric?: boolean;
}) {
  const state = ariaSortFor(query.sort, column);
  return (
    <th scope="col" role="columnheader" className={numeric ? "mod-num" : undefined} aria-sort={state}>
      <Link
        className="members-sort"
        href={memberListHref(guildId, { ...query, sort: column, page: 1 })}
        data-active={state !== "none" ? "true" : undefined}
      >
        {label}
        {state === "descending" ? <ArrowDownIcon /> : state === "ascending" ? <ArrowUpIcon /> : null}
      </Link>
    </th>
  );
}

export function MemberToolbar({ guildId, query, total }: { guildId: string; query: MemberListQuery; total: number }) {
  const current = MEMBER_FILTERS.find((entry) => entry.value === query.filter);
  return (
    <div className="members-controls">
      <MemberSearchForm className="mod-toolbar" action={memberListHref(guildId, {})}>
        <label className="mod-search">
          <SearchIcon />
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder="Filter members with a record"
            aria-label="Filter members with a record"
            autoComplete="off"
          />
        </label>
        {query.filter !== "all" ? <input type="hidden" name="filter" value={query.filter} /> : null}
        <SortSelect
          name="sort"
          defaultValue={query.sort}
          label="Sort members by"
          options={MEMBER_SORTS.map((entry) => ({ value: entry.value, label: entry.label }))}
        />
        <button type="submit" className="btn btn-secondary btn-sm">
          Search
        </button>
        <span className="mod-toolbar-spacer" />
        <span className="members-total" role="status">
          {total.toLocaleString()} {total === 1 ? "member" : "members"}
        </span>
      </MemberSearchForm>
      <nav className="mod-toolbar-group" aria-label="Filter by status">
        {MEMBER_FILTERS.map((entry) => {
          const active = entry.value === query.filter;
          return (
            <Link
              key={entry.value}
              className="mod-chip"
              href={memberListHref(guildId, { ...query, filter: entry.value, page: 1 })}
              aria-current={active ? "page" : undefined}
            >
              {entry.label}
              {active ? <span className="mod-chip-count">{total.toLocaleString()}</span> : null}
            </Link>
          );
        })}
      </nav>
      <div className="members-key">
        <p className="members-hint">{current?.hint}.</p>
        <ul className="members-legend" aria-label="Icon key">
          <li><WarnTriangleIcon /> Warn</li>
          <li><ClockIcon /> Timeout</li>
          <li><DoorIcon /> Kick</li>
          <li><BanIcon /> Ban</li>
          <li><ShieldIcon /> Automod</li>
          <li><NoteIcon /> Note</li>
        </ul>
      </div>
    </div>
  );
}

function EmptyState({ guildId, query }: { guildId: string; query: MemberListQuery }) {
  if (isNarrowed(query)) {
    return (
      <div className="mod-empty">
        <span className="mod-empty-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <p className="mod-empty-title">No members match this view</p>
        <p className="mod-empty-text">
          {query.q ? <>Nothing with a record matches &ldquo;{query.q}&rdquo;. </> : null}
          Only members with a warn, timeout, kick, ban or note appear here. Anyone else can be found with the
          search at the top of the page.
        </p>
        <div className="mod-empty-action">
          <Link className="btn btn-secondary btn-sm" href={memberListHref(guildId, { sort: query.sort })}>
            <XIcon /> Clear filters
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="mod-empty">
      <span className="mod-empty-icon" aria-hidden="true">
        <UserIcon />
      </span>
      <p className="mod-empty-title">No member has a record yet</p>
      <p className="mod-empty-text">
        A member appears here after a moderator warns, times out, kicks or bans them, or leaves a staff note on their
        profile. Use the search at the top of the page to open anyone&rsquo;s profile and add the first note.
      </p>
    </div>
  );
}

export function MemberList({
  guildId,
  data,
  query,
}: {
  guildId: string;
  data: Page<MemberSummary>;
  query: MemberListQuery;
}) {
  return (
    <section className="mod-section" aria-labelledby="members-heading">
      <h2 id="members-heading" className="visually-hidden">
        Members with a moderation record
      </h2>
      <MemberToolbar guildId={guildId} query={query} total={data.total} />
      <div className="mod-card members-card">
        {data.items.length === 0 && isPastEnd(data.page, data.pageSize, data.total) ? (
          <PastEnd total={data.total} pageSize={data.pageSize} noun="members" hrefFor={(page) => memberListHref(guildId, { ...query, page })} />
        ) : data.items.length === 0 ? (
          <EmptyState guildId={guildId} query={query} />
        ) : (
          <div className="mod-table-wrap members-wrap">
            <table role="table" className="mod-table mod-table--interactive members-table">
              <caption className="visually-hidden">Sorted by {MEMBER_SORTS.find((entry) => entry.value === query.sort)?.label.toLowerCase()}</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <SortHeader guildId={guildId} query={query} column="name" label="Member" />
                  <SortHeader guildId={guildId} query={query} column="most" label="Actions" />
                  <th scope="col" role="columnheader">Last 14 days</th>
                  <SortHeader guildId={guildId} query={query} column="notes" label="Notes" />
                  <SortHeader guildId={guildId} query={query} column="recent" label="Last action" />
                  <th scope="col" role="columnheader">Status</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {data.items.map((member) => {
                  const href = memberProfileHref(guildId, member.user.userId);
                  return (
                    <ClickableRow key={member.user.userId} href={href}>
                      <td role="cell" data-label="">
                        <Link className="mod-user members-user" href={href}>
                          <Avatar user={member.user} size="lg" />
                          <span className="mod-user-text">
                            <span className="mod-user-name">
                              {displayName(member.user)}
                              {!member.user.inServer && member.user.name !== null ? (
                                <span className="mod-user-left members-left">left</span>
                              ) : null}
                            </span>
                            <span className="mod-user-sub mod-id">ID …{member.user.userId.slice(-6)}</span>
                          </span>
                        </Link>
                      </td>
                      <td role="cell" data-label="Actions">
                        <CountPills member={member} />
                      </td>
                      <td role="cell" data-label="Last 14 days">
                        <Trend values={member.activity ?? []} />
                      </td>
                      <td role="cell" data-label="Notes" className="members-notes">
                        {member.noteCount > 0 ? (
                          <span className="members-note">
                            <NoteIcon />
                            {member.noteCount}
                            <span className="visually-hidden">{member.noteCount === 1 ? " note" : " notes"}</span>
                          </span>
                        ) : (
                          <span className="members-dash">None</span>
                        )}
                      </td>
                      <td role="cell" data-label="Last action">
                        {member.lastActionAt ? (
                          <span className="members-when">
                            <RelativeTime iso={member.lastActionAt} />
                            <span className="members-when-abs">{fmtDateUtc(member.lastActionAt)}</span>
                          </span>
                        ) : (
                          <span className="members-dash">No action yet</span>
                        )}
                      </td>
                      <td role="cell" data-label="Status">
                        {member.hasActive ? (
                          <span className="mod-pill" data-tone="warn">
                            Restricted
                          </span>
                        ) : (
                          // Plain text rather than a pill, which read like a "Clear" button.
                          <span className="members-dash">Not restricted</span>
                        )}
                      </td>
                    </ClickableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Pager
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        hrefFor={(page) => memberListHref(guildId, { ...query, page })}
      />
    </section>
  );
}

export function MemberListError({ guildId, message, query }: { guildId: string; message: string; query: MemberListQuery }) {
  return (
    <section className="mod-section" aria-labelledby="members-heading">
      <h2 id="members-heading" className="visually-hidden">
        Members with a moderation record
      </h2>
      <div className="mod-card">
        <div className="mod-empty" data-tone="danger" role="alert">
          <span className="mod-empty-icon" aria-hidden="true">
            <XIcon />
          </span>
          <p className="mod-empty-title">The member list could not be loaded</p>
          <p className="mod-empty-text">{message}</p>
          <div className="mod-empty-action">
            <Link className="btn btn-secondary btn-sm" href={memberListHref(guildId, query)}>
              Try again
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
