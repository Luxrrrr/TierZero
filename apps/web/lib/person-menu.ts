import { canTakeAction, type EvidenceRef, type ModActionKind, type StaffRole } from "@tier0/shared-moderation";
import type { ActionOption } from "../app/guilds/[id]/mod/members/[userId]/actions";

/**
 * What the right-click menu on a person or a message offers. Which actions
 * appear, and which are greyed out and why, come from the same rules as the
 * Take action button on a member's record (`actionOptions`), so the two never
 * disagree. Nothing here grants anything: the bot checks every request again.
 */

export type MenuIconKey = ModActionKind | "profile" | "copy" | "external" | "reply";

export type MenuEffect =
  | { type: "action"; kind: ModActionKind }
  | { type: "href"; href: string; external: boolean }
  | { type: "copy"; text: string; done: string }
  /** Does something in the page the menu belongs to, then closes. */
  | { type: "run"; run: () => void };

export interface MenuEntry {
  id: string;
  label: string;
  icon: MenuIconKey;
  effect: MenuEffect;
  /** Why the entry cannot be used right now, shown as a second line. Null when it can. */
  hint: string | null;
  disabled: boolean;
  /** Kicks and bans remove the member, so they read as the heavy choices. */
  danger: boolean;
  /** Starts a new group, drawn with a divider above it. */
  separated: boolean;
}

/** Who a menu is about. Only what the menu needs, so any user shape can be reduced to it. */
export interface MenuUser {
  userId: string;
  name: string | null;
  inServer: boolean;
  /** A bot or a webhook rather than a member. Moderation entries stay greyed out for these. */
  app?: boolean;
}

export interface MessageRef {
  channelId: string;
  messageId: string;
  content: string;
  /** Where the page can answer this message, as in a ticket. Adds a Reply entry first. */
  onReply?: () => void;
}

export const CHECKING_HINT = "Checking what you can do";
export const APP_HINT = "Apps and webhooks are not members of the server";
const NO_TEXT_HINT = "This message has no text to copy";

const SNOWFLAKE = /^\d{17,20}$/;

/** Whether a user can have a menu at all: a real Discord id, and not the bot acting as automod. */
export function isMenuUser(user: { userId: string; automod?: boolean }): boolean {
  return !user.automod && SNOWFLAKE.test(user.userId);
}

/** The name shown in dialogs and toasts, the same fallback the chips use for an account Discord no longer knows. */
export const menuName = (user: Pick<MenuUser, "userId" | "name">) => user.name ?? `User ${user.userId.slice(-4)}`;

export const profileHref =(guildId: string, userId: string) => `/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}`;

export const caseHref = (guildId: string, userId: string, caseNumber: number) => `${profileHref(guildId, userId)}?case=${caseNumber}`;

export const discordProfileUrl = (userId: string) => `https://discord.com/users/${userId}`;

/** The link Discord's own Copy Message Link gives. */
export const messageLink = (guildId: string, channelId: string, messageId: string) =>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/** The message as the pair the bot copies into the case before it acts. */
export function messageEvidence(message: Pick<MessageRef, "channelId" | "messageId">): EvidenceRef[] {
  return [{ channelId: message.channelId, messageId: message.messageId }];
}

/**
 * The reason with the message's link on its own line, which is what the
 * right-click commands in Discord do when the message cannot be copied into
 * the case. Kept inside the reason limit by shortening what was typed, never
 * the link.
 */
export function reasonWithMessageLink(reason: string, link: string, limit = 500): string {
  const line = `Message: ${link}`;
  const typed = reason.trim();
  if (typed === "") return line.slice(0, limit);
  const room = limit - line.length - 1;
  if (room <= 0) return line.slice(0, limit);
  return `${typed.length > room ? typed.slice(0, room).trimEnd() : typed}\n${line}`;
}

const ACTIONS_ON_AUTHOR: readonly ModActionKind[] = ["warn", "timeout", "kick", "ban"];
const AUTHOR_LABEL: Partial<Record<ModActionKind, string>> = {
  warn: "Warn author",
  timeout: "Timeout author",
  kick: "Kick author",
  ban: "Ban author",
};

function actionEntry(option: ActionOption, label: string): MenuEntry {
  return {
    id: `action:${option.kind}`,
    label,
    icon: option.kind,
    effect: { type: "action", kind: option.kind },
    hint: option.unavailable,
    disabled: option.unavailable !== null,
    danger: option.heavy,
    separated: false,
  };
}

/**
 * The actions to list while the bot has not yet said what it would refuse, or
 * for an app. Only what the role may do is listed, the same as the real list,
 * but every one is greyed out so nothing is chosen on a guess.
 */
