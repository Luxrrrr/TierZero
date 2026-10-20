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
    section: "basics",
  }),
  emoji: s.emoji({ label: "Emoji", optional: true, section: "basics" }),
  handlers: s.array(s.role(), {
    label: "Handlers",
    help: "Who answers these tickets. These roles see and work them, in Discord and in the dashboard.",
    unique: true,
    nudge: "No handlers yet",
    section: "people",
  }),
  form: s.array(questionField, {
    label: "Questions",
    help: "Asked in a form before the ticket opens. With none, the ticket opens straight away.",
    max: FORM_QUESTION_MAX,
    item: "question",
    section: "form",
    formPreview: { kind: "modal", title: "name", label: "label", placeholder: "placeholder", style: "style", required: "required" },
  }),
  welcome: s.message({
    label: "First message in the ticket",
    note: "Only the roles picked under \"Who to ping when a ticket opens\" are notified, and {pingRoles} names them, so keep it in the text. A member opening a ticket pings themselves and those roles; a ticket staff open from the dashboard pings neither the staff member nor the roles unless they tick Notify the handlers. The Close and Claim buttons are added under it for you.",
    starting: OPENED_MESSAGE,
    variables: WELCOME_VARIABLES,
    components: false,
    section: "messages",
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
    section: "messages",
  }),
  appearance: s.object(
    {
      buttonLabel: s.string({
        label: "Button text",
        help: "Leave empty to use the type's name.",
        optional: true,
        max: 80,
      }),
      buttonStyle: s.choice({
        label: "Button colour",
        control: "swatches",
        options: [
          { value: "primary", label: "Blurple", swatch: "#5865f2" },
          { value: "secondary", label: "Grey", swatch: "#4e5058" },
          { value: "success", label: "Green", swatch: "#248046" },
          { value: "danger", label: "Red", swatch: "#da373c" },
        ],
        default: "primary",
      }),
      description: s.string({ label: "Menu description", help: "Shown under the name when the panel is a menu.", optional: true, max: 100 }),
    },
    { label: "On the panel", section: "basics" },
  ),
  opening: s.object(
    {
      mode: s.choice({
        label: "Open tickets as",
        options: [
          { value: "channel", label: "Private channel", description: "Created in the category below.", recommended: true },
          {
            value: "thread",
            label: "Private thread",
            description:
              "Under the panel's channel. Needs no category and has no channel limit. Discord only lets people into a private thread when they are added, so the bot adds the handlers one by one and each of them is notified. To let a support role see every thread without that, give it Manage Threads on the panel's channel in Discord. That also lets it archive, lock and delete threads.",
          },
        ],
        control: "segmented",
        default: "channel",
        section: "basics",
      }),
      category: s.channel({
        types: ["category"],
        optional: true,
        essential: true,
        label: "Category",
        help: "Ticket channels are created under it. Discord allows 50 channels in a category.",
        when: { field: "mode", equals: "channel", hide: true },
        section: "basics",
      }),
      overflowCategory: s.channel({
        types: ["category"],
        optional: true,
        label: "Overflow category",
        help: "Used once the first category is full, or when it is not set or was deleted.",
        when: { field: "mode", equals: "channel", hide: true },
        section: "basics",
      }),
      channelName: s.template({
        label: "Channel name",
        help: "Leave empty to use the name pattern in General.",
        optional: true,
        placeholders: CHANNEL_NAME_PLACEHOLDERS,
        samples: CHANNEL_NAME_SAMPLES,
        preview: "channel",
        max: 90,
        section: "basics",
      }),
      observers: s.array(s.role(), {
        label: "Observers",
        help: "Roles that can read and write in these tickets in Discord but do not handle them. In a thread, the bot adds up to 50 members of these roles, the handlers and the admin roles.",
        unique: true,
        section: "people",
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
        section: "people",
      }),
      pingRoles: s.array(s.role(), {
        label: "Roles to ping",
        unique: true,
        when: { field: "ping", equals: "roles", hide: true },
        section: "people",
      }),
    },
    { label: "Where tickets open", tabLabels: { basics: "Where tickets open", people: "Who is told and who can watch" } },
  ),
  rules: s.object(
    {
      allowedRoles: s.array(s.role(), {
        label: "Roles that may open this type",
        help: "Leave empty to let everyone open it.",
        unique: true,
        section: "people",
      }),
      blockedRoles: s.array(s.role(), { label: "Roles that may not open this type", unique: true, section: "people" }),
      limit: s.integer({
        label: "Open tickets of this type per member",
        help: "Leave empty to use the limit in General.",
        optional: true,
        min: 1,
        max: 10,
        section: "rules",
      }),
      cooldown: s.duration({
        label: "Wait between tickets",
        help: "How long a member waits after opening one of these before opening another. Leave empty for no wait.",
        optional: true,
        max: "30d",
        section: "rules",
      }),
      claim: s.boolean({ label: "Staff can claim these tickets", default: true, section: "rules" }),
      openerCanClose: s.boolean({ label: "The opener can close their own ticket", default: true, section: "rules" }),
      requireReason: s.boolean({ label: "Ask for a reason when closing", default: false, section: "rules" }),
      reopenNeedsStaff: s.boolean({
        label: "Only staff can reopen",
        help: "Off, the opener can reopen a closed ticket from its Reopen button.",
        default: false,
        section: "rules",
      }),
    },
    { label: "Who can open it, and how it is worked", tabLabels: { people: "Who can open it", rules: "Limits and behaviour" } },
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
        when: { field: "autoClose", equals: "custom", hide: true },
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
    { label: "Different from the general settings", section: "rules" },
  ),
  id: s.string({ generated: true }),
});

