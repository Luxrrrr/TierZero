import Link from "next/link";
import type { AuditDto, Page, UserRef } from "@tier0/core";
import { Avatar, Pager, RoleBadge, UserChip, When } from "../../../../../components/mod/ModUi";
import { NoteIcon, PencilIcon, SearchIcon, TrashIcon, UndoIcon, UserIcon, HistoryIcon } from "../../../../../components/Icons";
import { ExpandableRow } from "./ExpandableRow";
import { SnapshotDiff } from "./SnapshotDiff";
import {
  AUDIT_KINDS,
  AUDIT_KIND_SHORT,
  auditHref,
  auditVisual,
  groupByDay,
  utcStamp,
  hasAuditFilters,
  type AuditIcon,
  type AuditQuery,
} from "./params";
import "./audit.css";

export interface ActorOption {
  userId: string;
  name: string | null;
  role: string;
}

interface Props {
  guildId: string;
  query: AuditQuery;
  data: Page<AuditDto>;
  /** Everyone who can be picked as the actor. */
  actors: ActorOption[];
  /** When the bot ignored the date or text filters, the rows were narrowed here and the total is for this page only. */
  narrowedHere: boolean;
}

function IconFor({ icon }: { icon: AuditIcon }) {
  switch (icon) {
    case "note":
      return <NoteIcon />;
    case "pencil":
      return <PencilIcon />;
    case "trash":
      return <TrashIcon />;
    case "undo":
      return <UndoIcon />;
    default:
      return <UserIcon />;
  }
}

export function AuditLog({ guildId, query, data, actors: known, narrowedHere }: Props) {
  const filtered = hasAuditFilters(query);
  const groups = groupByDay(data.items);
  const total = narrowedHere ? data.items.length : data.total;

  // An actor named in the URL who has since lost access still needs an option, or the select would read "Any".
  const actors = [...known];
  if (query.actorId && !actors.some((entry) => entry.userId === query.actorId)) {
    actors.push({ userId: query.actorId, name: null, role: "" });
  }

  return (
    <div className="mod-root mod-page audit-page">
      <section className="mod-section" aria-labelledby="audit-heading">
        <div className="mod-section-head">
          <div className="mod-section-text">
            <h2 className="mod-section-title" id="audit-heading">
              Audit trail
            </h2>
            <p className="mod-section-desc">Everything staff did in this dashboard, newest first.</p>
          </div>
        </div>

        <form className="mod-toolbar audit-toolbar" method="get" role="search" aria-label="Filter the audit trail">
          {query.kind ? <input type="hidden" name="kind" value={query.kind} /> : null}

          <div className="mod-search">
            <SearchIcon />
            <input
              name="q"
              type="search"
              defaultValue={query.q}
              placeholder="Search what happened"
              aria-label="Search the audit trail"
            />
          </div>

          <select name="actorId" className="mod-select audit-select" defaultValue={query.actorId} aria-label="Staff member">
            <option value="">Any staff member</option>
            {actors.map(({ userId, name, role }) => (
              <option key={userId} value={userId}>
                {name ?? `User ${userId.slice(-4)}`}
                {role ? ` (${role})` : ""}
              </option>
            ))}
          </select>

          <input
            name="targetUserId"
            className="audit-member"
            inputMode="numeric"
            pattern="[0-9]*"
            defaultValue={query.targetUserId}
            placeholder="Member ID"
            aria-label="Member ID"
          />

          <label className="audit-date">
            <span>From</span>
            <input type="date" name="since" defaultValue={query.since} max={query.until || undefined} />
          </label>
          <label className="audit-date">
            <span>To</span>
            <input type="date" name="until" defaultValue={query.until} min={query.since || undefined} />
          </label>

          <button type="submit" className="btn btn-secondary btn-sm">
            Apply
          </button>
        </form>

        <div className="mod-toolbar audit-chips">
          <div className="mod-toolbar-group" role="group" aria-label="Event type">
            <Link
              className="mod-chip"
              href={auditHref(guildId, { ...query, kind: "", page: 1 })}
              aria-current={query.kind === "" ? "true" : undefined}
            >
              All events
            </Link>
            {AUDIT_KINDS.map((kind) => {
              const visual = auditVisual(kind, null, null);
              const on = query.kind === kind;
              return (
                <Link
                  key={kind}
                  className="mod-chip"
                  href={auditHref(guildId, { ...query, kind: on ? "" : kind, page: 1 })}
                  aria-current={on ? "true" : undefined}
                >
                  <IconFor icon={visual.icon} />
                  {AUDIT_KIND_SHORT[kind]}
                </Link>
              );
            })}
          </div>
          {filtered ? (
            <Link className="btn btn-ghost btn-sm" href={auditHref(guildId, {})}>
              Clear filters
            </Link>
          ) : null}
        </div>

        <p className="audit-count" role="status">
          <strong>{total.toLocaleString()}</strong> {total === 1 ? "entry" : "entries"}
          {filtered ? " match these filters" : " in total"}
          {narrowedHere ? " on this page" : ""}
          <span className="audit-tz"> · Days and dates are in UTC</span>
        </p>

        {data.items.length === 0 ? (
          <div className="mod-card">
            <div className="mod-empty">
              <span className="mod-empty-icon">
                <HistoryIcon />
              </span>
              {filtered ? (
                <>
                  <p className="mod-empty-title">No entries match these filters</p>
                  <p className="mod-empty-text">Widen the date range or clear a filter to see more of the trail.</p>
                  <div className="mod-empty-action">
                    <Link className="btn btn-secondary btn-sm" href={auditHref(guildId, {})}>
                      Clear filters
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="mod-empty-title">Nothing has been recorded yet</p>
                  <p className="mod-empty-text">
                    Every action taken from this dashboard, every note added, edited or deleted, every action removed from
                    or restored to a record, and every change to who has access appears here, with who did it and when.
                  </p>
                </>
              )}
            </div>
            <PurgeNote />
          </div>
        ) : (
          <div className="mod-card">
            {groups.map((group) => (
              <div className="audit-day" key={group.key} role="group" aria-labelledby={`audit-day-${group.key}`}>
                <h3 className="audit-day-title" id={`audit-day-${group.key}`}>
                  {group.label}
                  <span className="audit-day-count">
                    {group.items.length} {group.items.length === 1 ? "entry" : "entries"}
                  </span>
                </h3>
                <ol className="audit-list">
                  {group.items.map((entry) => (
                    <AuditEntry key={entry.id} guildId={guildId} entry={entry} />
                  ))}
                </ol>
              </div>
            ))}
            <PurgeNote />
          </div>
        )}

        <Pager
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          hrefFor={(page) => auditHref(guildId, { ...query, page })}
        />
      </section>
    </div>
  );
}

