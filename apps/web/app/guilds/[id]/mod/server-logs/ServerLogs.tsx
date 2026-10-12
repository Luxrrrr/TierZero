import Link from "next/link";
import { can, type StaffRole } from "@tier0/core";
import type { MessageLogResult, ServerLogResult } from "../../../../../lib/mod-api";
import { HistoryIcon } from "../../../../../components/Icons";
import { EventFilters } from "./EventFilters";
import { EventList } from "./EventList";
import { MessagesView } from "./MessagesView";
import type { MessageLogQuery } from "./message-params";
import type { ServerLogQuery, ServerLogView } from "./params";
import "./messages.css";
import "./server-logs.css";

interface Props {
  guildId: string;
  role: StaffRole;
  view: ServerLogView;
  events?: { query: ServerLogQuery; data: ServerLogResult };
  messages?: { query: MessageLogQuery; data: MessageLogResult };
  /** Set when the bot refused to show the logs to this person; it says why. */
  refused?: string;
}

/**
 * The Server logs tab: what happened on the server, with filters for every part of it. Two views share
 * the page. Events is the timeline of everything the server saved. Messages is the saved text of what
 * members posted, with every edit, for finding a message and attaching it to a warning.
 */
export function ServerLogs({ guildId, role, view, events, messages, refused }: Props) {
  const base = `/guilds/${guildId}/mod/server-logs`;
  const settings = `/guilds/${guildId}/mod/settings/serverlog`;
  const data = view === "events" ? events?.data : messages?.data;
  // Deleting logs lives in the Danger zone tab, which only the owner can open.
  const canPurge = can(role, "purge");

  return (
    <div className="mod-root mod-page sl-page">
      <section className="mod-section" aria-labelledby="sl-heading">
        <div className="mod-section-head">
          <div className="mod-section-text">
            <h2 className="mod-section-title" id="sl-heading">
              Server logs
            </h2>
            <p className="mod-section-desc">
              A searchable record of what happens on the server. You only see channels you can read in Discord.
            </p>
          </div>
          <div className="sl-head-actions">
            {can(role, "audit.view") ? (
              <Link className="btn btn-ghost btn-sm" href={settings}>
                Settings
              </Link>
            ) : null}
            {canPurge ? (
              <Link className="btn btn-ghost btn-sm sl-danger-link" href={`/guilds/${guildId}/mod/danger`}>
                Delete logs…
              </Link>
            ) : null}
          </div>
        </div>

        <nav className="log-switch" aria-label="Views">
          <Link href={base} aria-current={view === "events" ? "page" : undefined} title="Everything that happened">
            Events
          </Link>
          <Link href={`${base}?view=messages`} aria-current={view === "messages" ? "page" : undefined} title="What members posted, with every edit">
            Messages
          </Link>
        </nav>

        {data === undefined ? (
          <div className="mod-card">
            <div className="mod-empty">
              <span className="mod-empty-icon">
                <HistoryIcon />
              </span>
              <p className="mod-empty-title">The server logs are closed to moderators</p>
              <p className="mod-empty-text">{refused ?? "Ask an admin to open them."}</p>
            </div>
          </div>
        ) : !data.logEnabled ? (
          <div className="mod-card">
            <div className="mod-empty">
              <span className="mod-empty-icon">
                <HistoryIcon />
              </span>
              <p className="mod-empty-title">{view === "messages" ? "Saving messages is off" : "Server logs are off"}</p>
              <p className="mod-empty-text">
                {view === "messages"
                  ? "Turn on Messages in the Server logs settings to save member messages, edits and deletions."
                  : "Turn on the Server logs feature and choose what to record: joins and leaves, role and nickname changes, edits and deletions, channel and role changes, voice activity, bans and more."}{" "}
                Anything from before it was turned on is not included.
              </p>
              <div className="mod-empty-action">
                <Link className="btn btn-secondary btn-sm" href={settings}>
                  Open the Server logs settings
                </Link>
              </div>
            </div>
          </div>
        ) : view === "events" && events ? (
          <>
            <EventFilters guildId={guildId} query={events.query} channels={events.data.channels} counts={events.data.counts} recording={events.data.recording} />
            <EventList guildId={guildId} query={events.query} data={events.data} />
          </>
        ) : messages ? (
          <MessagesView guildId={guildId} query={messages.query} data={messages.data} />
        ) : null}
      </section>
    </div>
  );
}
