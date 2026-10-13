import { AUTOMOD_NAME, isInForce, type InfractionDto, type UserRef } from "@tier0/core";

/**
 * The plain logic behind the mod dashboard's shared pieces. No React here, so
 * it can be tested with the node runner and used from server and client code.
 */

/** The one way automod is shown: named Automod, with the shield in place of an avatar. */
export function automodUser(user: UserRef): UserRef {
  return { ...user, name: AUTOMOD_NAME, avatarUrl: null, inServer: true, automod: true };
}

/**
 * Who made a case. The bot marks its own account already, so the action is
 * only a second opinion for a reply from a bot that does not.
 */
export function moderatorOf(infraction: Pick<InfractionDto, "action" | "moderator">): UserRef {
  return infraction.moderator.automod || infraction.action.startsWith("automod-")
    ? automodUser(infraction.moderator)
    : infraction.moderator;
}

/** "Name" when Discord knows it, otherwise the id tail, so a deleted account is still identifiable. */
export function displayName(user: UserRef): string {
  return user.name ?? `User ${user.userId.slice(-4)}`;
}

/**
 * A stable hue for a user's fallback avatar. It hashes the id rather than the
 * name so the colour survives a rename, and the same person looks the same on
 * every page.
 */
export function hueFor(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // Snowflakes from one server share a long prefix and differ at the end,
  // where FNV mixes least; a finalizer spreads those last digits across the wheel.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return (hash >>> 0) % 360;
}

/**
 * Up to two letters for a fallback avatar: the initials of a known name, or
 * the last two digits of the id for an account Discord no longer knows.
 */
export function initialsFor(user: Pick<UserRef, "name" | "userId">): string {
  const name = user.name?.trim();
  if (name) {
    const words = name.split(/[\s_.-]+/u).filter(Boolean);
    const letters =
      words.length >= 2
        ? [...words[0]!].slice(0, 1).concat([...words[1]!].slice(0, 1))
        : [...(words[0] ?? name)].slice(0, 2);
    const joined = letters.join("").toUpperCase();
    if (joined.trim()) return joined;
  }
  const digits = user.userId.replace(/\D/gu, "");
  return digits ? digits.slice(-2) : "--";
}

export type InfractionStatus = "active" | "expired" | "removed" | "recorded";

/**
 * Where an entry stands now. Removal outranks everything, since it no longer
 * counts. "Active" follows isInForce rather than the stored flag, which the
 * bot also sets on warns and never clears when a timeout runs out.
 */
export function infractionStatus(
  infraction: Pick<InfractionDto, "action" | "active" | "expiresAt" | "voided">,
  now: Date = new Date(),
): InfractionStatus {
  if (infraction.voided) return "removed";
  const state = { action: infraction.action, active: infraction.active, expiresAt: infraction.expiresAt, removed: false };
  if (isInForce(state, now)) return "active";
  if (infraction.expiresAt && new Date(infraction.expiresAt).getTime() <= now.getTime()) return "expired";
  return "recorded";
}

export const STATUS_LABEL: Record<InfractionStatus, string> = {
  active: "Active",
  expired: "Expired",
  removed: "Removed",
  recorded: "On record",
};

export const STATUS_TONE: Record<InfractionStatus, "active" | "expired" | "removed" | "neutral"> = {
  active: "active",
  expired: "expired",
  removed: "removed",
  recorded: "neutral",
};

/*
 * Dates follow one rule everywhere on the mod pages. Anything rendered on the
 * server is in UTC and says so ("Oct 10, 2026, 14:30 UTC"), because the server
 * cannot know the reader's time zone and the browser must produce the same
 * text when it hydrates. Once the page runs in the browser, LocalTime and
 * RelativeTime switch to the reader's own locale and time zone. Times are
 * always 24-hour, so the two never disagree about the clock format.
 */

const UTC_DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const UTC_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** Server-safe date, labelled by its time zone only where a time is shown. */
export const fmtDateUtc = (iso: string): string => UTC_DATE.format(new Date(iso));
export const fmtDateTimeUtc = (iso: string): string => `${UTC_DATE_TIME.format(new Date(iso))} UTC`;

/** Kept for existing callers: both are the server-safe UTC forms. */
export const fmtDate = fmtDateUtc;
export const fmtDateTime = fmtDateTimeUtc;

/**
 * The reader's own locale and time zone, for use after mount only. `locale`
 * and `timeZone` are parameters so the formatting can be tested.
 */
export function fmtLocal(
  iso: string,
  mode: "date" | "datetime",
  locale?: string,
  timeZone?: string,
): string {
  const options: Intl.DateTimeFormatOptions =
    mode === "date"
      ? { year: "numeric", month: "short", day: "numeric", timeZone }
      : {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZoneName: "short",
          timeZone,
        };
  return new Intl.DateTimeFormat(locale, options).format(new Date(iso));
}

/** "5 minutes ago", for a column that has to scan quickly. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  const steps: [number, string][] = [
    [60 * 60 * 24 * 365, "year"],
    [60 * 60 * 24 * 30, "month"],
    [60 * 60 * 24 * 7, "week"],
    [60 * 60 * 24, "day"],
    [60 * 60, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of steps) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${name}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

export interface LoadErrorCopy {
  title: string;
  text: string;
  tone: "danger" | "attention";
  /** Whether trying again could help. */
  retry: boolean;
}

/**
 * What to tell a moderator when a page's data did not arrive. Mapped from
 * the status so the wording is about what to do, not about HTTP.
 */
export function describeLoadError(status: number | undefined, what = "this page"): LoadErrorCopy {
  if (status === 403) {
    return {
      title: "Not available to your role",
      text: `Your role does not include ${what}. Ask the server owner if you need it.`,
      tone: "attention",
      retry: false,
    };
  }
  if (status === 404) {
    return {
      title: `Could not find ${what}`,
      text: "It may have been removed, or the bot is running an older version that does not provide it. Update the bot and reload.",
      tone: "attention",
      retry: false,
    };
  }
  if (status === 504) {
    return {
      title: "The bot is slow to answer",
      text: "It may be busy talking to Discord. Wait a moment and try again.",
      tone: "attention",
      retry: true,
    };
  }
  if (status === undefined || status === 502 || status === 503) {
    return {
      title: "The bot is unreachable",
      text: "The dashboard could not reach the bot. Check that it is running, then try again.",
      tone: "danger",
      retry: true,
    };
  }
  return {
    title: `Could not load ${what}`,
    text: "Something went wrong while fetching it. Try again; if it keeps happening, check the bot's logs.",
    tone: "danger",
    retry: true,
  };
}
