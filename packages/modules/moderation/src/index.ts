import { defineModule } from "@tier0/core";
import { moderationSettings } from "./settings.js";
import { warnCommand } from "./commands/warn.js";
import { timeoutCommand } from "./commands/timeout.js";
import { kickCommand } from "./commands/kick.js";
import { banCommand } from "./commands/ban.js";
import { unbanCommand } from "./commands/unban.js";
import { caseCommand } from "./commands/case.js";
import { historyCommand } from "./commands/history.js";
import { purgeCommand } from "./commands/purge.js";
import { deactivateOpen, recordInfraction } from "./infractions.js";
import { formatDirectMessage } from "./modlog.js";
import { tryDirectMessage } from "./dm.js";
import { postModLog } from "./reply.js";

export default defineModule({
  id: "moderation",
  name: "Moderation",
  summary: "Warnings, timeouts, kicks and bans with a searchable case history.",
  category: "moderation",

  settings: moderationSettings,

  commands: [
    warnCommand,
    timeoutCommand,
    kickCommand,
    banCommand,
    unbanCommand,
    caseCommand,
    historyCommand,
    purgeCommand,
  ],

  tasks: {
    // Lifts a temporary ban. This runs from the scheduled task table, not a
    // timer, so a ban issued just before a restart still gets lifted on time.
    async unban(payload, ctx) {
      const userId = payload.userId;
      if (typeof userId !== "string") return;

      const stillBanned = await ctx.guild.bans.fetch(userId).catch(() => null);
      if (!stillBanned) return;

      await ctx.guild.members.unban(userId, "Temporary ban expired").catch(() => undefined);
      await deactivateOpen(ctx.guild.id, userId, "ban");

      const moderatorId = ctx.client.user?.id ?? userId;
      const record = await recordInfraction({
        guildId: ctx.guild.id,
        userId,
        moderatorId,
        action: "unban",
        reason: "Temporary ban expired",
      });

      if (ctx.settings.dmOnAction) {
        await tryDirectMessage(
          ctx.client,
          userId,
          formatDirectMessage(ctx.guild.name, {
            action: "unban",
            reason: "Temporary ban expired",
            expiresAt: null,
          }),
        );
      }

      await postModLog(ctx, {
        caseNumber: record.caseNumber,
        action: "unban",
        targetId: userId,
        moderatorId,
        reason: "Temporary ban expired",
        expiresAt: null,
      });
    },
  },

  requires: ["ModerateMembers", "KickMembers", "BanMembers", "ManageMessages"],
});
