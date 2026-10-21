import { s, type MessageBody, type ObjectField, type Shape } from "@tier0/core";
import { IF_STEPS } from "./layout.js";
import { VARIABLE_NAME, type Compare, type MatchMode } from "./logic.js";
import { STEP_MESSAGE, WORKFLOW_VARIABLES } from "./messages.js";
import type { Change, Scope } from "./values.js";

/**
 * The steps a workflow can carry out, as a setting. Each kind of step has its own
 * fields, shown only while that kind is picked. A module chooses which kinds it
 * offers, so a custom command can have a few simple ones and an automation all of
 * them.
 */

export type StepType =
  | "message"
  | "role"
  | "react"
  | "delete"
  | "pin"
  | "thread"
  | "timeout"
  | "nickname"
  | "voice"
  | "variable"
  | "wait"
  | "run"
  | "ifRole"
  | "ifChannel"
  | "ifWords"
  | "ifVariable"
  | "ifChance"
  | "else"
  | "endif";

export type Target = "member" | "author";

/** What a step holds once read. Everything a kind does not use is left out. */
export interface Step {
  type: StepType;
  where?: "here" | "channel" | "dm";
  channel?: string;
  dmTarget?: Target;
  message?: MessageBody;
  change?: "give" | "take";
  role?: string;
  roleTarget?: Target;
  emoji?: string;
  length?: number;
  reason?: string;
  timeoutTarget?: Target;
  nickname?: string;
  nickTarget?: Target;
  voiceTo?: string;
  voiceTarget?: Target;
  setName?: string;
  setScope?: Scope;
  setHow?: Change;
  setAmount?: number;
  pause?: number;
  workflowName?: string;
  threadName?: string;
  ifRole?: string;
  ifHas?: "has" | "hasNot";
  ifChannel?: string;
  ifIn?: "in" | "notIn";
  ifWords?: string[];
  ifWordMode?: MatchMode;
  testName?: string;
  testScope?: Scope;
  testHow?: Compare;
  testAmount?: number;
  ifChance?: number;
}

const LABELS: Record<StepType, { label: string; description?: string }> = {
  message: { label: "Send a message" },
  role: { label: "Give or take a role" },
  react: { label: "Add a reaction to the message" },
  delete: { label: "Delete the message" },
  pin: { label: "Pin the message" },
  thread: { label: "Start a thread on the message" },
  timeout: { label: "Time a member out" },
  nickname: { label: "Change a nickname" },
  voice: { label: "Move a member to a voice channel", description: "Only a member who is already in a voice channel." },
  variable: { label: "Change a counter", description: "Add to, take from or set a number kept for the member or the server." },
  wait: { label: "Wait, then carry on" },
  run: { label: "Run another workflow" },
  ifRole: { label: "If the member has a role", description: "The steps down to Else or End if run only when it is true." },
  ifChannel: { label: "If it is in a channel" },
  ifWords: { label: "If the message says something" },
  ifVariable: { label: "If a counter is" },
  ifChance: { label: "If a roll comes up", description: "Runs some of the time, as a percentage." },
  else: { label: "Else", description: "The steps from here to End if run when the If above was not true." },
  endif: { label: "End if" },
};

const only = (type: StepType) => ({ field: "type", equals: type, hide: true });

const TARGETS = [
  { value: "member", label: "The member who set it off" },
  { value: "author", label: "The author of the message", description: "The same member unless a reaction set it off." },
];

const target = (label: string, type: StepType) => s.choice({ label, options: TARGETS, default: "member", when: only(type) });

const counterScope = (type: StepType) =>
  s.choice({
    label: "Kept for",
    options: [
      { value: "member", label: "Each member separately" },
      { value: "server", label: "The whole server" },
    ],
    default: "member",
    when: only(type),
  });

const counterName = (type: StepType, label: string) =>
  s.string({
    label,
    help: "Also the {name} you can put in your messages. Lowercase letters, numbers and _.",
    max: 32,
    pattern: VARIABLE_NAME,
    optional: true,
    when: only(type),
  });

