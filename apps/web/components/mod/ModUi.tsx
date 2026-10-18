import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ROLE_LABEL, type InfractionDto, type StaffRole, type UserRef } from "@tier0/core";
import {
  AlertIcon,
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DoorIcon,
  HistoryIcon,
  NoteIcon,
  ShieldIcon,
  TrashIcon,
  UndoIcon,
  WarnTriangleIcon,
} from "../Icons";
import { PersonMenuArea } from "./PersonMenuArea";
import { RelativeTime } from "./RelativeTime";
import { automodActionLabel, automodDetailText, isAutomodAction, parseAutomodReason, ruleLabel } from "./automod";
import {
  describeLoadError,
  displayName,
  hueFor,
  infractionStatus,
  initialsFor,
  STATUS_LABEL,
  STATUS_TONE,
  type InfractionStatus,
} from "./format";

export {
  automodUser,
  displayName,
  moderatorOf,
  fmtDate,
  fmtDateTime,
  fmtDateUtc,
  fmtDateTimeUtc,
  fmtLocal,
  timeAgo,
  describeLoadError,
  dayCountText,
  isPastEnd,
} from "./format";
export { LocalTime, RelativeTime } from "./RelativeTime";
export { automodActionLabel, automodDetailText, isAutomodAction, parseAutomodReason, readableReason, ruleLabel } from "./automod";

/**
 * The small pieces every mod page repeats, kept in one place so a warn looks
 * like a warn everywhere. Usable from server and client components alike.
 */

const ACTION_LABEL: Record<string, string> = {
  warn: "Warn",
  timeout: "Timeout",
  "timeout-clear": "Timeout cleared",
  kick: "Kick",
  ban: "Ban",
  unban: "Unban",
  note: "Note",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? automodActionLabel(action) ?? action;
}

type IconComponent = (props: { className?: string }) => ReactNode;

/** The icon for each kind of entry. Anything unlisted is staff activity and gets the shield. */
export const STATE_ICON: Record<string, IconComponent> = {
  warn: WarnTriangleIcon,
  timeout: ClockIcon,
  "timeout-clear": UndoIcon,
  kick: DoorIcon,
  ban: BanIcon,
  unban: UndoIcon,
  note: NoteIcon,
  purge: TrashIcon,
  history: HistoryIcon,
};

export function StateIcon({ action, className }: { action: string; className?: string }) {
  const Icon = STATE_ICON[action] ?? ShieldIcon;
  return <Icon className={className} />;
}

/** A round icon in the action's colour, for timelines and feeds. */
export function ActionIcon({ action, large = false }: { action: string; large?: boolean }) {
  return (
    <span className={large ? "mod-actionicon mod-actionicon--lg" : "mod-actionicon"} data-action={action} aria-hidden="true">
      <StateIcon action={action} />
    </span>
  );
}

export function ActionBadge({
  action,
  voided = false,
  icon = true,
}: {
  action: string;
  voided?: boolean;
  icon?: boolean;
}) {
  return (
    <span className="mod-badge" data-action={action} data-voided={voided ? "true" : undefined}>
      {icon ? <StateIcon action={action} /> : null}
      {actionLabel(action)}
    </span>
  );
}

/**
 * A case's reason. An automod case shows its rule by name in a tag, then the
 * wording, so the rule key it is stored under never reaches the page.
 */
export function CaseReason({ action, reason, empty = "No reason given." }: { action: string; reason: string | null; empty?: ReactNode }) {
  if (!isAutomodAction(action)) return <>{reason ?? empty}</>;
  const parsed = parseAutomodReason(reason);
  const detail = automodDetailText(parsed.detail);
  if (!parsed.rule) return <>{detail ?? empty}</>;
  return (
    <>
      <span className="mod-rule">
        <span className="visually-hidden">Rule: </span>
        {ruleLabel(parsed.rule)}
      </span>
      {detail}
    </>
  );
}

export function RoleBadge({ role }: { role: StaffRole }) {
  return (
    <span className="mod-badge" data-role={role}>
      {ROLE_LABEL[role]}
    </span>
  );
}

export type PillTone = "active" | "expired" | "removed" | "neutral" | "ok" | "warn" | "danger";

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className="mod-pill" data-tone={tone}>
      {children}
    </span>
  );
}

/** Where an infraction stands: active, expired, removed, or simply on record. */
export function StatusPill({
  infraction,
  status,
}: {
  infraction?: Pick<InfractionDto, "action" | "active" | "expiresAt" | "voided">;
  status?: InfractionStatus;
}) {
  const resolved = status ?? (infraction ? infractionStatus(infraction) : "recorded");
  return <Pill tone={STATUS_TONE[resolved]}>{STATUS_LABEL[resolved]}</Pill>;
}

type AvatarSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: " mod-avatar--sm",
  md: "",
  lg: " mod-avatar--lg",
  xl: " mod-avatar--xl",
};

/**
 * A user's Discord avatar, or their initials on a colour drawn from their id.
 * Automod has neither: it shows a shield, the same one everywhere.
 * `size` takes a named size or, for older callers, a pixel width.
 */
