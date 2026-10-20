import type { ButtonStyleName, MessageBody, MessageButton, MessageSelect } from "@tier0/core";
import type { TicketPanelStatusDto } from "@tier0/shared-tickets";

/**
 * A panel as members will see it, built from the settings draft: its message
 * with a button per ticket type, or one menu holding them all. Mirrors how the
 * bot lays a panel out, so the preview can be trusted. Free of React so the
 * tests can import it directly.
 */

const STYLES: readonly ButtonStyleName[] = ["primary", "secondary", "success", "danger"];
export const PANEL_BUTTON_LIMIT = 25;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function emptyBody(): MessageBody {
  return { content: "", embeds: [], buttons: [], selects: [], reactions: [] };
}

function bodyOf(value: unknown, fallback: MessageBody | undefined): MessageBody {
  const source = record(value);
  if (Object.keys(source).length === 0) return fallback ?? emptyBody();
  return {
    ...emptyBody(),
    content: text(source.content) === "" ? "" : String(source.content),
    embeds: Array.isArray(source.embeds) ? (source.embeds as MessageBody["embeds"]) : [],
    // The bot adds the panel's reactions when it posts it, so the preview shows them too.
    reactions: Array.isArray(source.reactions) ? (source.reactions as MessageBody["reactions"]) : [],
  };
}

export interface PanelPreviewInput {
  /** The panel row from the settings draft. */
  panel: unknown;
  /** The message the schema starts a panel with, used when the row has none. */
  starting?: MessageBody;
}

export function panelPreviewMessage({ panel, starting }: PanelPreviewInput): MessageBody {
  const row = record(panel);
  const body = bodyOf(row.message, starting);
  const types = (Array.isArray(row.types) ? row.types : []).map(record).slice(0, PANEL_BUTTON_LIMIT);

  if (row.style === "menu") {
    const select: MessageSelect = {
      kind: "string",
      placeholder: text(row.placeholder) || "Make a selection",
      minValues: 1,
      maxValues: 1,
      disabled: false,
      options: types.map((type, index) => {
        const look = record(type.appearance);
        return {
          label: text(type.name) || `Type ${index + 1}`,
          value: text(type.id) || String(index),
          description: text(look.description),
          emoji: text(type.emoji),
          default: false,
          action: { type: "none" },
        };
      }),
      channelTypes: [],
      limitTo: [],
      action: { type: "none" },
    };
    return { ...body, buttons: [], selects: types.length > 0 ? [select] : [] };
  }

  const buttons: MessageButton[] = types.map((type, index) => {
    const look = record(type.appearance);
    const style = STYLES.includes(look.buttonStyle as ButtonStyleName) ? (look.buttonStyle as ButtonStyleName) : "primary";
    return {
      label: text(look.buttonLabel) || text(type.name) || `Type ${index + 1}`,
      emoji: text(type.emoji),
      style,
      url: "",
      disabled: false,
      action: { type: "none" },
    };
  });
  return { ...body, buttons, selects: [] };
}

/** The panel rows of the tickets settings draft, with what the strip above them needs. */
export function draftPanels(settings: Record<string, unknown>): { id: string; name: string; channelId: string | null; row: unknown }[] {
  const panels = Array.isArray(settings.panels) ? settings.panels : [];
  return panels.map((panel, index) => {
    const row = record(panel);
    return {
      id: text(row.id),
      name: text(row.name) || `Panel ${index + 1}`,
      channelId: text(row.channel) || null,
      row: panel,
    };
  });
}

export type PanelStripState =
  | "missing"
  | "unsaved"
  | "posted"
  | "changed"
  | "moved"
  | "deleted"
  | "unposted"
  | "legacy"
  | "nochannel";

const FROM_BOT: Record<NonNullable<TicketPanelStatusDto["state"]>, PanelStripState> = {
  posted: "posted",
  changed: "changed",
  moved: "moved",
  messageDeleted: "deleted",
  legacy: "legacy",
  notPosted: "unposted",
  noChannel: "nochannel",
};

/**
 * Where one panel of the draft stands in Discord. The bot only knows saved
 * panels, so a panel it has never seen reads as not saved yet. The bot's own
 * word for the panel is used when it sends one: it has asked Discord whether
 * the message is still there, whether the settings changed since the post,
 * and whether it is still up in a channel the panel was moved away from.
 */
export function panelStripState(
  panel: { channelId: string | null },
  found: { posted: boolean; channelExists: boolean; legacy?: boolean; state?: TicketPanelStatusDto["state"]; channelId?: string | null } | undefined,
  dirty: boolean,
): PanelStripState {
  if (!panel.channelId) return "nochannel";
  if (!found) return "unsaved";
  if (found.state) {
    const state = FROM_BOT[found.state];
    if (state === "nochannel") return found.channelId ? "missing" : "nochannel";
    return state;
  }
  if (dirty) return found.posted ? "posted" : found.legacy ? "legacy" : "unsaved";
  if (!found.channelExists) return "missing";
  if (found.posted) return "posted";
  return found.legacy ? "legacy" : "unposted";
}

/** The panel is up in Discord in some form, so the button changes what is there rather than putting up a first copy. */
export function panelIsUp(state: PanelStripState): boolean {
  return state === "posted" || state === "changed" || state === "moved";
}
