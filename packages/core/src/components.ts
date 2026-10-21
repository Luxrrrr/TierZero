import {
  MESSAGE_LIMITS,
  badUrl,
  checkEmbed,
  isEmojiToken,
  isRecord,
  readEmbed,
  text,
  tooLong,
  type MessageEmbed,
  type MessageError,
} from "./embed.js";

/**
 * The buttons and select menus of a message. A button that opens a web address
 * works by itself. Every other component needs to know what to do when someone
 * uses it, so each carries an action, which the bot runs when the interaction
 * arrives. The action is stored with the message when it is sent, so editing a
 * template later never changes a message that is already out.
 */

export type ButtonStyleName = "primary" | "secondary" | "success" | "danger" | "link";

export const BUTTON_STYLES: { id: ButtonStyleName; label: string }[] = [
  { id: "primary", label: "Blue" },
  { id: "secondary", label: "Grey" },
  { id: "success", label: "Green" },
  { id: "danger", label: "Red" },
  { id: "link", label: "Link" },
];

/** A reply sent when a component is used. Shown only to the person who used it, unless said otherwise. */
export interface ReplyAction {
  content: string;
  embeds: MessageEmbed[];
  ephemeral: boolean;
  /** Sent to the person as a direct message instead of being shown where they used it. */
  dm: boolean;
}

export type RoleMode = "toggle" | "add" | "remove";

export type ComponentAction =
  | { type: "none" }
  | { type: "reply"; reply: ReplyAction }
  | { type: "role"; mode: RoleMode; roleId: string; confirmation: string };

export interface MessageButton {
  label: string;
  /** A unicode emoji, or Discord's custom form `<:name:id>`. */
  emoji: string;
  style: ButtonStyleName;
  /** Only a link button has one. */
  url: string;
  disabled: boolean;
  /** What happens when it is pressed. A link button has none, because it just opens its address. */
  action: ComponentAction;
}

export type SelectKind = "string" | "user" | "role" | "mentionable" | "channel";

export const SELECT_KINDS: { id: SelectKind; label: string; hint: string }[] = [
  { id: "string", label: "Your own choices", hint: "A list you write, each choice with its own action." },
  { id: "user", label: "Members", hint: "People pick members of the server." },
  { id: "role", label: "Roles", hint: "People pick roles." },
  { id: "mentionable", label: "Members or roles", hint: "People pick either." },
  { id: "channel", label: "Channels", hint: "People pick channels." },
];

/** The channel types a channel menu can be limited to, as Discord numbers them. */
export const CHANNEL_TYPES: { id: number; label: string }[] = [
  { id: 0, label: "Text" },
  { id: 2, label: "Voice" },
  { id: 4, label: "Category" },
  { id: 5, label: "Announcement" },
  { id: 13, label: "Stage" },
  { id: 15, label: "Forum" },
];

export interface SelectOption {
  label: string;
  /** Sent to the bot when this is chosen. Made up for the owner, who never needs to see it. */
  value: string;
  description: string;
  emoji: string;
  /** Chosen when the message first appears. */
  default: boolean;
  action: ComponentAction;
}

export interface MessageSelect {
  kind: SelectKind;
  placeholder: string;
  minValues: number;
  maxValues: number;
  disabled: boolean;
  /** Only a menu of your own choices has them. */
  options: SelectOption[];
  /** Only a channel menu uses it. Empty means any channel. */
  channelTypes: number[];
  /**
   * For a channel or role menu: the only ones that can be picked. Discord's own
   * pickers can be limited by kind of channel but not to particular ones, so when
   * this is set the bot sends a menu of just these, named when it is sent. Empty
   * means everything the kinds above allow.
   */
  limitTo: string[];
  /** What a menu of members, roles or channels does. A menu of your own choices keeps an action per choice instead. */
  action: ComponentAction;
}

/** The names a component's reply can use, on top of the ones every message has. They are filled in when the component is used. */
export const ACTION_VARIABLES = [
  { name: "user", description: "The name of the person who used it" },
  { name: "user.mention", description: "That person, as a mention" },
  { name: "selected", description: "What they picked, from a menu" },
  { name: "role", description: "The role being given or taken, for a role action" },
] as const;

export const emptyReply = (): ReplyAction => ({ content: "", embeds: [], ephemeral: true, dm: false });

export const emptyButton = (): MessageButton => ({
  label: "",
  emoji: "",
  style: "primary",
  url: "",
  disabled: false,
  action: { type: "none" },
});

export const emptyOption = (index: number): SelectOption => ({
  label: "",
  value: `choice-${index + 1}`,
  description: "",
  emoji: "",
  default: false,
  action: { type: "none" },
});

