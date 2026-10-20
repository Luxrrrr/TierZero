"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { TicketHealthIssue, TicketPanelOption, TicketPanelStatusDto } from "@tier0/shared-tickets";
import { useChannels } from "../form/ChannelPicker";
import { useToast } from "../Toaster";
import { Pill, RelativeTime } from "../mod/ModUi";
import { AlertIcon, ExternalLinkIcon, RefreshIcon } from "../Icons";
import { panelPostCheck } from "../../lib/ticket-health";
import { draftPanels, panelStripState } from "../../lib/ticket-panel-preview";
import { panelPostView } from "../../lib/ticket-panel-post";
import { ticketsClient } from "../../lib/tickets-client";

type Status = TicketPanelStatusDto[] | { error: string };

/**
 * Whether each panel is up in Discord, and the posting itself, kept in one
 * place so the status in a panel's header and the button at its foot agree.
 * The bot posts what is saved, so the draft only decides what the foot says.
 */
export function usePanelPosting(guildId: string, initial: Status) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<Status>(initial);
  const [posting, setPosting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { channels } = useChannels(guildId);

  useEffect(() => setStatus(initial), [initial]);

  const channelName = (id: string | null | undefined) => (id ? (channels.find((channel) => channel.id === id)?.name ?? null) : null);

  async function refresh(announce = false) {
    setRefreshing(true);
    const result = await ticketsClient.panels(guildId);
    setRefreshing(false);
    if (result.ok) {
      setStatus(result.value);
      if (announce) toast.push({ kind: "success", title: "Checked with Discord" });
    } else setStatus({ error: result.error });
  }

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

  const live = Array.isArray(status) ? status : [];
  const checkedAt = live.map((entry) => entry.checkedAt).filter((at): at is string => typeof at === "string").sort().pop() ?? null;
  return { status, live, posting, refreshing, confirming, setConfirming, channelName, refresh, post, checkedAt };
}

export type PanelPosting = ReturnType<typeof usePanelPosting>;

interface DraftInfo {
  settings: Record<string, unknown>;
  dirty: boolean;
  enabled: boolean;
  typeProblems: TicketPanelOption[];
  issues: TicketHealthIssue[];
}

/** One panel of the draft, set against what Discord has. */
function viewOf(posting: PanelPosting, index: number, draft: DraftInfo) {
  const panel = draftPanels(draft.settings)[index];
  if (!panel) return null;
  const found = posting.live.find((entry) => entry.panelId === panel.id);
  const state = panelStripState(panel, found, draft.dirty);
  const check = panelPostCheck(panel.id, draft.typeProblems, draft.issues);
  const channel = posting.channelName(panel.channelId);
  const view = panelPostView({
    state,
    channel,
    liveChannel: posting.channelName(found?.liveChannelId),
    enabled: draft.enabled,
    dirty: draft.dirty,
    saved: found !== undefined && !draft.dirty,
    refuse: check.refuse,
  });
  return { panel, found, state, check, view };
}

/** The panel's state in a few words, for its collapsed header. */
export function PanelStatus({ posting, index, draft }: { posting: PanelPosting; index: number; draft: DraftInfo }) {
  const shown = viewOf(posting, index, draft);
  if (!shown) return null;
  return (
    <Pill tone={shown.view.tone}>
      <span data-panel-state={shown.state}>{shown.view.status}</span>
    </Pill>
  );
}

/**
 * The foot of an open panel: where it stands in Discord, and the one button
 * that puts it up or brings it in line. A panel whose types cannot all open a
 * ticket yet asks once more before it is posted.
 */
export function PanelFooter({ posting, index, draft }: { posting: PanelPosting; index: number; draft: DraftInfo }) {
  const reasonId = useId();
  const warnId = useId();
  const shown = viewOf(posting, index, draft);
  if (!shown) return null;
  const { panel, found, state, check, view } = shown;
  const warn = view.blocked ? null : check.warn;
  const confirming = posting.confirming === panel.id;
  const busy = posting.posting === panel.id;

  return (
    <div className="panel-foot">
      <div className="panel-foot-status">
        <p className="panel-foot-line">
          <Pill tone={view.tone}>{view.status}</Pill>
          {(state === "posted" || state === "changed") && found?.postedAt ? (
            <span className="panel-foot-when">
              <RelativeTime iso={found.postedAt} />
            </span>
          ) : null}
        </p>
        {view.blocked && state !== "posted" ? (
          <p className="panel-foot-why" id={reasonId}>
            {view.blocked}
          </p>
        ) : view.note ? (
          <p className="panel-foot-why">{view.note}</p>
        ) : null}
      </div>
      <div className="panel-foot-actions">
        {view.up && found?.messageUrl ? (
          <a className="btn btn-ghost btn-sm" href={found.messageUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon />
            View in Discord
          </a>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void posting.refresh(true)}
          aria-disabled={posting.refreshing || undefined}
          title="Ask Discord whether the message is still there"
        >
          <RefreshIcon />
          {posting.refreshing ? "Checking…" : "Check again"}
        </button>
        {confirming ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => posting.setConfirming(null)}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          data-panel-post="true"
          className={view.primary ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
          aria-disabled={view.blocked !== null || busy || undefined}
          aria-describedby={[view.blocked ? reasonId : null, warn ? warnId : null].filter(Boolean).join(" ") || undefined}
          title={view.blocked ?? undefined}
          onClick={() => {
            if (view.blocked !== null || busy) return;
            if (check.warn && !confirming) {
              posting.setConfirming(panel.id);
              return;
            }
            void posting.post(panel.id, panel.name, view.up);
          }}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          {confirming ? "Post anyway" : view.label}
        </button>
      </div>
      {warn ? (
        <p className="panel-foot-warn" id={warnId} role={confirming ? "alert" : undefined}>
          <AlertIcon />
          <span>{warn}</span>
        </p>
      ) : null}
      {"error" in posting.status ? (
        <p className="panel-foot-why" role="status">
          Whether the panels are posted could not be checked: {posting.status.error}
        </p>
      ) : null}
    </div>
  );
}
