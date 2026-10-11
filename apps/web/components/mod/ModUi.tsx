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
import { RelativeTime } from "./RelativeTime";
import { automodActionLabel } from "./automod";
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
  displayName,
  fmtDate,
  fmtDateTime,
  fmtDateUtc,
  fmtDateTimeUtc,
  fmtLocal,
  timeAgo,
  describeLoadError,
} from "./format";
export { LocalTime, RelativeTime } from "./RelativeTime";
export { automodActionLabel, isAutomodAction, parseAutomodReason, ruleLabel } from "./automod";

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
 * `size` takes a named size or, for older callers, a pixel width.
 */
export function Avatar({ user, size = "md" }: { user: UserRef; size?: AvatarSize | number }) {
  const hue = hueFor(user.userId);
  const style: CSSProperties & Record<string, string | number> = { "--mod-hue": hue };
  if (typeof size === "number") style["--mod-avatar-size"] = `${size}px`;
  const className = `mod-avatar${typeof size === "number" ? "" : SIZE_CLASS[size]}`;
  return (
    <span className={className} data-hue={hue} style={style} aria-hidden="true">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" loading="lazy" decoding="async" /> : initialsFor(user)}
    </span>
  );
}

export function UserChip({
  user,
  href,
  muted = false,
  sub,
  size,
}: {
  user: UserRef;
  href?: string;
  muted?: boolean;
  /** A second line under the name, such as the id or a role. */
  sub?: ReactNode;
  size?: AvatarSize;
}) {
  const left = !user.inServer && user.name !== null ? <span className="mod-user-left">left</span> : null;
  const inner = (
    <>
      <Avatar user={user} size={size ?? (sub ? "lg" : "md")} />
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
  return href ? (
    <Link className="mod-user" data-muted={muted ? "true" : undefined} href={href}>
      {inner}
    </Link>
  ) : (
    <span className="mod-user" data-muted={muted ? "true" : undefined}>
      {inner}
    </span>
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
  if (pages <= 1) return null;
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