export const emptySelect = (kind: SelectKind = "string"): MessageSelect => ({
  kind,
  placeholder: "",
  minValues: 1,
  maxValues: 1,
  disabled: false,
  options: kind === "string" ? [emptyOption(0)] : [],
  channelTypes: [],
  limitTo: [],
  action: { type: "none" },
});

const BUTTON_STYLE_IDS = new Set<string>(BUTTON_STYLES.map((style) => style.id));
const SELECT_KIND_IDS = new Set<string>(SELECT_KINDS.map((kind) => kind.id));
const CHANNEL_TYPE_IDS = new Set(CHANNEL_TYPES.map((type) => type.id));

export function readAction(raw: unknown): ComponentAction {
  const source = isRecord(raw) ? raw : {};
  if (source.type === "reply") {
    const reply = isRecord(source.reply) ? source.reply : {};
    return {
      type: "reply",
      reply: {
        content: text(reply.content).replace(/\r\n/g, "\n"),
        embeds: (Array.isArray(reply.embeds) ? reply.embeds : []).map(readEmbed),
        // Private unless somebody says otherwise: a reply to a click is usually for that person alone.
        ephemeral: reply.ephemeral !== false,
        dm: reply.dm === true,
      },
    };
  }
  if (source.type === "role") {
    const mode = source.mode === "add" || source.mode === "remove" ? source.mode : "toggle";
    return { type: "role", mode, roleId: text(source.roleId).trim(), confirmation: text(source.confirmation) };
  }
  return { type: "none" };
}

const readInt = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) ? value : fallback;

export function readButtons(raw: unknown): MessageButton[] {
  return (Array.isArray(raw) ? raw : []).map((entry) => {
    const source = isRecord(entry) ? entry : {};
    const url = text(source.url).trim();
    // A button saved before there were styles has an address, and that is what made it a link.
    const style = typeof source.style === "string" && BUTTON_STYLE_IDS.has(source.style) ? (source.style as ButtonStyleName) : url !== "" ? "link" : "primary";
    return {
      label: text(source.label),
      emoji: text(source.emoji).trim(),
      style,
      url: style === "link" ? url : "",
      disabled: source.disabled === true,
      action: style === "link" ? { type: "none" } : readAction(source.action),
    };
  });
}

export function readSelects(raw: unknown): MessageSelect[] {
  return (Array.isArray(raw) ? raw : []).map((entry) => {
    const source = isRecord(entry) ? entry : {};
    const kind = typeof source.kind === "string" && SELECT_KIND_IDS.has(source.kind) ? (source.kind as SelectKind) : "string";
    const options = kind !== "string" ? [] : (Array.isArray(source.options) ? source.options : []).map((option, i) => {
      const o = isRecord(option) ? option : {};
      return {
        label: text(o.label),
        value: text(o.value).trim() || `choice-${i + 1}`,
        description: text(o.description),
        emoji: text(o.emoji).trim(),
        default: o.default === true,
        action: readAction(o.action),
      };
    });
    return {
      kind,
      placeholder: text(source.placeholder),
      minValues: readInt(source.minValues, 1),
      maxValues: readInt(source.maxValues, 1),
      disabled: source.disabled === true,
      options,
      channelTypes: kind === "channel" ? (Array.isArray(source.channelTypes) ? source.channelTypes : []).filter((t): t is number => typeof t === "number" && CHANNEL_TYPE_IDS.has(t)) : [],
      limitTo:
        kind === "channel" || kind === "role"
          ? [...new Set((Array.isArray(source.limitTo) ? source.limitTo : []).map((id) => text(id).trim()).filter((id) => id !== ""))]
          : [],
      action: kind === "string" ? { type: "none" } : readAction(source.action),
    };
  });
}

/** Rows a message's components take: buttons five to a row, and a menu on a row of its own. */
export function rowsUsed(buttons: readonly unknown[], selects: readonly unknown[]): number {
  return Math.ceil(buttons.length / MESSAGE_LIMITS.buttonsPerRow) + selects.length;
}

function checkReply(reply: ReplyAction, at: string, errors: MessageError[]): void {
  const L = MESSAGE_LIMITS;
  tooLong(errors, `${at}.content`, reply.content, L.content, "The reply text");
  if (reply.embeds.length > L.replyEmbeds) {
    errors.push({ path: `${at}.embeds`, message: `A reply can have at most ${L.replyEmbeds} embeds.` });
  }
  reply.embeds.forEach((embed, i) => checkEmbed(embed, `${at}.embeds[${i}]`, errors));
  if (reply.content.trim() === "" && reply.embeds.length === 0) {
    errors.push({ path: at, message: "A reply needs some text or an embed." });
  }
}

