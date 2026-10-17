/**
 * The Tickets quick setup's answers, read from and written into the module's
 * settings. It asks about the first panel's first ticket type only: that is
 * what a server with no tickets yet has, and anything beyond it belongs to
 * the full settings. Free of React so the tests can import it.
 */

import { generatedId } from "@tier0/core";

type Settings = Record<string, unknown>;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry !== ""))] : [];

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

export type OpeningMode = "channel" | "thread";

export interface SetupAnswers {
  /** The channel the panel is posted in. */
  channelId: string | undefined;
  /** The roles that answer tickets of the first type. */
  handlers: string[];
  mode: OpeningMode;
  /** Where private channels are created, when tickets open as channels. */
  category: string | undefined;
  /** Where transcripts and closed-ticket summaries go, optional. */
  logChannel: string | undefined;
}

export const EMPTY_ANSWERS: Readonly<SetupAnswers> = {
  channelId: undefined,
  handlers: [],
  mode: "channel",
  category: undefined,
  logChannel: undefined,
};

/** What the settings hold now, so the questions start with the answers a server already gave. */
export function readAnswers(settings: Settings): SetupAnswers {
  const panels = Array.isArray(settings.panels) ? settings.panels : [];
  const panel = record(panels[0]);
  const types = Array.isArray(panel.types) ? panel.types : [];
  const type = record(types[0]);
  const opening = record(type.opening);
  return {
    channelId: text(panel.channel),
    handlers: texts(type.handlers),
    mode: opening.mode === "thread" ? "thread" : "channel",
    category: text(opening.category),
    logChannel: text(record(settings.transcripts).logChannel),
  };
}

/** Whether the settings hold more than the quick setup edits, so the page can say where the rest is. */
export function hasMoreThanSetupEdits(settings: Settings): boolean {
  const panels = Array.isArray(settings.panels) ? settings.panels : [];
  const types = Array.isArray(record(panels[0]).types) ? (record(panels[0]).types as unknown[]) : [];
  return panels.length > 1 || types.length > 1;
}

/**
 * The settings with the answers written in. The first panel and type are
 * created when there are none; everything else is passed through untouched,
 * including every other panel and type.
 */
export function applyAnswers(settings: Settings, answers: SetupAnswers): Settings {
  const panels = Array.isArray(settings.panels) ? [...settings.panels] : [];
  const panel = record(panels[0]);
  const types = Array.isArray(panel.types) ? [...panel.types] : [];
  const type = record(types[0]);
  const opening: Record<string, unknown> = { ...record(type.opening), mode: answers.mode };
  if (answers.mode === "channel") {
    if (answers.category) opening.category = answers.category;
    else delete opening.category;
  }

  const nextType: Record<string, unknown> = {
    ...type,
    id: text(type.id) ?? generatedId(),
    name: text(type.name) ?? "Support",
    handlers: answers.handlers,
    opening,
  };
  types[0] = nextType;
  const nextPanel: Record<string, unknown> = { ...panel, id: text(panel.id) ?? generatedId(), name: text(panel.name) ?? "Support", types };
  if (answers.channelId) nextPanel.channel = answers.channelId;
  else delete nextPanel.channel;
  panels[0] = nextPanel;

  const transcripts = { ...record(settings.transcripts) };
  if (answers.logChannel) transcripts.logChannel = answers.logChannel;
  else delete transcripts.logChannel;

  return { ...settings, panels, transcripts };
}

export type SetupQuestion = "channel" | "handlers" | "category";

/** The questions still unanswered, in the order they are asked. A thread ticket needs no category. */
export function unanswered(answers: SetupAnswers): SetupQuestion[] {
  const missing: SetupQuestion[] = [];
  if (!answers.channelId) missing.push("channel");
  if (answers.handlers.length === 0) missing.push("handlers");
  if (answers.mode === "channel" && !answers.category) missing.push("category");
  return missing;
}

const QUESTION_WORDS: Record<SetupQuestion, string> = {
  channel: "the panel's channel",
  handlers: "the roles that answer",
  category: "a category for the ticket channels",
};

/** "the panel's channel and the roles that answer", for the line saying what the button is waiting on. */
export function unansweredSentence(missing: readonly SetupQuestion[]): string {
  const words = missing.map((question) => QUESTION_WORDS[question]);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The address of a posted panel message in Discord. */
export function messageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
