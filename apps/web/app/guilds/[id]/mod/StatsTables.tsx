import Link from "next/link";
import type { InfractionDto, StatsDto } from "@tier0/core";
import { ActionBadge, UserChip, actionLabel, displayName, fmtDateTime, timeAgo } from "../../../../components/mod/ModUi";
import {
  actionBars,
  actionVerb,
  formatPercent,
  mixSummary,
  moderatorLogHref,
  moderatorMix,
  sharePercent,
  type RuleBar,
} from "./stats-logic";

type Moderator = StatsDto["moderators"][number];
type TopMember = StatsDto["topMembers"][number];

const count = (value: number) => value.toLocaleString("en");

function Ago({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={fmtDateTime(iso)}>
      {timeAgo(iso)}
    </time>
  );
}

export function ActionBreakdown({ byAction }: { byAction: { action: string; count: number }[] }) {
  const bars = actionBars(byAction);
  if (bars.length === 0) return <p className="stats-muted">No actions in this range.</p>;

  return (
    <ul className="stats-types">
      {bars.map((bar) => (
        <li key={bar.action} className="stats-type" data-action={bar.action}>
          <span className="stats-type-name">
            <i className="mod-dot" data-action={bar.action} aria-hidden="true" />
            {actionLabel(bar.action)}
          </span>
          <span className="stats-type-bar" aria-hidden="true">
            <span style={{ width: `${bar.percent}%` }} />
          </span>
          <span className="stats-type-value">
            <strong>{count(bar.count)}</strong>
            <span>{formatPercent(bar.share * 100)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The rules that fired most, as text first: the bar is decoration and the name and count carry the meaning. */
export function RuleBars({ bars, summary }: { bars: RuleBar[]; summary: string }) {
  if (bars.length === 0) return null;
  return (
    <div className="stats-rules-wrap">
      <p className="visually-hidden" id="stats-rules-summary">
        {summary}
      </p>
      <ul className="stats-types stats-rules" aria-label="Automod actions by rule" aria-describedby="stats-rules-summary">
        {bars.map((bar) => (
          <li key={bar.rule} className="stats-type">
            <span className="stats-type-name">{bar.label}</span>
            <span className="stats-type-bar" aria-hidden="true">
              <span style={{ width: `${bar.percent}%` }} />
            </span>
            <span className="stats-type-value">
              <strong>{count(bar.count)}</strong>
              <span>{formatPercent(bar.share * 100)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModeratorLeaderboard({
  guildId,
  moderators,
  totalActions,
}: {
  guildId: string;
  moderators: Moderator[];
  totalActions: number;
}) {
  if (moderators.length === 0) return <p className="stats-muted stats-pad">No moderator has acted in this range.</p>;
  const top = Math.max(...moderators.map((moderator) => moderator.total));

  return (
    <div className="mod-table-wrap">
      <table className="mod-table stats-mods">
        <thead>
          <tr>
            <th scope="col">Moderator</th>
            <th scope="col" className="mod-num">
              Actions
            </th>
            <th scope="col">Share and mix</th>
            <th scope="col" className="mod-num">
              Notes
            </th>
            <th scope="col" className="mod-num">
              Removed<span className="visually-hidden"> (their actions later taken off a record)</span>
            </th>
            <th scope="col">Last active</th>
          </tr>
        </thead>
        <tbody>
          {moderators.map((moderator) => {
            const share = sharePercent(moderator.total, totalActions);
            const mix = moderatorMix(moderator);
            return (
              <tr key={moderator.user.userId}>
                <td data-label="">
                  <div className="stats-mod">
                    <UserChip user={moderator.user} href={moderatorLogHref(guildId, moderator.user.userId)} />
                    <span className="stats-sub">
                      {mix.length > 0 ? mixSummary(moderator) : "No actions in this range"}
                    </span>
                  </div>
                </td>
                <td className="mod-num stats-strong" data-label="Actions">
                  {count(moderator.total)}
                </td>
                <td data-label="Share">
                  <div className="stats-share">
                    <div
                      className="stats-mix"
                      role="img"
                      aria-label={`${formatPercent(share)} of all actions: ${mixSummary(moderator) || "none"}`}
                    >
                      <div className="stats-mix-fill" style={{ width: `${sharePercent(moderator.total, top)}%` }}>
                        {mix.map((segment) => (
                          <span
                            key={segment.series}
                            data-series={segment.series}
                            style={{ flexGrow: segment.count }}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="stats-share-value">{formatPercent(share)}</span>
                  </div>
                </td>
                <td className={`mod-num${moderator.notes === 0 ? " mod-muted" : ""}`} data-label="Notes">
                  {count(moderator.notes)}
                </td>
                <td className={`mod-num${moderator.voided === 0 ? " mod-muted" : ""}`} data-label="Removed">
                  {count(moderator.voided)}
                </td>
                <td className="mod-muted" data-label="Last active">
                  {moderator.lastActionAt ? <Ago iso={moderator.lastActionAt} /> : "Never"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TopMembers({ guildId, members }: { guildId: string; members: TopMember[] }) {
  if (members.length === 0) return <p className="stats-muted stats-pad">No member has been actioned in this range.</p>;
  const largest = Math.max(...members.map((member) => member.count));

  return (
    <ol className="stats-rank">
      {members.map((member, index) => (
        <li key={member.user.userId}>
          <span className="stats-rank-n" aria-hidden="true">
            {index + 1}
          </span>
          <UserChip user={member.user} href={`/guilds/${guildId}/mod/members/${encodeURIComponent(member.user.userId)}`} />
          <span className="stats-rank-bar" aria-hidden="true">
            <span style={{ width: `${sharePercent(member.count, largest)}%` }} />
          </span>
          <span className="stats-rank-count">
            <strong>{count(member.count)}</strong> {member.count === 1 ? "action" : "actions"}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RecentFeed({ guildId, items }: { guildId: string; items: InfractionDto[] }) {
  if (items.length === 0) return <p className="stats-muted stats-pad">No actions have been recorded yet.</p>;

  return (
    <ul className="stats-feed">
      {items.map((item) => (
        <li key={item.id} data-voided={item.voided ? "true" : undefined}>
          <ActionBadge action={item.action} voided={item.voided !== null} />
          <div className="stats-feed-text">
            <p>
              <strong>{displayName(item.moderator)}</strong> {actionVerb(item.action)}{" "}
              <Link href={`/guilds/${guildId}/mod/members/${encodeURIComponent(item.user.userId)}`}>
                {displayName(item.user)}
              </Link>
              {item.voided ? <span className="mod-pill stats-feed-pill" data-tone="removed">Removed</span> : null}
            </p>
            {item.reason ? <p className="stats-sub">{item.reason}</p> : null}
          </div>
          <span className="stats-feed-time">
            <Ago iso={item.createdAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}