export function Avatar({ user, size = "md", menu = true }: { user: UserRef; size?: AvatarSize | number; menu?: boolean }) {
  const hue = hueFor(user.userId);
  const style: CSSProperties & Record<string, string | number> = { "--mod-hue": hue };
  if (typeof size === "number") style["--mod-avatar-size"] = `${size}px`;
  const className = `mod-avatar${typeof size === "number" ? "" : SIZE_CLASS[size]}`;
  const face = (
    <span className={className} data-hue={hue} data-automod={user.automod ? "true" : undefined} style={style} aria-hidden="true">
      {user.automod ? <ShieldIcon /> : user.avatarUrl ? <img src={user.avatarUrl} alt="" loading="lazy" decoding="async" /> : initialsFor(user)}
    </span>
  );
  // Right-click opens the person menu wherever an avatar is shown. A picker or a search result
  // passes menu={false}, because a right-click there belongs to the browser.
  return menu ? <PersonMenuArea user={user}>{face}</PersonMenuArea> : face;
}

export function UserChip({
  user,
  href,
  muted = false,
  sub,
  size,
  menu = true,
  menuButton = true,
}: {
  user: UserRef;
  href?: string;
  muted?: boolean;
  /** A second line under the name, such as the id or a role. */
  sub?: ReactNode;
  size?: AvatarSize;
  /** Right-click, the context menu key and a "..." button open the person menu. */
  menu?: boolean;
  /** False where the chip sits inside a link, which cannot hold a button. Right-click and the keyboard still work. */
  menuButton?: boolean;
}) {
  const left = !user.inServer && user.name !== null ? <span className="mod-user-left">left</span> : null;
  const inner = (
    <>
      <Avatar user={user} size={size ?? (sub ? "lg" : "md")} menu={false} />
      {sub ? (
        <span className="mod-user-text">
          <span className="mod-user-name">{displayName(user)}</span>
          <span className="mod-user-sub">{sub}</span>
        </span>
      ) : (
        <span className="mod-user-name">{displayName(user)}</span>
      )}
      {left}
    </>
  );
  const chip = href ? (
    <Link className="mod-user" data-muted={muted ? "true" : undefined} href={href}>
      {inner}
    </Link>
  ) : (
    <span className="mod-user" data-muted={muted ? "true" : undefined}>
      {inner}
    </span>
  );
  return menu ? (
    <PersonMenuArea user={user} button={menuButton} buttonTabbable={!href}>
      {chip}
    </PersonMenuArea>
  ) : (
    chip
  );
}

/** Kept for existing callers; new code can use RelativeTime directly. */
export function When({ iso }: { iso: string }) {
  return <RelativeTime iso={iso} />;
}

/**
 * The empty state every list uses: an icon in a soft circle, a title, one
 * sentence, and optionally the one thing to do next.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  tone,
  compact = false,
  role,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "danger" | "attention";
  compact?: boolean;
  role?: "alert" | "status";
}) {
  return (
    <div className={compact ? "mod-empty mod-empty--compact" : "mod-empty"} data-tone={tone} role={role}>
      <span className="mod-empty-icon" aria-hidden="true">
        {icon ?? <HistoryIcon />}
      </span>
      <p className="mod-empty-title">{title}</p>
      {children ? <p className="mod-empty-text">{children}</p> : null}
      {action ? <div className="mod-empty-action">{action}</div> : null}
    </div>
  );
}

/**
 * A calm stand-in for a section whose data did not load, so the rest of the
 * page still renders. Takes the status from a ControlApiError when there is one.
 */
export function LoadFailure({
  status,
  what,
  retryHref,
  compact = false,
}: {
  status?: number;
  what?: string;
  /** Where "Try again" goes; usually the current URL. Omit to hide the button. */
  retryHref?: string;
  compact?: boolean;
}) {
  const copy = describeLoadError(status, what);
  return (
    <EmptyState
      icon={<AlertIcon />}
      title={copy.title}
      tone={copy.tone}
      compact={compact}
      role="alert"
      action={
        copy.retry && retryHref ? (
          <Link className="btn btn-secondary btn-sm" href={retryHref}>
            Try again
          </Link>
        ) : undefined
      }
    >
      {copy.text}
    </EmptyState>
  );
}

/**
 * Shown in place of a list's "nothing yet" message when the page asked for is
 * past the end, which would otherwise claim the list is empty.
 */
export function PastEnd({ total, pageSize, hrefFor, noun = "entries" }: { total: number; pageSize: number; hrefFor(page: number): string; noun?: string }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  return (
    <EmptyState
      icon={<HistoryIcon />}
      title="This page is past the end of the list"
      action={
        <Link className="btn btn-secondary btn-sm" href={hrefFor(last)}>
          Go to the last page
        </Link>
      }
    >
      {`There ${total === 1 ? "is" : "are"} ${total.toLocaleString("en")} ${noun}, on ${last === 1 ? "one page" : `pages 1 to ${last.toLocaleString("en")}`}.`}
    </EmptyState>
  );
}

/** Previous and next links for a paged list. `hrefFor` builds the URL for a page number. */
export function Pager({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor(page: number): string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Past the last page there is no range to show; the list says so and links back instead.
  if (pages <= 1 || page > pages) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav className="mod-pager" aria-label="Pages">
      <span className="mod-pager-count">
        <strong>
          {first.toLocaleString("en")}–{last.toLocaleString("en")}
        </strong>{" "}
        of {total.toLocaleString("en")}
      </span>
      <span className="mod-pager-buttons">
        {page > 1 ? (
          <Link className="btn btn-secondary btn-sm" href={hrefFor(page - 1)} rel="prev">
            <ChevronLeftIcon />
            Previous
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm" aria-disabled="true">
            <ChevronLeftIcon />
            Previous
          </span>
        )}
        {page < pages ? (
          <Link className="btn btn-secondary btn-sm" href={hrefFor(page + 1)} rel="next">
            Next
            <ChevronRightIcon />
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm" aria-disabled="true">
            Next
            <ChevronRightIcon />
          </span>
        )}
      </span>
    </nav>
  );
}
