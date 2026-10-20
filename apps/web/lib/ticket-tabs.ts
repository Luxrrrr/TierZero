import type { TicketAccessLevel } from "@tier0/shared-tickets";

export interface TicketTab {
  id: "inbox" | "transcripts" | "stats" | "settings";
  label: string;
  href: string;
}

/**
 * The tabs under Tickets. Anyone who works tickets, at any level, gets the
 * workspace; Settings needs Manage Server, which handling tickets does not
 * grant, so it is its own flag. Someone who manages the server before any
 * ticket type exists still has a level (manager) from the bot, but a bot that
 * could not be asked leaves them with Settings alone, which is where they
 * would go to fix it.
 */
export function ticketTabsFor(guildId: string, level: TicketAccessLevel | null, canManage = false): TicketTab[] {
  const base = `/guilds/${guildId}/tickets`;
  const tabs: TicketTab[] = [];
  if (level !== null) {
    tabs.push(
      { id: "inbox", label: "Inbox", href: base },
      { id: "transcripts", label: "Transcripts", href: `${base}/transcripts` },
      { id: "stats", label: "Stats", href: `${base}/stats` },
    );
  }
  if (canManage) tabs.push({ id: "settings", label: "Settings", href: `${base}/settings` });
  return tabs;
}

/**
 * Whether a tab is the current one. The inbox owns its root and every open
 * ticket under it, which are numbers; the quick setup belongs with Settings.
 */
export function isTicketTabCurrent(tab: TicketTab, pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  if (tab.id === "inbox") {
    if (path === tab.href) return true;
    const rest = path.startsWith(`${tab.href}/`) ? path.slice(tab.href.length + 1) : null;
    return rest !== null && /^[0-9]+$/.test(rest);
  }
  if (tab.id === "settings") {
    const setup = tab.href.replace(/\/settings$/, "/setup");
    return [tab.href, setup].some((href) => path === href || path.startsWith(`${href}/`));
  }
  return path === tab.href || path.startsWith(`${tab.href}/`);
}

/** Where someone lands when they open Tickets: the inbox if they work tickets, otherwise the settings. */
export function ticketLanding(guildId: string, level: TicketAccessLevel | null, canManage: boolean): string | null {
  const [first] = ticketTabsFor(guildId, level, canManage);
  return first ? first.href : null;
}
