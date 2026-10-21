import { embedReply, plainReply, s, type Field, type Infer, type MessageBody, type MessageVariable } from "@tier0/core";
import { COMMAND_NAME, PERSON_VARIABLES, optionField, stepField } from "@tier0/workflow";

/** The few steps a custom command offers after it has replied. Anything with branches belongs in Automations. */
const AFTER = stepField(["message", "role", "nickname", "wait"]);

const COMMAND_VARIABLES: MessageVariable[] = [...PERSON_VARIABLES];

const REPLY: MessageBody = plainReply("Hello {user}!");

const NOT_ALLOWED: MessageBody = embedReply("You can't use that here.", "error");
const COOLDOWN: MessageBody = embedReply("Try again {remaining}.", "error");
const FAILED: MessageBody = embedReply("Part of that did not work. Ask an admin to check the command and that I have the permissions it needs.", "error");
const GONE: MessageBody = embedReply("That command has been removed.", "error");

const commandField = s.object({
  id: s.string({ generated: true }),
  command: s.string({
    label: "Command name",
    help: "What members type after the slash, such as rules for /rules. A name the bot already uses is left out.",
    max: 32,
    pattern: COMMAND_NAME,
    section: "command",
  }),
  enabled: s.boolean({ label: "On", default: true, section: "command" }),
  description: s.string({
    label: "What it says in the command list",
    help: "Up to 100 characters.",
    default: "Run this command",
    max: 100,
    section: "command",
  }),
  options: s.array(optionField, {
    label: "Things the member fills in",
    help: "Up to five. Each is a {name} you can use in the reply.",
    item: "option",
    max: 5,
    section: "command",
  }),

  reply: s.choice({
    label: "Who sees the reply",
    options: [
      { value: "private", label: "Only the member" },
      { value: "public", label: "Everyone in the channel" },
    ],
    default: "private",
    control: "segmented",
    section: "reply",
  }),
  message: s.message({
    label: "Reply",
    help: "What the command says. Things the member filled in are there by the name you gave them.",
    starting: REPLY,
    variables: COMMAND_VARIABLES,
    components: false,
    section: "reply",
  }),
  steps: s.array(AFTER, {
    label: "Then do this",
    help: "Optional. Runs in order after the reply, for the member who used the command.",
    item: "step",
    max: 5,
    section: "reply",
  }),

  onlyChannels: s.array(s.channel({ types: ["text"] }), {
    label: "Only in these channels",
    help: "Left empty, anywhere. A channel also covers its threads, and a category the channels in it.",
    max: 25,
    section: "limits",
  }),
  onlyRoles: s.array(s.role(), { label: "Only for members with one of these roles", help: "Left empty, for everyone.", max: 25, section: "limits" }),
  exceptRoles: s.array(s.role(), { label: "Never for members with one of these roles", max: 25, section: "limits" }),
  cooldown: s.duration({
    label: "Wait before the same member can use it again",
    help: "Kept in memory, so a restart lets everyone go again.",
    default: "0s",
    max: "1d",
    section: "limits",
  }),
});

const reply = (label: string, help: string, starting: MessageBody, variables: MessageVariable[] = []): Field<MessageBody> =>
  s.message({ label, help, starting, variables, delivery: "dm", components: false, compact: true, audience: "private", note: "Only the person it is shown to sees this." });

export const settingsSchema = s.object({
  commands: s.array(commandField, {
    label: "Commands",
    help: "Each one is added to this server's slash commands a few seconds after you save, and goes again when you turn it off or remove it.",
    item: "command",
    max: 50,
    layout: "sheet",
    card: { facts: ["reply", "options"] },
    essential: true,
  }),
  messages: s.object(
    {
      notAllowed: reply("Not allowed", "Shown to someone who uses a command in a channel, or with roles, it doesn't allow.", NOT_ALLOWED),
      cooldown: reply("Has to wait", "Shown to someone who uses a command again before its wait is over.", COOLDOWN, [{ name: "remaining", description: "How long until they can use it again", sample: "in 30 seconds" }]),
      failed: reply("A step did not work", "Shown to someone whose command ran into a problem, for example a role the bot cannot give.", FAILED),
      gone: reply("Command was removed", "Shown to someone who uses a command that was removed in the last few minutes.", GONE),
    },
    { label: "Replies and errors", help: "What the bot says when it has to refuse or something goes wrong.", collapsible: true },
  ),
});

export type CustomCommandSettings = Infer<typeof settingsSchema>;
export type CustomCommand = CustomCommandSettings["commands"][number];
