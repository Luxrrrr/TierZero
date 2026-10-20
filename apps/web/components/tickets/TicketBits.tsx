import type { UserRef } from "@tier0/shared-moderation";
import type { TicketPriority, TicketSummaryDto } from "@tier0/shared-tickets";
import { Pill } from "../mod/ModUi";
import { FlagIcon, StarIcon } from "../Icons";
import { PRIORITY_LABEL, statusLabel } from "../../lib/ticket-format";

/**
 * The small marks every ticket screen repeats. Usable from server and client
 * components alike.
 */

/**
 * Priority as a word with a flag, never colour alone. Normal is the quiet
 * default, so a list only marks the tickets that differ from it.
 */
export function PriorityTag({ priority, quietNormal = true }: { priority: TicketPriority; quietNormal?: boolean }) {
  if (priority === "normal" && quietNormal) return null;
  return (
    <span className="tk-priority" data-priority={priority}>
      <FlagIcon />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function TypeTag({ name, emoji }: { name: string; emoji?: string | null }) {
  const label = name.trim() || "Ticket";
  return (
    <span className="tk-type" title={label}>
      {emoji && !emoji.startsWith("<") ? <span aria-hidden="true">{emoji}</span> : null}
      <span className="tk-type-name">{label}</span>
    </span>
  );
}

export function TicketStatusPill({ ticket }: { ticket: Pick<TicketSummaryDto, "status" | "archived"> }) {
  return <Pill tone={ticket.status === "open" ? "ok" : "neutral"}>{statusLabel(ticket)}</Pill>;
}

/** A rating as stars, with the number for anyone not looking at them. */
export function Stars({ rating, size = "md" }: { rating: number; size?: "sm" | "md" }) {
  return (
    <span className="tk-stars" data-size={size} role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} filled={n <= rating} className={n <= rating ? "is-on" : undefined} />
      ))}
    </span>
  );
}

/** A message author as the shared avatar and chip components expect a person. */
export function authorRef(author: { userId: string; name: string; avatarUrl: string | null }): UserRef {
  return { userId: author.userId, name: author.name, avatarUrl: author.avatarUrl, inServer: true };
}
