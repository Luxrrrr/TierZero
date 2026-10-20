import type { ReplyValues } from "@tier0/core";
import type { TicketError } from "@tier0/shared-tickets";
import type { ReplyKey } from "./messages.js";

/**
 * What a ticket operation comes back with. A refusal is a reply key and its
 * values, so Discord can answer in the server's own words, and it also carries
 * a code and a sentence for the dashboard, which keeps its own wording.
 */

export interface Refusal {
  key: ReplyKey;
  values?: ReplyValues;
}

export type Outcome<T> = { ok: true; value: T; notes: string[] } | { ok: false; refusal: Refusal };

export const done = <T>(value: T, notes: string[] = []): Outcome<T> => ({ ok: true, value, notes });
export const refused = <T>(key: ReplyKey, values?: ReplyValues): Outcome<T> => ({ ok: false, refusal: { key, ...(values ? { values } : {}) } });

type Code = NonNullable<TicketError["code"]>;

/** How the dashboard words each refusal an operation can come back with. */
const DASHBOARD: Partial<Record<ReplyKey, { code: Code; text: string }>> = {
  notATicket: { code: "notFound", text: "That ticket doesn't exist in this server." },
  alreadyClosed: { code: "conflict", text: "This ticket is already closed." },
  channelMissing: { code: "unavailable", text: "The ticket's channel is gone from Discord, so this can't be done there." },
  alreadyClaimed: { code: "conflict", text: "Someone else claimed this ticket first. Reload to see who." },
  notClaimed: { code: "conflict", text: "Nobody has claimed this ticket." },
  notYourClaim: { code: "forbidden", text: "Someone else has claimed this ticket. Only they or an admin can change that." },
  claimOff: { code: "invalid", text: "Claiming is switched off for this ticket type." },
  notClosed: { code: "conflict", text: "This ticket is still open." },
  cannotReopen: { code: "conflict", text: "This ticket's channel was deleted when it closed, so it can't be reopened." },
  reopenOff: { code: "forbidden", text: "Reopening closed tickets is switched off in the ticket settings." },
  typeNotFound: { code: "invalid", text: "That ticket type no longer exists. Reload and pick another." },
  sameType: { code: "conflict", text: "The ticket is already that type." },
  renameFailed: { code: "unavailable", text: "Discord refused to rename the channel. Check the bot has Manage Channels, and try again in a few minutes." },
  noCategory: { code: "unavailable", text: "The new type has no category set, or it was deleted. Set one in the ticket settings first." },
  categoryGone: { code: "unavailable", text: "The new type's category was deleted. Set another one in the ticket settings first." },
  categoryFull: { code: "unavailable", text: "The new type's category is full. Close some tickets or set an overflow category." },
  memberMissing: { code: "invalid", text: "That person isn't in this server, so they can't be added to the ticket." },
  noPanelChannel: { code: "invalid", text: "The panel has no channel, or its channel was deleted. Pick one in the panel's settings and save first." },
  panelFailed: { code: "unavailable", text: "The bot couldn't post in the panel's channel. Check it can send messages and embed links there." },
  panelMissing: { code: "notFound", text: "That panel doesn't exist any more. Reload the page." },
  panelEmoji: {
    code: "invalid",
    text: "A ticket type on this panel has a custom emoji from another server, which Discord refuses. Pick another emoji for it and save first.",
  },
  renameQueued: {
    code: "conflict",
    text: "Discord lets a channel be renamed twice every ten minutes, so this rename is waiting its turn. It goes through by itself within ten minutes.",
  },
  cannotRemoveOpener: { code: "invalid", text: "The member who opened the ticket can't be removed from it." },
  noSavedReply: { code: "notFound", text: "That saved reply no longer exists. Reload the page." },
};

/** Thrown by the exported actions, for the control API to turn into a `TicketError` reply. */
export class TicketActionError extends Error {
  readonly code: Code;

  constructor(message: string, code: Code) {
    super(message);
    this.name = "TicketActionError";
    this.code = code;
  }

  toJSON(): TicketError {
    return { error: this.message, code: this.code };
  }
}

export function actionError(refusal: Refusal): TicketActionError {
  const known = DASHBOARD[refusal.key];
  return new TicketActionError(known?.text ?? "The bot refused that change. Reload the ticket and try again.", known?.code ?? "conflict");
}