export function checkAction(action: ComponentAction, at: string, errors: MessageError[]): void {
  if (action.type === "reply") checkReply(action.reply, `${at}.reply`, errors);
  if (action.type === "role") {
    if (!/^\d{17,20}$/.test(action.roleId)) errors.push({ path: `${at}.roleId`, message: "Pick the role to give or take." });
    tooLong(errors, `${at}.confirmation`, action.confirmation, MESSAGE_LIMITS.confirmation, "The confirmation");
  }
}

const hasVariable = (value: string): boolean => /\{[a-zA-Z][a-zA-Z0-9.]*\}/.test(value);

export function checkButtons(buttons: MessageButton[], errors: MessageError[]): void {
  const L = MESSAGE_LIMITS;
  if (buttons.length > L.buttons) errors.push({ path: "buttons", message: `A message can have at most ${L.buttons} buttons.` });
  buttons.forEach((button, i) => {
    const at = `buttons[${i}]`;
    if (button.label.trim() === "" && button.emoji === "") errors.push({ path: at, message: "A button needs a label or an emoji." });
    tooLong(errors, `${at}.label`, button.label, L.buttonLabel, "A button label");
    if (button.emoji !== "" && !isEmojiToken(button.emoji)) errors.push({ path: `${at}.emoji`, message: "A button emoji must be one emoji." });
    if (button.style === "link") {
      if (button.url === "") errors.push({ path: `${at}.url`, message: "A link button needs a web address to open." });
      // A variable can supply the address, as in {caseUrl}. The filled-in message is checked again when it is sent.
      else if (!hasVariable(button.url)) badUrl(errors, `${at}.url`, button.url, "A button link");
    } else {
      checkAction(button.action, `${at}.action`, errors);
    }
  });
}

export function checkSelects(selects: MessageSelect[], errors: MessageError[]): void {
  const L = MESSAGE_LIMITS;
  if (selects.length > L.selects) errors.push({ path: "selects", message: `A message can have at most ${L.selects} menus.` });
  selects.forEach((select, i) => {
    const at = `selects[${i}]`;
    tooLong(errors, `${at}.placeholder`, select.placeholder, L.selectPlaceholder, "The placeholder");

    if (select.kind === "string") {
      if (select.options.length === 0) errors.push({ path: `${at}.options`, message: "A menu needs at least one choice." });
      if (select.options.length > L.selectOptions) errors.push({ path: `${at}.options`, message: `A menu can have at most ${L.selectOptions} choices.` });
      const seen = new Set<string>();
      select.options.forEach((option, j) => {
        const oat = `${at}.options[${j}]`;
        if (option.label.trim() === "") errors.push({ path: `${oat}.label`, message: "A choice needs a label." });
        tooLong(errors, `${oat}.label`, option.label, L.selectLabel, "A choice label");
        tooLong(errors, `${oat}.description`, option.description, L.selectDescription, "A choice description");
        tooLong(errors, `${oat}.value`, option.value, L.selectValue, "A choice value");
        if (seen.has(option.value)) errors.push({ path: `${oat}.value`, message: "Two choices share a value." });
        seen.add(option.value);
        if (option.emoji !== "" && !isEmojiToken(option.emoji)) errors.push({ path: `${oat}.emoji`, message: "A choice emoji must be one emoji." });
        checkAction(option.action, `${oat}.action`, errors);
      });
      const max = Math.min(L.selectValues, Math.max(1, select.options.length));
      if (select.maxValues < 1 || select.maxValues > max) {
        errors.push({ path: `${at}.maxValues`, message: `People can pick between 1 and ${max} here.` });
      }
      if (select.options.filter((option) => option.default).length > Math.max(1, select.maxValues)) {
        errors.push({ path: `${at}.options`, message: "More choices start selected than people are allowed to pick." });
      }
    } else {
      const max = select.limitTo.length > 0 ? Math.min(L.selectValues, select.limitTo.length) : L.selectValues;
      if (select.maxValues < 1 || select.maxValues > max) {
        errors.push({ path: `${at}.maxValues`, message: `People can pick between 1 and ${max} here.` });
      }
      if (select.limitTo.length > L.selectOptions) {
        errors.push({ path: `${at}.limitTo`, message: `A menu can offer at most ${L.selectOptions} ${select.kind === "role" ? "roles" : "channels"}.` });
      }
      select.limitTo.forEach((id, j) => {
        if (!/^\d{17,20}$/.test(id)) errors.push({ path: `${at}.limitTo[${j}]`, message: "That is not a valid id." });
      });
    }
    if (select.minValues < 0 || select.minValues > select.maxValues) {
      errors.push({ path: `${at}.minValues`, message: "The least people must pick can't be more than the most." });
    }
    if (select.kind !== "string") checkAction(select.action, `${at}.action`, errors);
  });
}
