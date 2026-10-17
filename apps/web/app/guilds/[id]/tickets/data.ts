import { forbidden, redirect } from "next/navigation";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError } from "../../../../lib/control-api";
import { requireStaff } from "../../../../lib/mod-access";
import { requireTicketViewer, type TicketViewer } from "../../../../lib/tickets-access";
import type { Loaded } from "../../../../components/tickets/InboxScreen";

/**
 * What every ticket page does first: find out who is looking, and turn the
 * bot's answers into something a page can word. Server code only.
 */

/** The viewer, or the page ends here with the right refusal. A bot that cannot be reached is thrown for the page to show. */
export async function ticketViewerOrExit(guildId: string): Promise<TicketViewer> {
  const viewer = await requireTicketViewer(guildId);
  if (!viewer.ok) {
    if (viewer.status === 401) redirect("/login");
    forbidden();
  }
  return viewer;
}

export async function loaded<T>(promise: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    if (error instanceof ControlApiError) return { ok: false, status: error.status, message: error.message };
    throw error;
  }
}

/** Used only to decide what to show, so any failure reads as no. */
export async function canManageGuild(guildId: string): Promise<boolean> {
  return requireGuildAccess(guildId).then(
    (result) => result.ok,
    () => false,
  );
}

export async function canModerateGuild(guildId: string): Promise<boolean> {
  return requireStaff(guildId).then(
    (result) => result.ok,
    () => false,
  );
}
