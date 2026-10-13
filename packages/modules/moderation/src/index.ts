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
import { contextCommands, submitContextAction } from "./commands/context.js";
import { liftTemporaryBan } from "./unban-task.js";
import { recentMessages } from "./recent-messages.js";

export { performAction, type PerformInput, type PerformOutcome } from "./perform.js";
export {
  ActionRefused,
  actionContext,
  commandForAction,
  commandSwitchedOff,
  disabledActions,
  readRequestFields,
  type ActionOrigin,
} from "./action-rules.js";
export { fetchMemberOrNull } from "./lookups.js";
export {
  evidenceForTrip,
  loggedCopyOf,
  recentFor,
  resolveEvidence,
  viewerCanRead,
  type EvidenceViewer,
  type TripEvidenceInput,
  type TrippingMessage,
} from "./evidence.js";
export { changeLength, type ChangeLengthInput } from "./edit-length.js";
export { backfillEvidence, splitMessageLink } from "./backfill.js";
export {
  auditAutomodCase,
  automodAuditSummary,
  backfillAutomodAudit,
  genericReasonOf,
  type AutomodCaseFacts,
} from "./automod-audit.js";
export { RecentMessages, RECENT_LIMITS, recentMessages } from "./recent-messages.js";
export type { InfractionRecord } from "./infractions.js";
export type { ModerationSettings } from "./settings.js";

export default defineModule({
  id: "moderation",
  name: "Moderation",
  summary: "Warnings, timeouts, kicks and bans with a searchable case history.",
  category: "moderation",
  area: "moderation",

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

  contextCommands,

  modals: { ctxact: submitContextAction },

  // What a member said lately is kept in memory, so a moderator can attach it to an
  // action even on a server that has not turned on Server logs, including a message
  // deleted since. With the message log on, Server logs keeps the full history.
  events: {
    async messageCreate(message) {
      if (message.author.bot || !message.guild) return;
      const channel = message.channel;
      recentMessages.record(message.guild.id, {
        id: message.id,
        channelId: message.channelId,
        channelName: "name" in channel && typeof channel.name === "string" ? channel.name : "",
        authorId: message.author.id,
        content: message.content,
        attachments: [...message.attachments.values()].map((a) => ({ name: a.name, url: a.url, contentType: a.contentType })),
        createdAt: message.createdTimestamp,
        deleted: false,
      });
    },
    async messageUpdate(_before, after) {
      if (after.content !== null) recentMessages.edit(after.id, after.content);
    },
    async messageDelete(message) {
      recentMessages.markDeleted(message.id);
    },
    async messageDeleteBulk(messages) {
      for (const message of messages.values()) recentMessages.markDeleted(message.id);
    },
  },

  tasks: {
    // Lifts a temporary ban. This runs from the scheduled task table, not a
    // timer, so a ban issued just before a restart still gets lifted on time.
    // A failed attempt schedules its own retry; see liftTemporaryBan.
    unban: liftTemporaryBan,
  },

  requires: ["ModerateMembers", "KickMembers", "BanMembers", "ManageMessages"],
});