function placeholderActions(role: StaffRole, kinds: readonly ModActionKind[], hint: string): MenuEntry[] {
  return kinds
    .filter((kind) => canTakeAction(role, kind))
    .map((kind) => ({
      id: `action:${kind}`,
      label: kind === "warn" ? "Warn" : kind === "timeout" ? "Timeout" : kind === "kick" ? "Kick" : "Ban",
      icon: kind,
      effect: { type: "action" as const, kind },
      hint,
      disabled: true,
      danger: kind === "kick" || kind === "ban",
      separated: false,
    }));
}

const copyIdEntry = (user: MenuUser): MenuEntry => ({
  id: "copy-id",
  label: "Copy user ID",
  icon: "copy",
  effect: { type: "copy", text: user.userId, done: "Copied the user ID." },
  hint: null,
  disabled: false,
  danger: false,
  separated: false,
});

const profileEntry = (guildId: string, user: MenuUser): MenuEntry => ({
  id: "profile",
  label: "View moderation profile",
  icon: "profile",
  effect: { type: "href", href: profileHref(guildId, user.userId), external: false },
  hint: null,
  disabled: false,
  danger: false,
  separated: false,
});

/** Marks the first entry of each group, so the divider falls between groups and never at an end. */
function grouped(groups: MenuEntry[][]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const group of groups) {
    group.forEach((entry, index) => out.push({ ...entry, separated: index === 0 && out.length > 0 }));
  }
  return out;
}

export interface PersonMenuInput {
  guildId: string;
  /** The viewer's moderation role, or null when they have none. */
  role: StaffRole | null;
  user: MenuUser;
  /**
   * What `actionOptions` gives for this person once the bot has answered, or
   * null while it has not. Ignored without a role.
   */
  options: readonly ActionOption[] | null;
}

/**
 * The menu on a person. Without a moderation role it is the plain ones:
 * copying the id and opening the person in Discord.
 */
export function personEntries(input: PersonMenuInput): MenuEntry[] {
  const { guildId, role, user, options } = input;
  const plain = [
    copyIdEntry(user),
    {
      id: "discord",
      label: "Open in Discord",
      icon: "external" as const,
      effect: { type: "href" as const, href: discordProfileUrl(user.userId), external: true },
      hint: null,
      disabled: false,
      danger: false,
      separated: false,
    },
  ];
  if (role === null) return grouped([plain]);

  const kinds: readonly ModActionKind[] = ["warn", "timeout", "kick", "ban"];
  const actions = user.app
    ? placeholderActions(role, kinds, APP_HINT)
    : options === null
      ? placeholderActions(role, kinds, CHECKING_HINT)
      : options.map((option) => actionEntry(option, option.label));
  return grouped([user.app ? [] : [profileEntry(guildId, user)], actions, plain]);
}

export interface MessageMenuInput extends PersonMenuInput {
  message: MessageRef;
}

/**
 * The menu on a message: actions on its author with the message kept as
 * evidence, then copying the message, then the author's profile.
 */
export function messageEntries(input: MessageMenuInput): MenuEntry[] {
  const { guildId, role, user, options, message } = input;
  const text = message.content.trim();
  const reply: MenuEntry[] = message.onReply
    ? [
        {
          id: "reply",
          label: "Reply to this message",
          icon: "reply",
          effect: { type: "run", run: message.onReply },
          hint: null,
          disabled: false,
          danger: false,
          separated: false,
        },
      ]
    : [];
  const copies: MenuEntry[] = [
    {
      id: "copy-text",
      label: "Copy message text",
      icon: "copy",
      effect: { type: "copy", text: message.content, done: "Copied the message text." },
      hint: text === "" ? NO_TEXT_HINT : null,
      disabled: text === "",
      danger: false,
      separated: false,
    },
    {
      id: "copy-link",
      label: "Copy message link",
      icon: "copy",
      effect: { type: "copy", text: messageLink(guildId, message.channelId, message.messageId), done: "Copied the message link." },
      hint: null,
      disabled: false,
      danger: false,
      separated: false,
    },
  ];
  if (role === null) return grouped([reply, copies, [copyIdEntry(user)]]);

  const actions = user.app
    ? placeholderActions(role, ACTIONS_ON_AUTHOR, APP_HINT).map((entry) => ({ ...entry, label: AUTHOR_LABEL[entry.icon as ModActionKind] ?? entry.label }))
    : options === null
      ? placeholderActions(role, ACTIONS_ON_AUTHOR, CHECKING_HINT).map((entry) => ({ ...entry, label: AUTHOR_LABEL[entry.icon as ModActionKind] ?? entry.label }))
      : options
          .filter((option) => ACTIONS_ON_AUTHOR.includes(option.kind))
          .map((option) =>
            actionEntry(option, option.kind === "timeout" && option.label !== "Timeout" ? "Change author’s timeout" : (AUTHOR_LABEL[option.kind] ?? option.label)),
          );
  return grouped([reply, actions, copies, user.app ? [copyIdEntry(user)] : [profileEntry(guildId, user), copyIdEntry(user)]]);
}
