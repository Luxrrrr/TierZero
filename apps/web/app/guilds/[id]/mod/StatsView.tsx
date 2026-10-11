import Link from "next/link";
import type { InfractionDto, StatsDto } from "@tier0/core";
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  InfoIcon,
  ShieldIcon,
  WarnTriangleIcon,
} from "../../../../components/Icons";
import { DayChart, HourStrip } from "./StatsCharts";
import { ruleLabel } from "../../../../components/mod/automod";
import { ActionBreakdown, ModeratorLeaderboard, RecentFeed, RuleBars, TopMembers } from "./StatsTables";
import {
  METRIC_POLARITY,
  RANGES,
  automodLogHref,
  automodView,
  changeBetween,
  changeSentence,
  isQuiet,
  longerRange,
  metricValue,
  periodText,
  plural,
  repeatPercent,
  repeatRateText,
  sparkPaths,
  sparkValues,
  type Change,
  type DayCounts,
  type MetricKey,
  type Range,
} from "./stats-logic";

/**
 * Presentational pieces of the mod overview. They take data as props and know
 * nothing about fetching, so they can be rendered from fixtures.
 */

export function StatsToolbar({
  guildId,
  days,
  period,
  compare = false,
}: {
  guildId: string;
  days: Range | number;
  period?: string | null;
  compare?: boolean;
}) {
  return (
    <div className="mod-toolbar stats-toolbar">
      <p className="stats-period">
        <ClockIcon />
        <span>
          <strong>{period ?? `Last ${days} days`}</strong>
          <span className="stats-period-note">
            {compare ? ` · UTC · changes compare with the ${days} days before` : " · UTC"}
          </span>
        </span>
      </p>
      <span className="mod-toolbar-spacer" />
      <nav className="stats-seg" aria-label="Time range">
        {RANGES.map((range) => (
          <Link
            key={range}
            href={`/guilds/${guildId}/mod?days=${range}`}
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

export function StatsUnavailable({ message }: { message: string }) {
  return (
    <div className="callout callout-error" role="alert">
      <AlertIcon />
      <div>
        <strong>Statistics could not be loaded.</strong> {message}
      </div>
    </div>
  );
}

function Spark({ values, action }: { values: number[]; action?: string }) {
  const paths = sparkPaths(values, 88, 24);
  if (!paths) return null;
  return (
    <span className="mod-spark" data-action={action} aria-hidden="true">
      <svg viewBox="0 0 88 24" preserveAspectRatio="none">
        <path className="mod-spark-area" d={paths.area} />
        <path d={paths.line} />
      </svg>
    </span>
  );
}

interface KpiSpec {
  key: MetricKey;
  label: string;
  dots?: string[];
  action?: string;
}

const KPIS: KpiSpec[] = [
  { key: "actions", label: "Actions" },
  { key: "warns", label: "Warns", dots: ["warn"], action: "warn" },
  { key: "timeouts", label: "Timeouts", dots: ["timeout"], action: "timeout" },
  { key: "kicksBans", label: "Kicks and bans", dots: ["kick", "ban"], action: "ban" },
  { key: "voided", label: "Removed from record" },
  { key: "notes", label: "Notes", dots: ["note"] },
];

function Delta({ change, sentence }: { change: Change; sentence: string | null }) {
  return (
    <span
      className="mod-kpi-delta"
      data-trend={change.trend}
      data-good={change.verdict === "neutral" ? undefined : String(change.verdict === "good")}
    >
      {change.trend === "up" ? <ArrowUpIcon /> : change.trend === "down" ? <ArrowDownIcon /> : null}
      <span aria-hidden="true">{change.label}</span>
      {change.verdict === "good" ? <CheckIcon className="stats-verdict" /> : null}
      {change.verdict === "bad" ? <WarnTriangleIcon className="stats-verdict" /> : null}
      <span className="visually-hidden">{sentence}</span>
    </span>
  );
}

function Kpi({ spec, stats }: { spec: KpiSpec; stats: StatsDto }) {
  const value = metricValue(stats.totals, spec.key);
  const previous = stats.previous ? metricValue(stats.previous, spec.key) : null;
  const change = changeBetween(value, previous, METRIC_POLARITY[spec.key]);
  const series = sparkValues(stats.perDay as DayCounts[], spec.key);
  const sentence = change && previous !== null ? changeSentence(change, previous, stats.days) : null;

  return (
    <div className="mod-kpi">
      <div className="mod-kpi-label">
        {spec.dots?.map((dot) => <i key={dot} className="mod-dot" data-action={dot} aria-hidden="true" />)}
        {spec.label}
      </div>
      <div className="mod-kpi-value">{value.toLocaleString("en")}</div>
      <div className="mod-kpi-foot">
        {change ? <Delta change={change} sentence={sentence} /> : <span />}
        {series ? <Spark values={series} action={spec.action} /> : null}
      </div>
    </div>
  );
}

function Card({
  title,
  desc,
  children,
  flush = false,
  foot,
  className,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  flush?: boolean;
  foot?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mod-card${className ? ` ${className}` : ""}`}>
      <div className="mod-card-head">
        <div>
          <h2 className="mod-card-title">{title}</h2>
          {desc ? <p className="mod-card-desc">{desc}</p> : null}
        </div>
      </div>
      <div className={`mod-card-body${flush ? " mod-card-body--flush" : ""}`}>{children}</div>
      {foot ? <div className="mod-card-foot">{foot}</div> : null}
    </section>
  );
}

function RightNow({ stats }: { stats: StatsDto }) {
  return (
    <Card title="Right now" desc="Not limited to the range above.">
      <dl className="stats-now">
        <div>
          <dt>In force</dt>
          <dd>{stats.totals.activeNow.toLocaleString("en")}</dd>
          <dd className="stats-now-hint">Timeouts and bans still active</dd>
        </div>
        <div>
          <dt>On record</dt>
          <dd>{stats.totals.membersWithRecord.toLocaleString("en")}</dd>
          <dd className="stats-now-hint">Members with any entry, all time</dd>
        </div>
      </dl>
    </Card>
  );
}

/**
 * What automod did, taken from the same action log as everything else. Left
 * out when the bot sent no automod figures, so an older bot does not make the
 * page claim that automod did nothing.
 */
function AutomodCard({ guildId, stats, canConfigure }: { guildId: string; stats: StatsDto; canConfigure: boolean }) {
  const view = automodView(stats.automod, ruleLabel, stats.days);
  if (!view) return null;
  const sentence = view.change && view.previous !== null ? changeSentence(view.change, view.previous, stats.days) : null;

  if (view.total === 0) {
    return (
      <Card title="Automod">
        <div className="stats-automod-empty">
          <ShieldIcon />
          <div>
            <p className="stats-repeat-head">Automod did not act in this period</p>
            <p className="stats-sub">
              {canConfigure
                ? "Nothing was warned, timed out or deleted. Its rules are configured under the Settings tab."
                : "Nothing was warned, timed out or deleted."}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Automod"
      desc="Warns, timeouts and deleted messages from automod rules, also counted in the totals above."
      foot={<Link href={automodLogHref(guildId)}>See automod actions</Link>}
    >
      <div className="stats-automod">
        <div className="stats-automod-fig">
          <div className="mod-kpi-value">{view.total.toLocaleString("en")}</div>
          <div className="stats-sub">{view.total === 1 ? "hit" : "hits"} in {plural(stats.days, "day")}</div>
          {view.change ? <Delta change={view.change} sentence={sentence} /> : null}
        </div>
        <RuleBars bars={view.bars} summary={view.summary} />
      </div>
    </Card>
  );
}

function RepeatCard({ share }: { share: number | null }) {
  const repeat = repeatRateText(share);
  const percent = repeatPercent(share);
  return (
    <Card title="Repeat actions">
      <div className="stats-repeat">
        {percent !== null ? (
          <div className="stats-repeat-fig" aria-hidden="true">
            {percent}%
          </div>
        ) : (
          <InfoIcon />
        )}
        <div>
          <p className="stats-repeat-head">{repeat.headline}</p>
          <p className="stats-sub">{repeat.detail}</p>
        </div>
      </div>
    </Card>
  );
}

export function ModStatsView({
  guildId,
  stats,
  recent,
  canConfigure = false,
}: {
  guildId: string;
  stats: StatsDto;
  recent: InfractionDto[] | null;
  /** Whether the viewer can open the Settings tab, which is where the empty automod card points. */
  canConfigure?: boolean;
}) {
  const { totals } = stats;
  const quiet = isQuiet(totals);
  const next = longerRange(stats.days);

  return (
    <div className="mod-page stats-page">
      <StatsToolbar
        guildId={guildId}
        days={stats.days}
        period={periodText(stats.perDay as DayCounts[])}
        compare={stats.previous !== null}
      />

      {quiet ? (
        <>
          <section className="mod-card">
            <div className="mod-empty">
              <span className="mod-empty-icon">
                <ClockIcon />
              </span>
              <h2 className="mod-empty-title">A quiet {stats.days} days</h2>
              <p className="mod-empty-text">
                No warns, timeouts, kicks, bans or notes were recorded in this range.
                {next ? " A longer range may show more." : " Activity will appear here as moderators act."}
              </p>
              {next ? (
                <div className="mod-empty-action">
                  <Link className="btn btn-secondary btn-sm" href={`/guilds/${guildId}/mod?days=${next}`}>
                    Show {next} days
                  </Link>
                </div>
              ) : null}
            </div>
          </section>
          <div className="stats-row stats-row--pair">
            <RightNow stats={stats} />
            {recent ? (
              <Card title="Recent activity" flush>
                <RecentFeed guildId={guildId} items={recent} />
              </Card>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <h2 className="visually-hidden">Totals for the last {stats.days} days</h2>
          <section className="stats-kpis" aria-label="Totals for the range">
            {KPIS.map((spec) => (
              <Kpi key={spec.key} spec={spec} stats={stats} />
            ))}
          </section>

          <div className="stats-row stats-row--chart">
            <Card
              title="Actions per day"
              desc={`${plural(totals.actions, "action")} over ${plural(stats.perDay.length, "day")}. Hover or use the arrow keys to read a day.`}
            >
              <DayChart perDay={stats.perDay as DayCounts[]} />
            </Card>
            <div className="stats-stack">
              <Card title="By type">
                <ActionBreakdown byAction={stats.byAction} />
              </Card>
              <RightNow stats={stats} />
            </div>
          </div>

          <AutomodCard guildId={guildId} stats={stats} canConfigure={canConfigure} />

          <Card title="Moderators" desc="Who did what. Select a name to open their actions. Removed counts their actions later taken off a record." flush>
            <ModeratorLeaderboard guildId={guildId} moderators={stats.moderators} totalActions={totals.actions} />
          </Card>

          <div className="stats-row stats-row--pair">
            <Card title="Most actioned members" desc="Select a name to open the profile." flush>
              <TopMembers guildId={guildId} members={stats.topMembers} />
            </Card>
            {recent ? (
              <Card
                title="Recent activity"
                flush
                foot={<Link href={`/guilds/${guildId}/mod/actions`}>View all actions</Link>}
              >
                <RecentFeed guildId={guildId} items={recent} />
              </Card>
            ) : null}
          </div>

          <div className="stats-row stats-row--pair">
            <Card title="Busiest hours" desc="When actions are taken, across the whole range.">
              <HourStrip byHour={stats.byHour} />
            </Card>
            <RepeatCard share={stats.repeatRate} />
          </div>
        </>
      )}
    </div>
  );
}