export const panelField = s.object(
  {
    name: s.string({
      label: "Name",
      help: "Only shown in the dashboard, to tell panels apart.",
      default: "Support",
      min: 1,
      max: 80,
      step: "where",
    }),
    channel: s.channel({
      types: ["text"],
      optional: true,
      essential: true,
      label: "Channel",
      help: "Where the panel is posted. Ticket threads are created here too.",
      step: "where",
    }),
    style: s.choice({
      label: "Members open a ticket with",
      control: "segmented",
      options: [
        { value: "buttons", label: "Buttons", description: "One button for each ticket type, five to a row." },
        { value: "menu", label: "Menu", description: "One drop-down holding every ticket type. Better for many types." },
      ],
      default: "buttons",
      step: "where",
    }),
    placeholder: s.string({
      label: "Menu placeholder",
      help: "The grey text in the menu before anyone picks.",
      default: "Choose what you need help with",
      max: 150,
      when: { field: "style", equals: "menu", hide: true },
      step: "where",
    }),
    message: s.message({
      label: "Panel message",
      note: "The buttons or menu members use to open a ticket are added under this message for you.",
      starting: PANEL_MESSAGE,
      components: false,
      step: "see",
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
        add: false,
      },
    }),
    types: s.array(typeField, {
      label: "Ticket types",
      help: "Each one is a button or a menu option. Open one to set who handles it, what it asks and its rules.",
      min: 1,
      max: PANEL_TYPE_MAX,
      item: "ticket type",
      layout: "sheet",
      card: {
        emoji: "emoji",
        swatch: "appearance.buttonStyle",
        chips: "handlers",
        facts: ["form", "opening.mode"],
      },
      step: "types",
    }),
    id: s.string({ generated: true }),
  },
  {
    steps: [
      { id: "where", title: "Where it goes", help: "Pick the channel, and whether members open a ticket with buttons or a menu." },
      { id: "see", title: "What members see", help: "The message in the channel. Click one of its buttons to change that ticket type." },
      { id: "types", title: "Ticket types", help: "One for each kind of ticket members can open." },
    ],
  },
);

export type FormQuestion = Infer<typeof questionField>;
export type TicketType = Infer<typeof typeField>;
export type TicketPanel = Infer<typeof panelField>;