/** The first thing an admin asks when a case is missing, so it is answered on the page itself. */
function PurgeNote() {
  return (
    <p className="mod-card-foot audit-purge-note">
      Removals by moderators and admins always appear here. When the owner purges an entry, it is deleted together
      with its history and nothing is recorded in this trail. That is intentional.
    </p>
  );
}

function AuditEntry({ guildId, entry }: { guildId: string; entry: AuditDto }) {
  const hasSnapshot = entry.before != null || entry.after != null;
  const visual = auditVisual(entry.kind, entry.before, entry.after);
  const actor: UserRef = { userId: entry.actor.userId, name: entry.actor.name, avatarUrl: null, inServer: true };

  const summary = (
    <>
      <span className="mod-actionicon audit-icon" data-action={visual.tone || undefined}>
        <IconFor icon={visual.icon} />
      </span>
      <div className="audit-main">
        <p className="audit-who">
          <Avatar user={actor} size={20} />
          <span className="audit-actor-name">{entry.actor.name}</span>
          <RoleBadge role={entry.actor.role} />
          <span className="audit-label">{entry.label.charAt(0).toLowerCase() + entry.label.slice(1)}</span>
        </p>
        {entry.summary ? <p className="audit-summary">{entry.summary}</p> : null}
      </div>
      <div className="audit-about">
        {entry.targetUser ? (
          <UserChip
            user={entry.targetUser}
            href={`/guilds/${guildId}/mod/members/${encodeURIComponent(entry.targetUser.userId)}`}
          />
        ) : (
          <span className="audit-none">Not about a member</span>
        )}
      </div>
      <span className="audit-time">
        <When iso={entry.at} />
      </span>
    </>
  );

  if (!hasSnapshot) {
    return (
      <li className="audit-entry">
        <div className="audit-entry-row">
          {summary}
          <span className="audit-toggle-gap" />
        </div>
      </li>
    );
  }

  return (
    <ExpandableRow
      summary={summary}
      label={`${entry.label} by ${entry.actor.name}, ${utcStamp(entry.at)}`}
      detail={<SnapshotDiff before={entry.before} after={entry.after} />}
    />
  );
}
