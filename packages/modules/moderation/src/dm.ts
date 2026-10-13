import type { ModuleContext } from "@tier0/core";
import type { ModerationSettings } from "./settings.js";
import { DM_MESSAGE } from "./messages.js";
import { actionLabel, noticeValues, type ActionNotice } from "./modlog.js";
import { defaultBody } from "./texts.js";

/**
 * Best-effort direct message. A member with DMs closed, or who has left
 * every server shared with the bot, makes this fail routinely - that must
 * never abort the action it is reporting on. Failures are swallowed here so
 * no call site has to remember to do it itself.
 */
export async function tryDirectMessage(
  ctx: ModuleContext<ModerationSettings>,
  userId: string,
  notice: ActionNotice,
): Promise<boolean> {
  try {
    const user = await ctx.client.users.fetch(userId);
    const sent = await ctx.send(user, ctx.settings.dmMessage, noticeValues(notice, ctx.settings.labels), { fallback: DM_MESSAGE });
    return sent !== null;
  } catch {
    return false;
  }
}

/** Tells a member that the message they were just sent about an action was a mistake. Best effort like the rest. */
export async function tryCorrectionMessage(
  ctx: ModuleContext<ModerationSettings>,
  userId: string,
  action: string,
): Promise<boolean> {
  try {
    const user = await ctx.client.users.fetch(userId);
    const values = { action: actionLabel(action, ctx.settings.labels).toLowerCase() };
    const sent = await ctx.send(user, ctx.settings.replies.direct.correction, values, { fallback: defaultBody("direct", "correction") });
    return sent !== null;
  } catch {
    return false;
  }
}
