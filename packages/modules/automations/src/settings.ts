import { s, type Infer } from "@tier0/core";
import { ALL_STEPS, TIME, ZONES, stepField } from "@tier0/workflow";

const WHEN = "when";
const CONDITIONS = "conditions";
const STEPS = "steps";

const triggerIs = (value: string) => ({ field: "trigger", equals: value, hide: true });

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const workflowField = s.object({
  id: s.string({ generated: true }),
  name: s.string({
    label: "Name",
    help: "Shown only to you, and what a \"Run another workflow\" step looks for.",
    default: "New workflow",
    max: 80,
    section: WHEN,
  }),
  enabled: s.boolean({ label: "On", default: true, section: WHEN }),
  trigger: s.choice({
    label: "When this happens",
    options: [
      { value: "memberJoin", label: "A member joins the server" },
      { value: "memberLeave", label: "A member leaves the server" },
      { value: "message", label: "A message says something", description: "Needs the bot to read the channel." },
      { value: "reaction", label: "Someone adds a reaction" },
      { value: "role", label: "A member gets or loses a role" },
      { value: "voice", label: "A member joins or leaves a voice channel" },
      { value: "thread", label: "A thread is started" },
      { value: "boost", label: "A member boosts the server" },
      { value: "ban", label: "A member is banned" },
      { value: "schedule", label: "On a schedule", description: "Every hour, day or week at a time you pick. There is no member, so steps that need one have nobody to act on." },
    ],
    default: "memberJoin",
    section: WHEN,
  }),

  phrases: s.array(s.string({ max: 100 }), {
    label: "Words or phrases",
    help: "Any one of them is enough. Capitals don't matter.",
    max: 25,
    when: triggerIs("message"),
    section: WHEN,
  }),
  matchMode: s.choice({
    label: "How it has to match",
    options: [
      { value: "contains", label: "Anywhere in the message" },
      { value: "word", label: "As a whole word" },
      { value: "start", label: "At the start" },
      { value: "exact", label: "The whole message" },
    ],
    default: "contains",
    when: triggerIs("message"),
    section: WHEN,
  }),

  reactionEmoji: s.emoji({ label: "Emoji", help: "Left empty, any reaction counts.", optional: true, when: triggerIs("reaction"), section: WHEN }),

  roleChange: s.choice({
    label: "What happens to the role",
    options: [
      { value: "gained", label: "They get it" },
      { value: "lost", label: "They lose it" },
    ],
    default: "gained",
    control: "segmented",
    when: triggerIs("role"),
    section: WHEN,
  }),
  watchedRole: s.role({ label: "Role", optional: true, when: triggerIs("role"), section: WHEN }),

  voiceChange: s.choice({
    label: "What they do",
    options: [
      { value: "joined", label: "Join a voice channel" },
      { value: "left", label: "Leave voice" },
    ],
    default: "joined",
    control: "segmented",
    when: triggerIs("voice"),
    section: WHEN,
  }),

  every: s.choice({
    label: "How often",
    options: [
      { value: "hour", label: "Every hour", description: "At the minutes of the time below." },
      { value: "day", label: "Every day" },
      { value: "week", label: "Every week" },
    ],
    default: "day",
    when: triggerIs("schedule"),
    section: WHEN,
  }),
  weekday: s.choice({
    label: "On",
    options: WEEKDAYS.map((label, index) => ({ value: String(index), label })),
    default: "1",
    when: triggerIs("schedule"),
    section: WHEN,
  }),
  time: s.string({
    label: "At",
    help: "Hours and minutes, such as 20:00, in the server's time zone set below. For every hour only the minutes count.",
    default: "20:00",
    max: 5,
    pattern: TIME,
    when: triggerIs("schedule"),
    section: WHEN,
  }),

  onlyChannels: s.array(s.channel({ types: ["text", "voice"] }), {
    label: "Only in these channels",
    help: "Left empty, anywhere. A channel also covers its threads and, for a category, the channels in it. Not used when someone joins, leaves, boosts or is banned, or on a schedule.",
    max: 25,
    section: CONDITIONS,
  }),
  onlyRoles: s.array(s.role(), { label: "Only for members with one of these roles", help: "Left empty, for everyone.", max: 25, section: CONDITIONS }),
  exceptRoles: s.array(s.role(), { label: "Never for members with one of these roles", max: 25, section: CONDITIONS }),
  chance: s.integer({ label: "Chance it runs", help: "As a percentage, each time it could.", min: 1, max: 100, default: 100, section: CONDITIONS }),
  cooldown: s.duration({
    label: "Wait before the same member can set it off again",
    help: "Kept in memory, so a restart lets everyone go again.",
    default: "0s",
    max: "1d",
    section: CONDITIONS,
  }),

  steps: s.array(stepField(ALL_STEPS, "message"), {
    label: "Then do this",
    help: "Steps run in order, from the top. An If skips to its Else or End if when it is not true, so keep each If closed with an End if.",
    item: "step",
    min: 1,
    max: 40,
    section: STEPS,
  }),
});

export const settingsSchema = s.object({
  timeZone: s.choice({
    label: "Time zone",
    help: "Used for the times of day on a schedule.",
    options: ZONES.map(([value, label]) => ({ value, label })),
    default: "UTC",
  }),
  workflows: s.array(workflowField, {
    label: "Workflows",
    help: "Each one waits for something to happen and then runs its steps.",
    item: "workflow",
    max: 50,
    layout: "sheet",
    card: { facts: ["trigger", "steps"] },
    essential: true,
  }),
});

export type AutomationSettings = Infer<typeof settingsSchema>;
export type Workflow = AutomationSettings["workflows"][number];
