import { s, type Infer } from "@tier0/core";
import { CHANNEL_NAME_PLACEHOLDERS, CHANNEL_NAME_SAMPLES } from "./naming.js";
import { OPENED_MESSAGE, PANEL_MESSAGE, WELCOME_VARIABLES } from "./messages.js";
import { SHORTEST_WAIT } from "./upgrade.js";

/**
 * The shape of a panel and of the ticket types on it. Free of discord.js so
 * the settings can be parsed and tested on their own.
 */

/** Discord allows five components in a text input modal. */
export const FORM_QUESTION_MAX = 5;
/** Discord allows 25 options in a select menu, and the panel lays buttons out five to a row up to the same count. */
export const PANEL_TYPE_MAX = 25;
export const PANEL_MAX = 25;

export const questionField = s.object({
  label: s.string({
    label: "Question",
    help: "Discord allows 45 characters.",
    default: "What do you need help with?",
    min: 1,
    max: 45,
  }),
  placeholder: s.string({ label: "Placeholder", help: "Grey text in the empty box.", optional: true, max: 100 }),
  style: s.choice({
    label: "Answer box",
    options: [
      { value: "short", label: "One line" },
      { value: "paragraph", label: "Several lines" },
    ],
    default: "paragraph",
  }),
  required: s.boolean({ label: "Must be answered", default: true }),
  minLength: s.integer({ label: "Shortest answer", help: "In characters. Leave empty for no minimum.", optional: true, min: 0, max: 4000 }),
  maxLength: s.integer({ label: "Longest answer", help: "In characters. Leave empty for Discord's limit of 4000.", optional: true, min: 1, max: 4000 }),
});

export const typeField = s.object({
  name: s.string({
    label: "Name",
    help: "What the button or menu option says, and how staff see the type in the dashboard.",
    default: "Support",
    min: 1,
    max: 80,
  }),
  emoji: s.emoji({ label: "Emoji", optional: true }),
  handlers: s.array(s.role(), {
    label: "Handlers",
    help: "Roles that see and work this type's tickets, in Discord and in the dashboard.",
    unique: true,
  }),
  form: s.array(questionField, {
    label: "Questions",
    help: "Asked in a form before the ticket opens. With none, the ticket opens straight away.",
    max: FORM_QUESTION_MAX,
  }),
  welcome: s.message({
    label: "First message in the ticket",
    note: "Only the roles picked under \"Who to ping when a ticket opens\" are notified, and {pingRoles} names them, so keep it in the text. The Close and Claim buttons are added under it for you.",
    starting: OPENED_MESSAGE,
    variables: WELCOME_VARIABLES,
    components: false,
    compact: true,
    attach: {
      kind: "buttons",
      buttons: [
        { name: "Close", label: "/labels.closeButton", style: "/labels.closeButtonStyle" },
        { name: "Claim", label: "/labels.claimButton", style: "/labels.claimButtonStyle", when: "rules.claim" },
      ],
    },
  }),
  showAnswers: s.boolean({
    label: "Show the answers under the first message",
    help: "Adds each question and its answer as a field of the first embed.",
    default: true,
  }),
  appearance: s.object(
    {
      description: s.string({ label: "Menu description", help: "Shown under the name when the panel is a menu.", optional: true, max: 100 }),
      buttonStyle: s.choice({
        label: "Button colour",
        options: [
          { value: "primary", label: "Blurple" },
          { value: "secondary", label: "Grey" },
          { value: "success", label: "Green" },
          { value: "danger", label: "Red" },
        ],
        default: "primary",
      }),
      buttonLabel: s.string({
        label: "Button text",
        help: "Leave empty to use the type's name.",
        optional: true,
        max: 80,
      }),
    },
    { label: "On the panel" },
  ),
  opening: s.object(
    {
      mode: s.choice({
        label: "Open tickets as",
        options: [
          { value: "channel", label: "A private channel", description: "Created in the category below.", recommended: true },
          { value: "thread", label: "A private thread", description: "Under the panel's channel. Needs no category and has no channel limit." },
        ],
        default: "channel",
      }),
      category: s.channel({
        types: ["category"],
        optional: true,
        essential: true,
        label: "Category",
        help: "Ticket channels are created under it. Discord allows 50 channels in a category.",
        when: { field: "mode", equals: "channel" },
      }),
      overflowCategory: s.channel({
        types: ["category"],
        optional: true,
        label: "Overflow category",
        help: "Used once the first category is full, or when it is not set or was deleted.",
        when: { field: "mode", equals: "channel" },
      }),
      channelName: s.template({
        label: "Channel name",
        help: "Leave empty to use the name pattern in General.",
        optional: true,
        placeholders: CHANNEL_NAME_PLACEHOLDERS,
        samples: CHANNEL_NAME_SAMPLES,
        preview: "channel",
        max: 90,
      }),
      ping: s.choice({
        label: "Who to ping when a ticket opens",
        help: "Only these roles are notified by mentions in the first message. {pingRoles} puts them in the text, as the first message does unless it was reworded.",
        options: [
          { value: "handlers", label: "The handlers" },
          { value: "roles", label: "Other roles" },
          { value: "none", label: "Nobody" },
        ],
        default: "handlers",
      }),
      pingRoles: s.array(s.role(), { label: "Roles to ping", unique: true, when: { field: "ping", equals: "roles" } }),
      observers: s.array(s.role(), {
        label: "Observers",
        help: "Roles that can read and write in these tickets in Discord but do not handle them. In a thread, the bot adds up to 50 members of these roles, the handlers and the admin roles.",
        unique: true,
      }),
    },
    { label: "Where tickets open" },
  ),
  rules: s.object(
    {
      allowedRoles: s.array(s.role(), {
        label: "Roles that may open this type",
        help: "Leave empty to let everyone open it.",
        unique: true,
      }),
      blockedRoles: s.array(s.role(), { label: "Roles that may not open this type", unique: true }),
      limit: s.integer({
        label: "Open tickets of this type per member",
        help: "Leave empty to use the limit in General.",
        optional: true,
        min: 1,
        max: 10,
      }),
      cooldown: s.duration({
        label: "Wait between tickets",
        help: "How long a member waits after opening one of these before opening another. Leave empty for no wait.",
        optional: true,
        max: "30d",
      }),
      claim: s.boolean({ label: "Staff can claim these tickets", default: true }),
      openerCanClose: s.boolean({ label: "The opener can close their own ticket", default: true }),
      requireReason: s.boolean({ label: "Ask for a reason when closing", default: false }),
      reopenNeedsStaff: s.boolean({
        label: "Only staff can reopen",
        help: "Off, the opener can reopen a closed ticket from its Reopen button.",
        default: false,
      }),
    },
    { label: "Who can open it, and how it is worked" },
  ),
  overrides: s.object(
    {
      autoClose: s.choice({
        label: "Close inactive tickets",
        options: [
          { value: "inherit", label: "As set in Automation" },
          { value: "off", label: "Never" },
          { value: "custom", label: "After a time of its own" },
        ],
        default: "inherit",
      }),
      autoCloseAfter: s.duration({
        label: "Close after this much inactivity",
        help: "At least a minute.",
        default: "24h",
        max: "30d",
        min: SHORTEST_WAIT,
        when: { field: "autoClose", equals: "custom" },
      }),
      transcriptChannel: s.channel({
        types: ["text"],
        optional: true,
        label: "Transcript channel",
        help: "Where this type's transcript files and closed-ticket summaries go. Leave empty to use the log channel in Transcripts.",
      }),
      rating: s.choice({
        label: "Ask the opener for a rating",
        options: [
          { value: "inherit", label: "As set in Ratings" },
          { value: "on", label: "Yes" },
          { value: "off", label: "No" },
        ],
        default: "inherit",
      }),
    },
    { label: "Different from the general settings" },
  ),
  id: s.string({ generated: true }),
});

