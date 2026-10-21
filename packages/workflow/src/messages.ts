import { plainReply, type MessageBody, type MessageVariable } from "@tier0/core";

/**
 * The values a workflow's messages are filled from, and what a new message step
 * says. Free of discord.js so it can be tested on its own.
 */

const variable = (name: string, description: string, sample: string): MessageVariable => ({ name, description, sample });

/** What every kind of workflow knows about who it is for. */
export const PERSON_VARIABLES: MessageVariable[] = [
  variable("user", "Who it happened to or who ran it, as a mention", "@Ada"),
  variable("userName", "Their name on the server", "Ada"),
  variable("username", "Their account name", "ada"),
  variable("userId", "Their id", "123456789012345678"),
  variable("channel", "The channel it happened in, as a link", "#general"),
  variable("channelName", "The channel's name", "general"),
];

/** What only some triggers have. The rest leave them empty. */
export const EVENT_VARIABLES: MessageVariable[] = [
  variable("message", "What the message said, for a message that matched", "hello there"),
  variable("messageLink", "A link to the message, when there is one", "https://discord.com/channels/1/2/3"),
  variable("author", "Who wrote the message, as a mention", "@Grace"),
  variable("authorName", "Their name on the server", "Grace"),
  variable("emoji", "The emoji that was used, for a reaction", "🎉"),
  variable("role", "The role's name, for a role that was gained or lost", "Gamers"),
  variable("roleMention", "The role as a mention", "@Gamers"),
];

export const WORKFLOW_VARIABLES: MessageVariable[] = [...PERSON_VARIABLES, ...EVENT_VARIABLES];

/** What the first message of a new step says, so a step is never blank. */
export const STEP_MESSAGE: MessageBody = plainReply("Hello {user}!");
