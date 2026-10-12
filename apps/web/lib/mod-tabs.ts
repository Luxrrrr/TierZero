import { can, type StaffRole } from "@tier0/core";

export interface ModTab {
  id: "overview" | "members" | "logs" | "serverlogs" | "access" | "settings";
  label: string;
  href: string;
}

/**
 * The tabs under Moderation. Visibility follows the same permissions the
 * server enforces, so a tab never leads to a page that would refuse the person
 * who clicked it. Settings is a different kind of permission from the rest:
 * it needs Manage Server, which a staff role does not grant, so it is its own
 * flag. Someone who manages the server without being listed staff has no
 * staff role and sees that tab alone.
 */
export function modTabsFor(guildId: string, role: StaffRole | null, canManage = false): ModTab[] {
  const base = `/guilds/${guildId}/mod`;
  const tabs: ModTab[] = [];
  if (role) {
    tabs.push(
      { id: "overview", label: "Overview", href: base },
      { id: "members", label: "Members", href: `${base}/members` },
      // Member actions and staff activity share this tab, with a switch between them on each page.
      { id: "logs", label: "Mod logs", href: `${base}/actions` },
      // Moderators get the tab too. Whether they may open the logs is a server setting, which the page explains.
      { id: "serverlogs", label: "Server logs", href: `${base}/server-logs` },
    );
    if (can(role, "staff.manage")) tabs.push({ id: "access", label: "Access", href: `${base}/access` });
  }
  if (canManage) tabs.push({ id: "settings", label: "Settings", href: `${base}/settings` });
  return tabs;
}

/**
 * Whether a tab is the current one. Overview is a prefix of every other
 * route, so it only matches exactly.
 */
export function isTabCurrent(tab: ModTab, pathname: string): boolean {
  if (tab.id === "overview") return pathname === tab.href || pathname === `${tab.href}/`;
  if (tab.id === "logs") {
    const base = tab.href.replace(/\/actions$/, "");
    return [`${base}/actions`, `${base}/audit`].some((href) => pathname === href || pathname.startsWith(`${href}/`));
  }
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}
