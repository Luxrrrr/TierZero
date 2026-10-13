"use client";

import Link from "next/link";
import { forwardRef, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MemberProfile, StaffRole, UserRef } from "@tier0/core";
import { Avatar, StateIcon, displayName, timeAgo } from "../../../../../../components/mod/ModUi";
import { CheckIcon, ChevronRightIcon, NoteIcon, PlusIcon } from "../../../../../../components/Icons";
import { AuditRow, InfractionRow, NOTE_LIMIT, NoteRow } from "./TimelineRows";
import { canAddNote, seesAudit, seesQuickFacts } from "./permissions";
import {
  activitySeries,
  applyPending,
  buildTimeline,
  filterShowing,
  findFocusItem,
  focusDomId,
  focusLabel,
  focusRequest,
  parseCaseHash,
  parseNoteHash,
  type FocusRequest,
  countByFilter,
  filterTimeline,
  formatDate,
  formatDateTime,
  groupByDay,
  pendingKey,
  quickFacts,
  recordCounts,
  sparkPoints,
  standingOf,
  RECENT_DAYS,
  TREND_DAYS,
  type PendingOp,
  type Standing,
  type TimelineFilter,
  type TimelineItem,
} from "./timeline";
import { useModAction, type ModCall, type ModResult, type Run } from "./useModAction";
import { isComposerShortcut } from "./a11y";
import { TakeAction } from "./TakeAction";
import { CharacterCount } from "./CharacterCount";
import "../../../../../mod.css";
import "./profile.css";

interface Props {
  guildId: string;
  profile: MemberProfile;
  /** The viewer's staff level in this server. */
  role: StaffRole;
  /** The viewer's Discord id, to tell their own notes from other people's. */
  viewerId: string;
  /** The viewer's display name, for entries shown before the server confirms them. */
  viewerName: string;
  /**
   * The server's clock when it rendered the page. The first client render uses
   * it too, so relative times and the standing match the server's HTML exactly.
   * Without it the first render uses the local clock and may differ by a tick.
   */
  renderedAt?: string;
  /** Whether the viewer can open the server's settings, for the link shown when Moderation is off. */
  canConfigure?: boolean;
  /** A case number from `?case=`, to open and scroll to. */
  focusCase?: number | null;
  /** A note id from `?note=`, opened the same way. */
  focusNote?: number | null;
}

const FILTERS: { id: TimelineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "actions", label: "Actions" },
  { id: "notes", label: "Notes" },
  { id: "staff", label: "Staff activity" },
];

const EMPTY_FILTER_TEXT: Record<TimelineFilter, string> = {
  all: "Nothing here yet.",
  actions: "No warns, timeouts, kicks or bans on this record.",
  notes: "No notes on this record yet.",
  staff: "No staff changes to this record.",
};

interface Tracked {
  id: number;
  op: PendingOp;
  /** The profile that was showing when the server confirmed; the next one replaces the guess. */
  settledOn: MemberProfile | null;
}

/** A confirmed change whose refresh never arrives is dropped after this long rather than shown forever. */
const SETTLED_TIMEOUT_MS = 10_000;