const FIELDS: Record<StepType, Shape> = {
  message: {
    where: s.choice({
      label: "Where it goes",
      options: [
        { value: "here", label: "Here", description: "Answers a command, otherwise goes in the channel it happened in." },
        { value: "channel", label: "A channel I pick" },
        { value: "dm", label: "A direct message", description: "Not delivered if their messages are closed." },
      ],
      default: "here",
      when: only("message"),
    }),
    channel: s.channel({ types: ["text"], label: "Channel", optional: true, when: { field: "where", equals: "channel", hide: true } }),
    dmTarget: s.choice({ label: "Send it to", options: TARGETS, default: "member", when: { field: "where", equals: "dm", hide: true } }),
    message: s.message({
      label: "Message",
      help: "Everything the workflow knows is on offer as a {variable}, and so is each counter by its name.",
      starting: STEP_MESSAGE,
      variables: WORKFLOW_VARIABLES,
      components: false,
      when: only("message"),
    }),
  },
  role: {
    change: s.choice({
      label: "What to do",
      options: [
        { value: "give", label: "Give the role" },
        { value: "take", label: "Take the role away" },
      ],
      default: "give",
      when: only("role"),
    }),
    role: s.role({ label: "Role", assigns: true, optional: true, when: only("role") }),
    roleTarget: target("To", "role"),
  },
  react: { emoji: s.emoji({ label: "Emoji", optional: true, when: only("react") }) },
  delete: {},
  pin: {},
  thread: {
    threadName: s.string({
      label: "Thread name",
      help: "Up to 100 characters. {userName}, {authorName} and counters work here.",
      default: "Discussion",
      max: 100,
      when: only("thread"),
    }),
  },
  timeout: {
    length: s.duration({ label: "For how long", help: "Up to 28 days.", default: "10m", min: "1s", max: "28d", when: only("timeout") }),
    reason: s.string({ label: "Reason", help: "Shown in the server's audit log.", default: "Automation", max: 200, when: only("timeout") }),
    timeoutTarget: target("Who", "timeout"),
  },
  nickname: {
    nickname: s.string({
      label: "New nickname",
      help: "Up to 32 characters once filled in. {userName}, {username} and counters work here. Leave it empty to take the nickname off.",
      max: 100,
      optional: true,
      when: only("nickname"),
    }),
    nickTarget: target("Whose", "nickname"),
  },
  voice: {
    voiceTo: s.channel({ types: ["voice"], label: "Move them to", optional: true, when: only("voice") }),
    voiceTarget: target("Who", "voice"),
  },
  variable: {
    setName: counterName("variable", "Counter"),
    setScope: counterScope("variable"),
    setHow: s.choice({
      label: "What to do",
      options: [
        { value: "add", label: "Add" },
        { value: "subtract", label: "Take away" },
        { value: "set", label: "Set it to" },
      ],
      default: "add",
      when: only("variable"),
    }),
    setAmount: s.integer({ label: "Amount", min: 0, max: 1_000_000, default: 1, when: only("variable") }),
  },
  wait: {
    pause: s.duration({
      label: "Wait for",
      help: "Up to an hour. A command that has already replied can't answer after the wait, so a message sent after it goes in the channel.",
      default: "30s",
      min: "1s",
      max: "1h",
      when: only("wait"),
    }),
  },
  run: {
    workflowName: s.string({ label: "Name of the workflow", help: "Written exactly as it is named. It runs for the same member and place, and can go three levels deep.", max: 80, optional: true, when: only("run") }),
  },
  ifRole: {
    ifRole: s.role({ label: "Role", optional: true, when: only("ifRole") }),
    ifHas: s.choice({
      label: "The member",
      options: [
        { value: "has", label: "has it" },
        { value: "hasNot", label: "does not have it" },
      ],
      default: "has",
      when: only("ifRole"),
    }),
  },
  ifChannel: {
    ifChannel: s.channel({ types: ["text"], label: "Channel", help: "A channel also covers its threads, and a category the channels in it.", optional: true, when: only("ifChannel") }),
    ifIn: s.choice({
      label: "It is",
      options: [
        { value: "in", label: "in it" },
        { value: "notIn", label: "not in it" },
      ],
      default: "in",
      when: only("ifChannel"),
    }),
  },
  ifWords: {
    ifWords: s.array(s.string({ max: 100 }), { label: "Words or phrases", help: "Any one is enough. Capitals don't matter.", max: 25, when: only("ifWords") }),
    ifWordMode: s.choice({
      label: "How it has to match",
      options: [
        { value: "contains", label: "Anywhere in the message" },
        { value: "word", label: "As a whole word" },
        { value: "start", label: "At the start" },
        { value: "exact", label: "The whole message" },
      ],
      default: "contains",
      when: only("ifWords"),
    }),
  },
  ifVariable: {
    testName: counterName("ifVariable", "Counter"),
    testScope: counterScope("ifVariable"),
    testHow: s.choice({
      label: "Is",
      options: [
        { value: "equals", label: "equal to" },
        { value: "notEquals", label: "not equal to" },
        { value: "greater", label: "more than" },
        { value: "atLeast", label: "at least" },
        { value: "less", label: "less than" },
        { value: "atMost", label: "at most" },
      ],
      default: "atLeast",
      when: only("ifVariable"),
    }),
    testAmount: s.integer({ label: "Number", min: -1_000_000, max: 1_000_000, default: 1, when: only("ifVariable") }),
  },
  ifChance: {
    ifChance: s.integer({ label: "Chance", help: "As a percentage.", min: 1, max: 100, default: 50, when: only("ifChance") }),
  },
  else: {},
  endif: {},
};

/** A list of steps for a module that offers the given kinds. Choosing "If ..." kinds brings Else and End if with them. */
export function stepField(types: readonly StepType[], first: StepType = types[0] ?? "message"): ObjectField<Shape> {
  const wanted = new Set<StepType>(types);
  if (types.some((type) => (IF_STEPS as readonly string[]).includes(type))) {
    wanted.add("else");
    wanted.add("endif");
  }
  const ordered = (Object.keys(LABELS) as StepType[]).filter((type) => wanted.has(type));
  const shape: Shape = {
    type: s.choice({
      label: "Do this",
      options: ordered.map((type) => ({ value: type, label: LABELS[type].label, ...(LABELS[type].description ? { description: LABELS[type].description } : {}) })),
      default: first,
    }),
  };
  for (const type of ordered) Object.assign(shape, FIELDS[type]);
  return s.object(shape);
}

/** Which kinds a step may be, in the order they are offered. */
export const ALL_STEPS = Object.keys(LABELS) as StepType[];