export const panelField = s.object({
  name: s.string({
    label: "Name",
    help: "Only shown in the dashboard, to tell panels apart.",
    default: "Support",
    min: 1,
    max: 80,
  }),
  channel: s.channel({
    types: ["text"],
    optional: true,
    essential: true,
    label: "Channel",
    help: "Where the panel is posted. Ticket threads are created here too.",
  }),
  types: s.array(typeField, {
    label: "Ticket types",
    help: "One button or menu option each.",
    min: 1,
    max: PANEL_TYPE_MAX,
  }),
  message: s.message({
    label: "Panel message",
    note: "The buttons or menu members use to open a ticket are added under this message for you.",
    starting: PANEL_MESSAGE,
    components: false,
    attach: {
      kind: "list",
      list: "types",
      label: "appearance.buttonLabel",
      labelFallback: "name",
      emoji: "emoji",
      style: "appearance.buttonStyle",
      description: "appearance.description",
      mode: { field: "style", menu: "menu" },
      placeholder: "placeholder",
      noun: "ticket type",
    },
  }),
  style: s.choice({
    label: "Members pick a type from",
    options: [
      { value: "buttons", label: "Buttons", description: "Five to a row." },
      { value: "menu", label: "A menu", description: "Better for many types." },
    ],
    default: "buttons",
  }),
  placeholder: s.string({
    label: "Menu placeholder",
    default: "Choose what you need help with",
    max: 150,
    when: { field: "style", equals: "menu" },
  }),
  id: s.string({ generated: true }),
});

export type FormQuestion = Infer<typeof questionField>;
export type TicketType = Infer<typeof typeField>;
export type TicketPanel = Infer<typeof panelField>;