export function ProfileView({ guildId, profile, role, viewerId, viewerName, renderedAt, canConfigure = false, focusCase = null, focusNote = null }: Props) {
  const send = useModAction(guildId);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  // A linked case starts open, so the first paint already matches what the
  // scroll effect below lands on and the page does not jump afterwards.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const target = findFocusItem(buildTimeline(profile, seesAudit(role)), focusRequest(focusCase, focusNote));
    return new Set(target ? [target.key] : []);
  });
  const [spotlight, setSpotlight] = useState<{ key: string; request: FocusRequest } | null>(null);
  const [missing, setMissing] = useState<FocusRequest | null>(null);
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const [now, setNow] = useState(() => (renderedAt ? new Date(renderedAt) : new Date()));
  // The server renders in UTC; the browser switches to its own zone once mounted,
  // so the first paint matches the server's and hydration stays clean.
  const [timeZone, setTimeZone] = useState("UTC");
  const composer = useRef<HTMLTextAreaElement>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const nextTemp = useRef(-1);

  const audit = seesAudit(role);
  const viewer: UserRef = useMemo(
    () => ({ userId: viewerId, name: viewerName, avatarUrl: null, inServer: true }),
    [viewerId, viewerName],
  );

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setTracked((current) => current.filter((entry) => entry.settledOn === null || entry.settledOn === profile));
  }, [profile]);

  const run: Run = useCallback(
    async (call: ModCall, op: PendingOp | null, when: "now" | "after" = "now") => {
      const id = Math.random();
      if (op && when === "now") setTracked((current) => [...current, { id, op, settledOn: null }]);
      const result = await send(call);
      if (!op) return result;
      if (result !== true) {
        setTracked((current) => current.filter((entry) => entry.id !== id));
        return result;
      }
      const settledOn = profileRef.current;
      setTracked((current) =>
        when === "now"
          ? current.map((entry) => (entry.id === id ? { ...entry, settledOn } : entry))
          : [...current, { id, op, settledOn }],
      );
      setTimeout(() => setTracked((current) => current.filter((entry) => entry.id !== id)), SETTLED_TIMEOUT_MS);
      return result;
    },
    [send],
  );

  const shown = useMemo(() => applyPending(profile, tracked.map((entry) => entry.op)), [profile, tracked]);
  const pendingKeys = useMemo(() => new Set(tracked.map((entry) => pendingKey(entry.op))), [tracked]);

  const all = useMemo(() => buildTimeline(shown, audit), [shown, audit]);
  const counts = useMemo(() => countByFilter(all), [all]);
  const visible = useMemo(() => filterTimeline(all, filter), [all, filter]);
  const groups = useMemo(() => groupByDay(visible, now, timeZone), [visible, now, timeZone]);
  const filters = audit ? FILTERS : FILTERS.filter((entry) => entry.id !== "staff");

  const allRef = useRef(all);
  allRef.current = all;

  // Runs when the link changes, not on every edit to the record, so a refresh
  // after saving a note does not pull the page back to the linked case.
  useEffect(() => {
    const hash = window.location.hash;
    const request = focusRequest(focusCase ?? parseCaseHash(hash), focusNote ?? (focusCase === null ? parseNoteHash(hash) : null));
    if (!request) return;
    const target = findFocusItem(allRef.current, request);
    if (!target) {
      setMissing(request);
      return;
    }
    setMissing(null);
    setFilter((current) => filterShowing(allRef.current, current, target));
    setExpanded((current) => (current.has(target.key) ? current : new Set(current).add(target.key)));
    setSpotlight({ key: target.key, request });
  }, [focusCase, focusNote]);

  useEffect(() => {
    if (!spotlight) return;
    const row = document.getElementById(focusDomId(spotlight.request));
    if (row) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      row.querySelector<HTMLElement>(".pf-toggle")?.focus({ preventScroll: true });
    }
    const timer = setTimeout(() => setSpotlight(null), 4000);
    return () => clearTimeout(timer);
  }, [spotlight]);

  const focusComposer = useCallback(() => {
    const node = composer.current;
    if (!node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!canAddNote(role)) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!isComposerShortcut(event) || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      focusComposer();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [role, focusComposer]);

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allOpen = visible.length > 0 && visible.every((item) => expanded.has(item.key));

  async function addNote(content: string): Promise<ModResult> {
    const tempId = nextTemp.current;
    nextTemp.current -= 1;
    setFilter((current) => (current === "actions" || current === "staff" ? "all" : current));
    return run(
      {
        method: "POST",
        path: `members/${encodeURIComponent(profile.user.userId)}/notes`,
        body: { content },
        success: "Note added.",
        failure: "Could not add the note",
      },
      { type: "note.add", tempId, content, author: viewer, at: new Date().toISOString() },
    );
  }

  function renderItem(item: TimelineItem) {
    const frame = { expanded: expanded.has(item.key), onToggle: () => toggle(item.key), pending: pendingKeys.has(item.key) };
    if (item.kind === "infraction") {
      return (
        <InfractionRow
          key={item.key}
          {...frame}
          spotlight={spotlight?.key === item.key}
          guildId={guildId}
          infraction={item.infraction}
          role={role}
          viewer={viewer}
          audit={shown.audit}
          showHistory={audit}
          run={run}
          now={now}
          timeZone={timeZone}
        />
      );
    }
    if (item.kind === "note") {
      return (
        <NoteRow
          key={item.key}
          {...frame}
          spotlight={spotlight?.key === item.key}
          note={item.note}
          role={role}
          viewer={viewer}
          audit={shown.audit}
          showHistory={audit}
          run={run}
          now={now}
          timeZone={timeZone}
        />
      );
    }
    return <AuditRow key={item.key} entry={item.audit} now={now} timeZone={timeZone} expanded={frame.expanded} onToggle={frame.onToggle} />;
  }

  const name = displayName(shown.user);

  return (
    <div className="mod-root pf">
      <nav className="pf-crumbs" aria-label="Breadcrumb">
        <Link href={`/guilds/${guildId}/mod/members`}>Members</Link>
        <ChevronRightIcon className="pf-crumb-sep" />
        <span aria-current="page">{name}</span>
      </nav>

      <ProfileHeader
        profile={shown}
        now={now}
        timeZone={timeZone}
        action={
          <TakeAction
            guildId={guildId}
            profile={shown}
            name={name}
            role={role}
            now={now}
            timeZone={timeZone}
            canConfigure={canConfigure}
            // A new action lands in the timeline, so a filter that would hide it is lifted.
            onActed={() => setFilter((current) => (current === "notes" || current === "staff" ? "all" : current))}
          />
        }
      />

      <div className="pf-grid">
        <aside className="pf-side" aria-label="Add a note and record summary">
          {canAddNote(role) ? <NoteComposer ref={composer} onSubmit={addNote} /> : null}
          <RecordCard profile={shown} />
          {seesQuickFacts(role) ? <FactsCard profile={shown} timeZone={timeZone} /> : null}
        </aside>

        <section className="pf-main" aria-labelledby="pf-timeline-title">
          <h2 className="pf-main-title" id="pf-timeline-title" tabIndex={-1}>
            Timeline
          </h2>
          {missing !== null ? (
            <p className="pf-case-notice" role="status">
              <span>{focusLabel(missing)} isn&apos;t on this member&apos;s record, or you can&apos;t see it.</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMissing(null)}>
                Dismiss
              </button>
            </p>
          ) : null}
          <p className="pf-sr" role="status">
            {spotlight ? `${focusLabel(spotlight.request)} is open in the timeline.` : ""}
          </p>
          <div className="pf-toolbar">
            <div className="mod-toolbar-group pf-filters" role="group" aria-label="Show in the timeline">
              {filters.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="mod-chip"
                  aria-pressed={filter === entry.id}
                  onClick={() => setFilter(entry.id)}
                >
                  {entry.label}
                  <span className="mod-chip-count">{counts[entry.id]}</span>
                </button>
              ))}
            </div>
            {visible.length > 0 ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm pf-expand-all"
                onClick={() => setExpanded(allOpen ? new Set() : new Set(visible.map((item) => item.key)))}
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            ) : null}
          </div>

          {all.length === 0 ? (
            <div className="mod-card pf-empty-card">
              <div className="mod-empty">
                <span className="mod-empty-icon">
                  <NoteIcon />
                </span>
                <p className="mod-empty-title">No record yet</p>
                <p className="mod-empty-text">
                  Nothing has been logged for {name}. Warns, timeouts, kicks, bans and staff notes will appear here as
                  they happen.
                </p>
                {canAddNote(role) ? (
                  <div className="mod-empty-action">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={focusComposer}>
                      <PlusIcon />
                      Add the first note
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="mod-card">
              <div className="mod-empty mod-empty--compact">
                <p className="mod-empty-text">{EMPTY_FILTER_TEXT[filter]}</p>
                <div className="mod-empty-action">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter("all")}>
                    Show everything
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="pf-timeline">
              {groups.map((group) => (
                <div key={group.key} className="pf-day" role="group" aria-labelledby={`pf-day-${group.key}`}>
                  <h3 className="pf-day-title" id={`pf-day-${group.key}`}>
                    <span>{group.label}</span>
                    <span className="pf-day-count">
                      {group.items.length} {group.items.length === 1 ? "entry" : "entries"}
                    </span>
                  </h3>
                  <ol className="pf-events">{group.items.map(renderItem)}</ol>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* Header -------------------------------------------------------------------- */

function standingText(standing: Standing, hasRecord: boolean, now: Date, timeZone: string): { tone: string; label: string; detail: string } {
  if (standing.kind === "restricted") {
    const label = standing.action === "ban" ? "Banned" : standing.action === "timeout" ? "Timed out" : "Restricted";
    const caseText = standing.caseNumber !== null ? `Case #${standing.caseNumber}, ` : "";
    const detail = standing.until ? `${caseText}until ${formatDateTime(standing.until, timeZone)}` : `${caseText}no end date`;
    return { tone: standing.action === "ban" ? "danger" : "active", label, detail };
  }
  if (standing.kind === "recent") {
    return { tone: "warn", label: "Recently actioned", detail: `Last action ${timeAgo(standing.at, now)}` };
  }
  return {
    tone: "ok",
    label: "Clear",
    detail: hasRecord ? `Nothing in the last ${RECENT_DAYS} days` : "No actions on record",
  };
}

function ProfileHeader({
  profile,
  now,
  timeZone,
  action,
}: {
  profile: MemberProfile;
  now: Date;
  timeZone: string;
  action?: ReactNode;
}) {
  const { user, summary } = profile;
  const standing = standingOf(profile, now);
  const { tone, label, detail } = standingText(standing, profile.infractions.some((entry) => !entry.voided), now, timeZone);
  const series = activitySeries(profile, now);
  const total = series.reduce((sum, value) => sum + value, 0);
  const lastAction = summary.lastActionAt ?? profile.infractions.find((entry) => !entry.voided)?.createdAt ?? null;

  return (
    <header className="mod-card pf-head">
      <div className="pf-identity">
        <Avatar user={user} size="xl" />
        <div className="pf-identity-text">
          <div className="pf-name-row">
            <h2 className="pf-name">{displayName(user)}</h2>
            <span className="mod-pill" data-tone={user.inServer ? undefined : "expired"}>
              {user.inServer ? "In server" : "Left the server"}
            </span>
          </div>
          <CopyId id={user.userId} />
          <dl className="pf-head-facts">
            <div>
              <dt>Joined</dt>
              <dd>{profile.joinedAt ? formatDate(profile.joinedAt, timeZone) : <span className="pf-dim">Not in server</span>}</dd>
            </div>
            <div>
              <dt>Account created</dt>
              <dd>{profile.accountCreatedAt ? formatDate(profile.accountCreatedAt, timeZone) : <span className="pf-dim">Unknown</span>}</dd>
            </div>
            <div>
              <dt>Last action</dt>
              <dd>
                {lastAction ? (
                  <>
                    <time dateTime={lastAction} suppressHydrationWarning>
                      {timeAgo(lastAction, now)}
                    </time>
                    <span className="pf-fact-sub">{formatDateTime(lastAction, timeZone)}</span>
                  </>
                ) : (
                  <span className="pf-dim">None</span>
                )}
              </dd>
            </div>
          </dl>
          <RoleList roles={profile.roles} />
        </div>
      </div>

      <div className="pf-standing">
        <p className="pf-kicker">Standing</p>
        <p className="pf-standing-main">
          <span className="mod-pill pf-standing-pill" data-tone={tone}>
            {label}
          </span>
        </p>
        <p className="pf-standing-detail" suppressHydrationWarning>
          {detail}
        </p>
        <div className="pf-trend">
          <Spark series={series} />
          <span className="pf-trend-text">
            <span className="pf-num">{total}</span> {total === 1 ? "action" : "actions"} in {TREND_DAYS} days
          </span>
        </div>
        {action}
      </div>
    </header>
  );
}

function Spark({ series }: { series: number[] }) {
  const width = 88;
  const height = 24;
  const points = sparkPoints(series, width, height);
  const busy = series.some((value) => value > 0);
  const area = points ? `M${points.split(" ").join(" L")} L${width - 2},${height - 2} L2,${height - 2} Z` : "";
  return (
    <span className="mod-spark pf-spark" data-busy={busy ? "true" : undefined} role="img" aria-label={`Actions per day over the last ${series.length} days: ${series.join(", ")}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {busy ? <path className="mod-spark-area" d={area} /> : null}
        <polyline points={points} />
      </svg>
    </span>
  );
}

type CopyState = "idle" | "copied" | "manual";

/**
 * Selects the id and tries the older copy command. Used when the Clipboard
 * API is missing, as it is on a plain-HTTP origin, or refuses.
 */
function copyBySelection(node: HTMLElement | null): boolean {
  if (!node) return false;
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges();
  selection?.addRange(range);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

function CopyId({ id }: { id: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const value = useRef<HTMLElement>(null);

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(id);
      setState("copied");
    } catch {
      setState(copyBySelection(value.current) ? "copied" : "manual");
    }
  }

  return (
    <p className="pf-id">
      <span className="pf-id-label">ID</span>
      <code className="pf-id-value" ref={value}>
        {id}
      </code>
      <button type="button" className="pf-copy" aria-label="Copy user ID" onClick={() => void copy()}>
        {state === "copied" ? <CheckIcon /> : null}
        <span>{state === "copied" ? "Copied" : "Copy"}</span>
      </button>
      <span className="pf-copy-status" role="status">
        {state === "copied" ? <span className="pf-sr">User ID copied</span> : null}
        {state === "manual" ? "Selected. Press Ctrl+C to copy." : null}
      </span>
    </p>
  );
}

const ROLE_PREVIEW = 8;

function RoleList({ roles }: { roles: MemberProfile["roles"] }) {
  const [all, setAll] = useState(false);
  const firstRevealed = useRef<HTMLLIElement>(null);

  // The "more" button removes itself, so focus moves to the first role it
  // revealed instead of falling back to the top of the page.
  useEffect(() => {
    if (all) firstRevealed.current?.focus();
  }, [all]);

  if (roles.length === 0) return null;
  const shown = all ? roles : roles.slice(0, ROLE_PREVIEW);
  const hidden = roles.length - shown.length;
  return (
    <ul className="pf-roles" aria-label="Server roles">
      {shown.map((entry, index) => (
        <li
          key={entry.id}
          className="pf-role"
          ref={index === ROLE_PREVIEW ? firstRevealed : undefined}
          tabIndex={index === ROLE_PREVIEW ? -1 : undefined}
        >
          {entry.name}
        </li>
      ))}
      {hidden > 0 ? (
        <li>
          <button
            type="button"
            className="pf-role pf-role-more"
            aria-label={`Show ${hidden} more ${hidden === 1 ? "role" : "roles"}`}
            onClick={() => setAll(true)}
          >
            {hidden} more
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/* Side column --------------------------------------------------------------- */

function RecordCard({ profile }: { profile: MemberProfile }) {
  const counts = recordCounts(profile);
  const rows: { key: string; action: string; label: string; value: number }[] = [
    { key: "warn", action: "warn", label: "Warns", value: counts.warn },
    { key: "timeout", action: "timeout", label: "Timeouts", value: counts.timeout },
    { key: "kick", action: "kick", label: "Kicks", value: counts.kick },
    { key: "ban", action: "ban", label: "Bans", value: counts.ban },
  ];
  if (counts.other > 0) rows.push({ key: "other", action: "other", label: "Other actions", value: counts.other });
  rows.push({ key: "notes", action: "note", label: "Notes", value: counts.notes });
  const onRecord = counts.warn + counts.timeout + counts.kick + counts.ban + counts.other;

  return (
    <div className="mod-card pf-panel">
      <div className="pf-panel-head">
        <h2 className="pf-panel-title" id="pf-record-title">
          Record
        </h2>
        <span className="pf-panel-meta">
          <span className="pf-num">{onRecord}</span> {onRecord === 1 ? "action" : "actions"} on record
        </span>
      </div>
      <ul className="pf-counts">
        {rows.map((row) => (
          <li key={row.key} className="pf-count" data-zero={row.value === 0 ? "true" : undefined}>
            <span className="mod-actionicon" data-action={row.value === 0 ? undefined : row.action} aria-hidden="true">
              <StateIcon action={row.action} />
            </span>
            <span className="pf-count-label">{row.label}</span>
            <span className="pf-num pf-count-value">{row.value}</span>
          </li>
        ))}
      </ul>
      <p className="pf-panel-foot">
        {counts.removed > 0 ? (
          <>
            <span className="pf-num">{counts.removed}</span> removed or deleted {counts.removed === 1 ? "entry is" : "entries are"} kept
            on the timeline but left out of these totals.
          </>
        ) : (
          "Removed entries stay on the timeline but are left out of these totals."
        )}
      </p>
    </div>
  );
}

function FactsCard({ profile, timeZone }: { profile: MemberProfile; timeZone: string }) {
  const facts = quickFacts(profile);
  return (
    <div className="mod-card pf-panel">
      <div className="pf-panel-head">
        <h2 className="pf-panel-title" id="pf-facts-title">
          Quick facts
        </h2>
      </div>
      <dl className="pf-quick">
        <Fact label="On record since">{facts.firstEntryAt ? formatDate(facts.firstEntryAt, timeZone) : "No entries"}</Fact>
        <Fact label="Staff involved">
          <span className="pf-num">{facts.staffInvolved}</span>
        </Fact>
        <Fact label="Most actions by">
          {facts.topModerator ? (
            <span className="pf-quick-user">
              <Avatar user={facts.topModerator.user} size="sm" />
              <span className="pf-ellipsis">{displayName(facts.topModerator.user)}</span>
              <span className="pf-dim pf-num">{facts.topModerator.count}</span>
            </span>
          ) : (
            "Nobody yet"
          )}
        </Fact>
        <Fact label="Staff changes">
          <span className="pf-num">{facts.changes}</span>
        </Fact>
      </dl>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pf-quick-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const NoteComposer = forwardRef<HTMLTextAreaElement, { onSubmit(content: string): Promise<ModResult> }>(function NoteComposer(
  { onSubmit },
  ref,
) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const fieldId = useId();
  const hintId = useId();
  const trimmed = text.trim();

  async function submit() {
    if (lock.current || trimmed === "") return;
    lock.current = true;
    setBusy(true);
    const content = trimmed;
    // The note shows in the timeline straight away, so the box clears now and
    // only gets the text back if the server refuses it.
    setText("");
    try {
      const result = await onSubmit(content);
      if (result !== true) setText(content);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      className="mod-card pf-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="pf-panel-head">
        <label className="pf-panel-title" htmlFor={fieldId}>
          Add a note
        </label>
        <span className="pf-shortcut" aria-hidden="true">
          <kbd className="mod-kbd">Alt</kbd>
          <kbd className="mod-kbd">N</kbd>
        </span>
      </div>
      <textarea
        ref={ref}
        id={fieldId}
        className="textarea pf-textarea"
        rows={4}
        value={text}
        maxLength={NOTE_LIMIT}
        placeholder="What should the next moderator know?"
        aria-describedby={hintId}
        aria-keyshortcuts="Alt+N"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <p className="pf-field-hint" id={hintId}>
        Seen by staff only, never by the member. Alt+N jumps here from anywhere on the page; Ctrl+Enter adds the
        note.
      </p>
      <div className="pf-composer-foot">
        <CharacterCount length={text.length} limit={NOTE_LIMIT} />
        <button type="submit" className="btn btn-primary btn-sm" aria-disabled={busy || trimmed === "" || undefined}>
          {busy ? "Adding…" : "Add note"}
        </button>
      </div>
    </form>
  );
});

/* Error state --------------------------------------------------------------- */

export function RetryButton() {
  const router = useRouter();
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.refresh()}>
      Try again
    </button>
  );
}
