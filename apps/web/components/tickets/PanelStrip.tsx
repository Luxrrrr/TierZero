"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MessageBody, TicketHealthIssue, TicketPanelOption, TicketPanelStatusDto } from "@tier0/core";
import { useChannels } from "../form/ChannelPicker";
import { MessagePreview } from "../messages/MessagePreview";
import { useToast } from "../Toaster";
import { Pill, RelativeTime } from "../mod/ModUi";
import { AlertIcon, ChevronDownIcon, ExternalLinkIcon, EyeIcon, HashIcon, MegaphoneIcon, RefreshIcon } from "../Icons";
import { panelPostCheck } from "../../lib/ticket-health";
import { draftPanels, panelIsUp, panelPreviewMessage, panelStripState, type PanelStripState } from "../../lib/ticket-panel-preview";
import { ticketsClient } from "../../lib/tickets-client";

interface Props {
  guildId: string;
  serverName: string;
  /** The tickets settings draft, so the preview follows the edits. */
  settings: Record<string, unknown>;
  /** The draft differs from what is saved, and the bot only posts what is saved. */
  dirty: boolean;
  enabled: boolean;
  /** The bot's answer when the page loaded, or the reason it could not be had. */
  initial: TicketPanelStatusDto[] | { error: string };
  /** The message a new panel starts with, for a row that has none of its own yet. */
  starting?: MessageBody;
  /** The saved panels with what stops each type, from the workspace context. */
  typeProblems?: TicketPanelOption[];
  /** What the bot found wrong, for the warnings before a post. */
  issues?: TicketHealthIssue[];
}

type State = PanelStripState;

/**
 * Each panel as Discord has it right now: posted, out of date, still up in a
 * channel it was moved from, deleted, or not posted, and the button that puts
 * it up or brings it in line with the saved settings. Check again asks
 * Discord afresh. A preview of what members will see sits under each one.
 */
export function PanelStrip({ guildId, serverName, settings, dirty, enabled, initial, starting, typeProblems = [], issues = [] }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState(initial);
  const [posting, setPosting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { channels } = useChannels(guildId);
  const panels = draftPanels(settings);

  useEffect(() => setStatus(initial), [initial]);

  const refresh = async (announce = false) => {
    setRefreshing(true);
    const result = await ticketsClient.panels(guildId);
    setRefreshing(false);
    if (result.ok) {
      setStatus(result.value);
      if (announce) toast.push({ kind: "success", title: "Checked with Discord" });
    } else setStatus({ error: result.error });
  };

  const live = Array.isArray(status) ? status : [];
  const channelName = (id: string | null | undefined) => (id ? (channels.find((channel) => channel.id === id)?.name ?? null) : null);
  const checkedAt = live.map((entry) => entry.checkedAt).filter((at): at is string => typeof at === "string").sort().pop() ?? null;

  async function post(panelId: string, name: string, update: boolean) {
    setConfirming(null);
    setPosting(panelId);
    const result = await ticketsClient.postPanel(guildId, panelId);
    setPosting(null);
    if (!result.ok) {
      toast.push({ kind: "error", title: update ? `${name} was not updated` : `${name} was not posted`, detail: result.error });
      return;
    }
    const where = channelName(result.value.channelId);
    const from = channelName(result.value.movedFrom);
    toast.push({
      kind: "success",
      title: result.value.updated ? `${name} is up to date in Discord` : `${name} is posted${where ? ` in #${where}` : ""}`,
      detail: result.value.movedFrom
        ? `The copy in ${from ? `#${from}` : "its old channel"} was taken down.`
        : result.value.legacyMessageLeft
          ? "The copy the older version posted is still up. Delete that message in Discord so members only see the new one."
          : undefined,
    });
    void refresh();
    router.refresh();
  }

  if (panels.length === 0) return null;

  return (
    <section className="mod-card tk-strip" aria-labelledby="tk-strip-title">
      <div className="mod-card-head">
        <div>
          <h2 className="mod-card-title" id="tk-strip-title">
            In Discord now
          </h2>
          <p className="mod-card-desc">
            {dirty
              ? "Save your changes first. Posting uses the saved settings, not the ones you are editing."
              : "Post a panel to put it up, or update one after changing it here."}
            {checkedAt ? (
              <>
                {" "}
                Checked with Discord <RelativeTime iso={checkedAt} />.
              </>
            ) : null}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh(true)} aria-disabled={refreshing || undefined}>
          <RefreshIcon />
          {refreshing ? "Checking…" : "Check again"}
        </button>
      </div>
      {"error" in status ? (
        <p className="tk-strip-error" role="status">
          Whether the panels are posted could not be checked: {status.error}
        </p>
      ) : null}
      <ul className="tk-strip-list">
        {panels.map((panel, index) => {
          const found = live.find((entry) => entry.panelId === panel.id);
          const state = panelStripState(panel, found, dirty);
          const saved = found !== undefined && !dirty;
          const name = panel.name;
          const channel = channelName(panel.channelId);
          const check = panelPostCheck(panel.id, typeProblems, issues);
          const blocked = !enabled
            ? "Turn Tickets on first."
            : dirty
              ? "Save your changes first."
              : !saved
                ? "Save this panel first."
                : state === "nochannel" || state === "missing"
                  ? "Pick a channel and save first."
                  : check.refuse;
          return (
            <PanelRow
              key={panel.id || index}
              name={name}
              channel={channel}
              liveChannel={channelName(found?.liveChannelId)}
              state={state}
              found={found}
              blocked={blocked}
              warn={blocked ? null : check.warn}
              confirming={confirming === panel.id}
              busy={posting === panel.id}
              onPost={() => {
                if (check.warn && confirming !== panel.id) {
                  setConfirming(panel.id);
                  return;
                }
                void post(panel.id, name, panelIsUp(state));
              }}
              onCancel={() => setConfirming(null)}
              preview={
                <MessagePreview
                  message={panelPreviewMessage({ panel: panel.row, starting })}
                  context={{ guildId, botName: "TierZero", variables: { server: serverName } }}
                />
              }
            />
          );
        })}
      </ul>
    </section>
  );
}

