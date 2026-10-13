import { s } from "@tier0/core";
import type { Infer } from "@tier0/core";
import { DM_MESSAGE, DM_NOTE, DM_VARIABLES, MODLOG_MESSAGE, MODLOG_NOTE, MODLOG_VARIABLES } from "./messages.js";

export const moderationSettings = s.object({
  modLogChannel: s.channel({
    types: ["text"],
    optional: true,
    guided: true,
    label: "Mod log channel",
    help: "Where warn, timeout, kick, ban and unban actions are posted. Left unset, nothing is posted.",
  }),
  modLogMessage: s.message({
    label: "Mod log post",
    starting: MODLOG_MESSAGE,
    variables: MODLOG_VARIABLES,
    note: MODLOG_NOTE,
    when: { field: "modLogChannel" },
  }),
  dashboardUrl: s.string({
    optional: true,
    origin: true,
    label: "Dashboard address",
    help: "The address you open this dashboard at, such as https://bot.example.com. Leave it blank and the bot uses the address you last opened the dashboard at. It is used for the View in dashboard button on mod log posts.",
  }),
  dmOnAction: s.boolean({
    default: true,
    guided: true,
    label: "Direct message the member when action is taken",
    help: "The moderator's reason is sent to the member exactly as written, and it is also the reason kept on the case. Keep notes meant only for staff out of it.",
  }),
  dmMessage: s.message({
    label: "Direct message to the member",
    starting: DM_MESSAGE,
    variables: DM_VARIABLES,
    delivery: "dm",
    help: "{reason} is the reason the moderator typed, sent as written. The default does not name the moderator. {moderator} and {moderatorId} are available if you want them shown.",
    note: DM_NOTE,
    when: { field: "dmOnAction", equals: true },
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
