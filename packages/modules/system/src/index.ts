import { defineModule, s, type Infer, type MessageBody } from "@tier0/core";
import {
  LABEL_DEFAULTS,
  SYSTEM_INFO,
  SYSTEM_MESSAGES,
  SYSTEM_VARIABLES,
  type SystemMessageKey,
} from "./messages.js";

export * from "./messages.js";

export const SYSTEM_MODULE_ID = "system";

const entry = (key: SystemMessageKey) =>
  s.message({
    label: SYSTEM_INFO[key].label,
    help: SYSTEM_INFO[key].help,
    starting: SYSTEM_MESSAGES[key],
    variables: SYSTEM_VARIABLES[key],
    // Each of these answers one person, so there is nothing for a button to do.
    components: false,
    compact: true,
    note: "Only the person it answers sees this.",
  });

const settings = s.object({
  replies: s.object(
    {
      commands: s.object(
        {
          featureOff: entry("featureOff"),
          commandOff: entry("commandOff"),
          channelOff: entry("channelOff"),
          noRole: entry("noRole"),
          commandFailed: entry("commandFailed"),
        },
        { label: "Commands", help: "What members are told when a command will not run." },
      ),
      buttons: s.object(
        {
          roleGone: entry("roleGone"),
          roleTooHigh: entry("roleTooHigh"),
          memberNotFound: entry("memberNotFound"),
          roleChangeFailed: entry("roleChangeFailed"),
          roleGiven: entry("roleGiven"),
          roleTaken: entry("roleTaken"),
          notActive: entry("notActive"),
          componentFailed: entry("componentFailed"),
        },
        { label: "Buttons and menus", help: "What members are told when a role button, a menu or a form does not work as expected." },
      ),
    },
    {
      label: "Replies and errors",
      help: "What the bot says when it turns a request down or something goes wrong. Each is shown only to the person it answers.",
      collapsible: true,
    },
  ),
  labels: s.object(
    {
      unknownRole: s.string({
        label: "Role that no longer exists",
        help: "Shown in a role menu that is limited to particular roles, in place of a role that has since been deleted.",
        default: LABEL_DEFAULTS.unknownRole,
        max: 100,
      }),
      unknownChannel: s.string({
        label: "Channel that no longer exists",
        help: "Shown in a channel menu that is limited to particular channels, in place of one that has since been deleted.",
        default: LABEL_DEFAULTS.unknownChannel,
        max: 100,
      }),
      webhookName: s.string({
        label: "Name of the webhook for messages sent under another name",
        help: "Discord shows this on the webhook in the channel's integrations. The bot finds its webhook by this name, so changing it makes a new webhook the next time a message is sent that way.",
        default: LABEL_DEFAULTS.webhookName,
        max: 80,
      }),
      defaultSender: s.string({
        label: "Who a message from the dashboard comes from",
        help: "What {sender} becomes in a message you send from the Message creator when you do not give a sender.",
        default: LABEL_DEFAULTS.defaultSender,
        max: 80,
      }),
      timeoutRemovalReason: s.template({
        label: "Reason on the Discord timeout lifted from the dashboard",
        help: "Written to the server's audit log when a case is removed on the dashboard and its timeout is lifted. Discord keeps at most 512 characters.",
        default: LABEL_DEFAULTS.timeoutRemovalReason,
        max: 512,
        placeholders: ["case", "actor"],
      }),
      banRemovalReason: s.template({
        label: "Reason on the Discord ban lifted from the dashboard",
        help: "Written to the server's audit log when a ban case is removed on the dashboard and the member is unbanned. Discord keeps at most 512 characters.",
        default: LABEL_DEFAULTS.banRemovalReason,
        max: 512,
        placeholders: ["case", "actor"],
      }),
    },
    {
      label: "Labels and text",
      help: "Short pieces of text the bot sets itself. Discord limits how long each can be.",
      collapsible: true,
    },
  ),
});

export type SystemSettings = Infer<typeof settings>;

/** The owner's version of one message, wherever the settings keep it. */
export function systemMessage(settings: SystemSettings, key: SystemMessageKey): MessageBody {
  const { commands, buttons } = settings.replies;
  return key in commands ? commands[key as keyof typeof commands] : buttons[key as keyof typeof buttons];
}

/**
 * The bot's own text. Always on: it belongs to the router and to the dashboard
 * rather than to a feature an owner chooses, so there is no switch and a server
 * that never opened this page runs on the defaults.
 */
export default defineModule({
  id: SYSTEM_MODULE_ID,
  name: "Bot replies",
  summary: "What the bot says on its own account: refusals, errors and the labels it sets itself.",
  category: "more",
  alwaysOn: true,
  settings,
});
