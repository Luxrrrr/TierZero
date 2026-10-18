import type { PanelStripState } from "./ticket-panel-preview";

/**
 * What the foot of a panel on the settings page says about the panel in
 * Discord, and what its button does. The wording of the old strip, moved
 * here so the page and the tests agree. Free of React so the tests can import
 * it directly.
 */

export type PostTone = "ok" | "warn" | "danger" | "neutral";

export interface PostView {
  tone: PostTone;
  /** The one-line status: "Posted in #support", "Not posted yet". */
  status: string;
  /** Said under the status when the status alone does not explain it. */
  note: string | null;
  /** The primary button's text. */
  label: string;
  /** Why the button cannot be pressed, or null when it can. */
  blocked: string | null;
  /** The panel is up, so pressing the button changes what is there. */
  up: boolean;
  /** Posting again is the plain next step, so the button is the main action. */
  primary: boolean;
}

const NOTES: Partial<Record<PanelStripState, string>> = {
  changed: "The settings changed since it was posted. Update it so members see the change.",
  deleted: "The message was deleted in Discord, so members cannot open tickets from it. Post it again.",
  legacy: "It still works, but cannot be updated in place. Post it again, then delete the old message in Discord.",
};

export interface PostViewInput {
  state: PanelStripState;
  /** The channel the panel is set to, as its name without the hash. */
  channel: string | null;
  /** Where the posted message is now, when that is not the channel set. */
  liveChannel: string | null;
  enabled: boolean;
  /** The draft differs from what is saved, and only what is saved gets posted. */
  dirty: boolean;
  /** Whether the bot knows this panel, which it only does once it is saved. */
  saved: boolean;
  /** What the bot's health check refuses, or null. */
  refuse: string | null;
}

export function panelPostView(input: PostViewInput): PostView {
  const { state, channel, liveChannel, enabled, dirty, saved, refuse } = input;
  const where = channel ? `#${channel}` : "its channel";
  const up = state === "posted" || state === "changed" || state === "moved";

  const label =
    state === "moved"
      ? `Move to ${channel ? `#${channel}` : "its channel"}`
      : up
        ? "Update in Discord"
        : state === "legacy" || state === "deleted"
          ? "Post again"
          : "Post to Discord";

  const blocked = !enabled
    ? "Turn Tickets on first."
    : dirty
      ? "Save your changes first."
      : !saved
        ? "Save this panel first."
        : state === "nochannel" || state === "missing"
          ? "Pick a channel and save first."
          : refuse;

  let tone: PostTone = "neutral";
  let status = "";
  switch (state) {
    case "posted":
      tone = "ok";
      status = `Posted in ${where}`;
      break;
    case "changed":
      tone = "warn";
      status = `Posted in ${where}, changed since`;
      break;
    case "moved":
      tone = "warn";
      status = `Still up in ${liveChannel ? `#${liveChannel}` : "its old channel"}`;
      break;
    case "deleted":
      tone = "danger";
      status = "Deleted in Discord";
      break;
    case "unposted":
      tone = "warn";
      status = "Not posted yet";
      break;
    case "legacy":
      tone = "warn";
      status = "Posted by the older version";
      break;
    case "unsaved":
      status = "Not saved yet";
      break;
    case "missing":
      tone = "danger";
      status = "Its channel was deleted";
      break;
    case "nochannel":
      tone = "danger";
      status = "No channel picked";
      break;
  }

  const note =
    state === "moved"
      ? `Members still open tickets from the copy in ${liveChannel ? `#${liveChannel}` : "the channel it was in"}. Posting puts it in ${where === "its channel" ? "the channel set" : where} and takes that copy down.`
      : (NOTES[state] ?? null);

  return { tone, status, note, label, blocked, up, primary: state !== "posted" };
}
