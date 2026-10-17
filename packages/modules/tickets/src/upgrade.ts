import { GENERATED_ID, LEGACY_PANEL_ID, LEGACY_TYPE_ID } from "@tier0/core";
import { DEFAULT_MODAL_QUESTION } from "./labels.js";
import { upgradePanel } from "./messages.js";

/**
 * Reads stored ticket settings into the current shape before they are
 * validated. Runs on every read, so it leaves current settings alone apart
 * from filling in a missing row id. Free of discord.js so it can be tested
 * with plain objects.
 */

type Stored = Record<string, unknown>;

const isRecord = (value: unknown): value is Stored => typeof value === "object" && value !== null && !Array.isArray(value);
const record = (value: unknown): Stored => (isRecord(value) ? value : {});
/** The entries that hold something, so an old value never overwrites a current one with nothing. */
const set = (values: Stored): Stored => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

/** The name the one type of a server set up before types existed is given. */
export const LEGACY_TYPE_NAME = "Support";
/** The text of the one button the old panel had, when the owner never changed it. */
export const LEGACY_BUTTON_LABEL = "Open a ticket";

export function upgradeSettings(stored: Stored): Stored {
  const current = stored.panels === undefined ? fromSingleButton(stored) : stored;
  if (!Array.isArray(current.panels)) return withShortestWaits(current);
  return withShortestWaits({ ...current, panels: withIds(current.panels) });
}

/** The shortest wait the timed settings take, which they gained after some servers had saved less. */
export const SHORTEST_WAIT = "1m";
const SHORTEST_WAIT_MS = 60_000;
const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Whether a saved wait is under a minute, in the number or the text it may be stored as. */
function tooShort(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value < SHORTEST_WAIT_MS;
  if (typeof value !== "string") return false;
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  const factor = match?.[2] ? UNIT_MS[match[2]] : undefined;
  return match !== null && factor !== undefined && Number(match[1]) * factor < SHORTEST_WAIT_MS;
}

const raised = (value: unknown) => (tooShort(value) ? SHORTEST_WAIT : value);

/**
 * Raises any timed setting saved below a minute to a minute. A wait of zero
 * closed a ticket the moment it opened, and refusing the saved value instead
 * would leave the whole feature unconfigured.
 */
function withShortestWaits(settings: Stored): Stored {
  const general = record(settings.general);
  const automation = record(settings.automation);
  const autoClose = record(automation.autoClose);
  const reminder = record(automation.reminder);
  const next: Stored = { ...settings };
  if (tooShort(general.closeRequestTimeout)) next.general = { ...general, closeRequestTimeout: SHORTEST_WAIT };
  if (tooShort(autoClose.after) || tooShort(reminder.after)) {
    next.automation = {
      ...automation,
      ...(isRecord(automation.autoClose) ? { autoClose: { ...autoClose, after: raised(autoClose.after) } } : {}),
      ...(isRecord(automation.reminder) ? { reminder: { ...reminder, after: raised(reminder.after) } } : {}),
    };
  }
  if (Array.isArray(settings.panels)) {
    next.panels = settings.panels.map((panel) =>
      isRecord(panel) && Array.isArray(panel.types)
        ? {
            ...panel,
            types: panel.types.map((type) => {
              if (!isRecord(type) || !isRecord(type.overrides) || !tooShort(type.overrides.autoCloseAfter)) return type;
              return { ...type, overrides: { ...type.overrides, autoCloseAfter: SHORTEST_WAIT } };
            }),
          }
        : panel,
    );
  }
  return next;
}

/**
 * Before ticket types, a server had one panel with one button, one category
 * and one set of support roles. That becomes one panel offering one type
 * that behaves the same: the same button text and emoji, the same single
 * optional question, the same channel name and the same people, and no
 * answers shown under the first message, which only ever had the subject.
 * An empty value goes through here too, so a new server starts with a panel
 * to fill in rather than nothing. That panel has the same id as an upgraded
 * one, so the id says nothing about an older version having posted it; only a
 * stored record does (see `legacyPanelOf` in panel-post.ts).
 */
function fromSingleButton(stored: Stored): Stored {
  const {
    panel: storedPanel,
    category,
    supportRoles,
    ticketLimit,
    transcript: storedTranscript,
    autoClose,
    ...rest
  } = stored;
  const panel = isRecord(storedPanel) ? upgradePanel(storedPanel) : {};
  const transcript = record(storedTranscript);
  const { opened, ...messages } = record(rest.messages);
  const { modalQuestion, channelName, ...labels } = record(rest.labels);

  const type: Stored = {
    id: LEGACY_TYPE_ID,
    name: LEGACY_TYPE_NAME,
    emoji: panel.buttonEmoji,
    handlers: supportRoles,
    form: [
      {
        label: typeof modalQuestion === "string" && modalQuestion !== "" ? modalQuestion : DEFAULT_MODAL_QUESTION,
        style: "paragraph",
        required: false,
        maxLength: 200,
      },
    ],
    welcome: opened,
    showAnswers: false,
    appearance: {
      buttonStyle: "primary",
      buttonLabel: typeof panel.buttonLabel === "string" && panel.buttonLabel !== "" ? panel.buttonLabel : LEGACY_BUTTON_LABEL,
    },
    opening: { mode: "channel", category },
  };

  return {
    ...rest,
    panels: [
      {
        id: LEGACY_PANEL_ID,
        name: LEGACY_TYPE_NAME,
        channel: panel.channel,
        message: panel.message,
        style: "buttons",
        types: [type],
      },
    ],
    general: { ...set({ ticketLimit, channelName }), ...record(rest.general) },
    transcripts: {
      ...set({ postFile: transcript.enabled, logChannel: transcript.channel, message: transcript.message }),
      ...record(rest.transcripts),
    },
    automation: { ...set({ autoClose }), ...record(rest.automation) },
    messages,
    labels,
  };
}

/** A short id that is always the same for the same position and name, for a row saved before rows had ids. */
export function derivedId(scope: string, index: number, name: unknown): string {
  const text = `${scope}:${index}:${typeof name === "string" ? name : ""}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Gives every panel and type a valid id that no other panel, or no other type
 * in the server, already uses. Type ids are unique across panels because a
 * ticket records its type on its own and the workspace filters by it. A row
 * that already has a unique id keeps it, so this changes nothing once saved.
 */
function withIds(panels: unknown[]): unknown[] {
  const panelIds = new Set<string>();
  const typeIds = new Set<string>();
  const claim = (taken: Set<string>, wanted: unknown, scope: string, name: unknown): string => {
    let id = typeof wanted === "string" && GENERATED_ID.test(wanted) && !taken.has(wanted) ? wanted : derivedId(scope, 0, name);
    for (let attempt = 1; taken.has(id); attempt++) id = derivedId(scope, attempt, name);
    taken.add(id);
    return id;
  };

  return panels.map((panel, p) => {
    if (!isRecord(panel)) return panel;
    const types = Array.isArray(panel.types)
      ? panel.types.map((type, t) => (isRecord(type) ? { ...type, id: claim(typeIds, type.id, `type:${p}:${t}`, type.name) } : type))
      : panel.types;
    return { ...panel, id: claim(panelIds, panel.id, `panel:${p}`, panel.name), types };
  });
}
