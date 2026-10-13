import { emptyButton, type MessageButton } from "./components.js";

/**
 * Where a member's record and a single case live in the dashboard. The bot puts
 * these in mod log posts and the dashboard's member page reads `case` from the
 * query string, so the two sides have to agree on the shape.
 */

export interface DashboardLinks {
  /** The member's record page, focused on one case. Empty when there is no case or no known address. */
  caseUrl: string;
  /** The member's record page. Empty when no address is known. */
  memberUrl: string;
}

/**
 * `base` is an http(s) origin without a trailing slash, or empty when the
 * dashboard's address is not known, in which case both links are empty so the
 * message can leave them out.
 */
export function dashboardLinks(base: string, guildId: string, userId: string, caseNumber?: number): DashboardLinks {
  if (base === "") return { caseUrl: "", memberUrl: "" };
  const memberUrl = `${base}/guilds/${guildId}/mod/members/${userId}`;
  return { memberUrl, caseUrl: caseNumber === undefined ? "" : `${memberUrl}?case=${caseNumber}` };
}

/** The button the mod log posts carry by default. It disappears from the post when `{caseUrl}` comes out empty. */
export function viewCaseButton(): MessageButton {
  return { ...emptyButton(), label: "View in dashboard", style: "link", url: "{caseUrl}" };
}
