import { EvidenceList } from "../../../../../components/mod/Evidence";
import Link from "next/link";
import { Select } from "../../../../../components/form/Select";
import { LogSwitch } from "../../../../../components/mod/LogSwitch";
import type { InfractionDto, Page, UserRef } from "@tier0/core";
import {
  ActionBadge,
  Pager,
  Pill,
  RelativeTime,
  StateIcon,
  UserChip,
  actionLabel,
  displayName,
  isAutomodAction,
  moderatorOf,
  parseAutomodReason,
  ruleLabel,
} from "../../../../../components/mod/ModUi";
import { DownloadIcon, HistoryIcon, SearchIcon, UserIcon } from "../../../../../components/Icons";
import {
  ACTION_CHIPS,
  SOURCE_CHIPS,
  STATE_CHIPS,
  actionsExportHref,
  actionsHref,
  describeState,
  hasActionFilters,
  memberHref,
  moderatorOptions,
  type ActionsQuery,
} from "./params";
import "./actions.css";

interface Props {
  guildId: string;
  query: ActionsQuery;
  data: Page<InfractionDto>;
  /** Staff the moderator select can offer even when none of them is on this page. */
  staff: UserRef[];
  canExport: boolean;
}

export function ActionLog({ guildId, query, data, staff, canExport }: Props) {
  const moderators = moderatorOptions(
    staff,
    data.items.map(moderatorOf),
    query.moderatorId,
  );
  const filtered = hasActionFilters(query);
  const now = new Date();

  return (
    <div className="mod-root mod-page actions-page">
      <LogSwitch guildId={guildId} current="actions" canSeeStaffActivity={canExport} />
      <section className="mod-section" aria-labelledby="actions-heading">
        <div className="mod-section-head">
          <div className="mod-section-text">
            <h2 className="mod-section-title" id="actions-heading">
              Member actions
            </h2>
            <p className="mod-section-desc">Every warn, timeout, kick, ban and unban, newest first.</p>
          </div>
        </div>

        <form className="mod-toolbar actions-toolbar" method="get" role="search" aria-label="Filter actions">
          {query.action ? <input type="hidden" name="action" value={query.action} /> : null}
          {query.state !== "all" ? <input type="hidden" name="state" value={query.state} /> : null}
          {query.source !== "all" ? <input type="hidden" name="source" value={query.source} /> : null}

          <div className="mod-search">
            <SearchIcon />
            <input
              name="q"
              type="search"
              defaultValue={query.q}
              placeholder="Search reason, case number or member ID"
              aria-label="Search actions"
            />
          </div>

          <Select
            name="moderatorId"
            size="sm"
            className="actions-select"
            defaultValue={query.moderatorId}
            aria-label="Moderator"
            options={[
              { value: "", label: "All moderators" },
              ...moderators.map((user) => ({ value: user.userId, label: displayName(user) })),
            ]}
          />

          <button type="submit" className="btn btn-secondary btn-sm">
            Apply
          </button>

          <span className="mod-toolbar-spacer" />

          {canExport ? (
            <a
              className="btn btn-secondary btn-sm actions-export"
              href={actionsExportHref(guildId, query)}
              download
              title="Download everything matching the current filters, up to 5,000 rows"
            >
              <DownloadIcon />
              Export CSV
            </a>
          ) : null}
        </form>

        <div className="mod-toolbar actions-chips">
          <div className="mod-toolbar-group" role="group" aria-label="State">
            {STATE_CHIPS.map((chip) => (
              <Link
                key={chip.value}
                className="mod-chip"
                href={actionsHref(guildId, { ...query, state: chip.value, page: 1 })}
                aria-current={query.state === chip.value ? "true" : undefined}
              >
                {chip.label}
              </Link>
            ))}
          </div>

          <span className="actions-divider" aria-hidden="true" />

          <div className="mod-toolbar-group" role="group" aria-label="Source">
            {SOURCE_CHIPS.map((chip) => (
              <Link
                key={chip.value}
                className="mod-chip"
                href={actionsHref(guildId, { ...query, source: chip.value, page: 1 })}
                aria-current={query.source === chip.value ? "true" : undefined}
              >
                {chip.label}
              </Link>
            ))}
          </div>

          <span className="actions-divider" aria-hidden="true" />

          <div className="mod-toolbar-group" role="group" aria-label="Action type">
            {ACTION_CHIPS.map((action) => {
              const on = query.action === action;
              return (
                <Link
                  key={action}
                  className="mod-chip actions-type-chip"
                  data-action={action}
                  href={actionsHref(guildId, { ...query, action: on ? "" : action, page: 1 })}
                  aria-current={on ? "true" : undefined}
                  title={on ? `Showing ${actionLabel(action).toLowerCase()}s only. Select to show all types.` : undefined}
                >
                  <StateIcon action={action} />
                  {actionLabel(action)}
                </Link>
              );
            })}
          </div>

          {filtered ? (
            <Link className="btn btn-ghost btn-sm" href={actionsHref(guildId, {})}>
              Clear filters
            </Link>
          ) : null}
        </div>

        <p className="actions-count" role="status">
          <strong>{data.total.toLocaleString()}</strong> {data.total === 1 ? "action" : "actions"}
          {filtered ? " match these filters" : " in total"}
        </p>

        {data.items.length === 0 ? (
          <div className="mod-card">
            <div className="mod-empty">
              <span className="mod-empty-icon">
                <HistoryIcon />
              </span>
              {filtered ? (
                <>
                  <p className="mod-empty-title">No actions match these filters</p>
                  <p className="mod-empty-text">
                    Try a different search, or remove a filter to see more of the log.
                  </p>
                  <div className="mod-empty-action">
                    <Link className="btn btn-secondary btn-sm" href={actionsHref(guildId, {})}>
                      Clear filters
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="mod-empty-title">No moderation actions yet</p>
                  <p className="mod-empty-text">
                    Warns, timeouts, kicks, bans and unbans are listed here as soon as a moderator uses them, whether
                    through a command or in Discord itself.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="mod-card">
            <div className="mod-table-wrap actions-scroll">
              <table className="mod-table mod-table--sticky actions-table">
                <caption className="visually-hidden">Moderation actions, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col" className="mod-num">
                      Case
                    </th>
                    <th scope="col">Member</th>
                    <th scope="col">Action</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Moderator</th>
                    <th scope="col">When</th>
                    <th scope="col">State</th>
                    <th scope="col">
                      <span className="visually-hidden">Go to</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <ActionRow key={item.id} guildId={guildId} item={item} now={now} canSeeStaffActivity={canExport} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Pager
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          hrefFor={(page) => actionsHref(guildId, { ...query, page })}
        />
      </section>
    </div>
  );
}

function ActionRow({ guildId, item, now, canSeeStaffActivity }: { guildId: string; item: InfractionDto; now: Date; canSeeStaffActivity: boolean }) {
  const state = describeState(item, now);
  const removed = state.state === "removed";

  return (
    <tr data-voided={removed ? "true" : undefined}>
      <td className="mod-num actions-case" data-label="Case">
        #{item.caseNumber}
      </td>
      <td data-label="Member">
        <UserChip user={item.user} href={memberHref(guildId, item.user.userId)} />
      </td>
      <td data-label="Action">
        <ActionBadge action={item.action} voided={removed} />
      </td>
      <td data-label="Reason" className="actions-reason-cell">
        <Reason text={item.reason} automod={isAutomodAction(item.action)} />
        {item.edited ? (
          <span className="actions-edited" title={`A staff member changed this case after it was made: ${displayName(item.edited.by)}`}>
            Case edited by staff
          </span>
        ) : null}
        {item.evidence.length > 0 ? (
          <details className="ev-inline">
            <summary>
              {item.evidence.length} attached {item.evidence.length === 1 ? "message" : "messages"}
            </summary>
            <EvidenceList evidence={item.evidence} full />
          </details>
        ) : null}
      </td>
      <td data-label="Moderator">
        <UserChip user={moderatorOf(item)} muted />
      </td>
      <td data-label="When" className="actions-when">
        <RelativeTime iso={item.createdAt} />
      </td>
      <td data-label="State">
        <Pill tone={state.tone}>{state.label}</Pill>
        {removed ? <span className="actions-state-detail">{state.detail}</span> : null}
      </td>
      <td data-label="Go to" className="actions-go">
        <Link className="btn btn-ghost btn-sm" href={memberHref(guildId, item.user.userId)}>
          <UserIcon />
          Profile
        </Link>
        {canSeeStaffActivity ? (
          <Link className="btn btn-ghost btn-sm" href={`/guilds/${guildId}/mod/audit?infractionId=${item.id}`}>
            <HistoryIcon />
            Staff activity
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

/** Past about two lines the text is clamped, so it opens in place: a title attribute would leave keyboard and touch users out. */
const LONG_REASON = 90;

function Reason({ text, automod }: { text: string | null; automod: boolean }) {
  const parsed = automod ? parseAutomodReason(text) : null;
  const shown = parsed ? parsed.detail : text;
  const tag = parsed?.rule ? (
    <span className="actions-rule" title="The automod rule that acted">
      <span className="visually-hidden">Rule: </span>
      {ruleLabel(parsed.rule)}
    </span>
  ) : null;

  if (!shown) {
    return tag ? <span className="actions-reason-row">{tag}</span> : <span className="actions-none">No reason given</span>;
  }
  if (shown.length <= LONG_REASON) {
    return (
      <span className="actions-reason-row">
        {tag}
        <span className="actions-reason">{shown}</span>
      </span>
    );
  }
  return (
    <details className="actions-more">
      <summary>
        <span className="actions-reason-row">
          {tag}
          <span className="actions-reason">{shown}</span>
        </span>
        <span className="actions-more-hint">
          <span className="actions-more-open">Show full reason</span>
          <span className="actions-more-close">Show less</span>
        </span>
      </summary>
    </details>
  );
}