const STATE_PILL: Record<State, { tone: "ok" | "warn" | "danger" | "neutral"; text: string }> = {
  posted: { tone: "ok", text: "Posted" },
  changed: { tone: "warn", text: "Changed since it was posted" },
  moved: { tone: "warn", text: "Still up in its old channel" },
  deleted: { tone: "danger", text: "Deleted in Discord" },
  unposted: { tone: "warn", text: "Not posted" },
  legacy: { tone: "warn", text: "Posted by the older version" },
  unsaved: { tone: "neutral", text: "Not saved yet" },
  missing: { tone: "danger", text: "Channel deleted" },
  nochannel: { tone: "danger", text: "No channel" },
};

/** What the strip says under a panel's name about its state, when the pill alone does not explain it. */
const STATE_NOTE: Partial<Record<State, string>> = {
  changed: "The settings changed since it was posted. Update it so members see the change.",
  deleted: "The message was deleted in Discord, so members cannot open tickets from it. Post it again.",
  legacy: "It still works, but cannot be updated in place. Post it again, then delete the old message in Discord.",
};

function PanelRow({
  name,
  channel,
  liveChannel,
  state,
  found,
  blocked,
  warn,
  confirming,
  busy,
  onPost,
  onCancel,
  preview,
}: {
  name: string;
  channel: string | null;
  /** Where the posted message is now, when that is not the channel set. */
  liveChannel: string | null;
  state: State;
  found: TicketPanelStatusDto | undefined;
  blocked: string | null;
  warn: string | null;
  confirming: boolean;
  busy: boolean;
  onPost(): void;
  onCancel(): void;
  preview: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const reasonId = useId();
  const warnId = useId();
  const pill = STATE_PILL[state];
  const up = panelIsUp(state);
  const label =
    state === "moved"
      ? `Move to ${channel ? `#${channel}` : "its channel"}`
      : up
        ? "Update in Discord"
        : state === "legacy" || state === "deleted"
          ? "Post again"
          : "Post panel";
  const note =
    state === "moved"
      ? `Members still open tickets from the copy in ${liveChannel ? `#${liveChannel}` : "the channel it was in"}. Posting puts it in ${channel ? `#${channel}` : "the channel set"} and takes that copy down.`
      : (STATE_NOTE[state] ?? null);

  return (
    <li className="tk-strip-row" data-open={open ? "true" : undefined}>
      <div className="tk-strip-main">
        <span className="tk-strip-icon" aria-hidden="true">
          <MegaphoneIcon />
        </span>
        <div className="tk-strip-text">
          <p className="tk-strip-name">
            {name}
            <Pill tone={pill.tone}>{pill.text}</Pill>
          </p>
          <p className="tk-strip-meta">
            <HashIcon />
            {channel ?? (state === "nochannel" ? "No channel picked" : "Unknown channel")}
            {(state === "posted" || state === "changed") && found?.postedAt ? (
              <>
                <span aria-hidden="true">·</span> posted <RelativeTime iso={found.postedAt} />
              </>
            ) : null}
          </p>
        </div>
        <div className="tk-strip-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={open}
            aria-controls={previewId}
            onClick={() => setOpen((value) => !value)}
          >
            <EyeIcon />
            Preview
            <ChevronDownIcon className="tk-strip-chevron" />
          </button>
          {up && found?.messageUrl ? (
            <a className="btn btn-ghost btn-sm" href={found.messageUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon />
              View
              <span className="visually-hidden"> {name} in Discord</span>
            </a>
          ) : null}
          <button
            type="button"
            className={state === "posted" ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
            aria-disabled={blocked !== null || busy || undefined}
            aria-describedby={[blocked ? reasonId : null, warn ? warnId : null].filter(Boolean).join(" ") || undefined}
            title={blocked ?? undefined}
            onClick={() => {
              if (blocked === null && !busy) onPost();
            }}
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {confirming ? "Post anyway" : label}
          </button>
          {confirming ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          {blocked ? (
            <span className="visually-hidden" id={reasonId}>
              {blocked}
            </span>
          ) : null}
        </div>
      </div>
      {blocked && state !== "posted" ? <p className="tk-strip-why">{blocked}</p> : null}
      {!blocked && note ? <p className="tk-strip-why">{note}</p> : null}
      {warn ? (
        <p className="tk-strip-warn" id={warnId} role={confirming ? "alert" : undefined}>
          <AlertIcon />
          <span>{warn}</span>
        </p>
      ) : null}
      <div className="tk-strip-preview" id={previewId} hidden={!open}>
        <p className="tk-strip-preview-label">What members see in {channel ? `#${channel}` : "the channel"}</p>
        {open ? preview : null}
      </div>
    </li>
  );
}
