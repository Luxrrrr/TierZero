import { s } from "@tier0/core";
import type { Infer } from "@tier0/core";

export const moderationSettings = s.object({
  modLogChannel: s.channel({
    types: ["text"],
    optional: true,
    guided: true,
    label: "Mod log channel",
    help: "Where warn, timeout, kick, ban and unban actions are posted. Left unset, nothing is posted.",
  }),
  dmOnAction: s.boolean({
    default: true,
    guided: true,
    label: "Direct message the member when action is taken",
  }),
  defaultTimeoutDuration: s.duration({
    default: "10m",
    max: "28d",
    guided: true,
    label: "Default timeout length",
    help: "Used when a moderator runs /timeout set without specifying a duration.",
  }),
  requireReason: s.boolean({
    default: false,
    label: "Require a reason for moderation actions",
  }),
  deleteMessageDays: s.integer({
    min: 0,
    max: 7,
    default: 0,
    label: "Days of the banned member's messages to delete",
  }),
});

export type ModerationSettings = Infer<typeof moderationSettings>;
