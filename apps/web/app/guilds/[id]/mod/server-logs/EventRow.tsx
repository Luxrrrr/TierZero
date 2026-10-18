"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { ServerLogEntryDto, UserRef } from "@tier0/core";
import {
  BanIcon,
  ChevronDownIcon,
  HashIcon,
  HistoryIcon,
  KeyIcon,
  MessagesIcon,
  SetupIcon,
  ShieldIcon,
  SpeakerIcon,
  UserIcon,
} from "../../../../../components/Icons";
import { Avatar, RelativeTime } from "../../../../../components/mod/ModUi";
import { Collapse } from "../../../../../components/Collapse";

const CATEGORY_ICON = {
  members: UserIcon,
  messages: MessagesIcon,
  moderation: ShieldIcon,
  roles: KeyIcon,
  channels: HashIcon,
  voice: SpeakerIcon,
  server: SetupIcon,
} as const;

const memberHref = (guildId: string, id: string) => `/guilds/${guildId}/mod/server-logs?member=${id}`;

function Person({ guildId, user, role }: { guildId: string; user: UserRef; role: "by" | "about" }) {
  const name = user.name ?? `User ${user.userId.slice(-4)}`;
  return (
    <Link className="sl-person" href={memberHref(guildId, user.userId)} title={`See everything about ${name}`}>
      <Avatar user={user} size={16} />
      <span className="sl-person-role">{role === "by" ? "by" : null}</span>
      {name}
    </Link>
  );
}

/**
 * One entry. The line says what happened. Who did it, who it happened to and where are small links under it,
 * and each narrows the log to that person or place. What changed opens underneath.
 */
export function EventRow({ guildId, entry }: { guildId: string; entry: ServerLogEntryDto }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const Icon = entry.type.startsWith("member.ban") || entry.type === "member.kick" ? BanIcon : CATEGORY_ICON[entry.category];
  const changes = entry.details.changes ?? [];
  const notes = entry.details.notes ?? [];
  // An edit always has two versions to look at. A deletion only does if the message was edited first.
  const hasVersions = Boolean(entry.details.messageId) && (entry.type === "message.edit" || entry.details.edited === true);
  const expandable = changes.length > 0 || notes.length > 0 || hasVersions;

  return (
    <li className="sl-entry" data-open={open ? "true" : undefined} data-category={entry.category}>
      <div className="sl-entry-row">
        <span className="sl-icon" aria-hidden="true">
          <Icon />
        </span>
        <div className="sl-main">
          <p className="sl-summary">{entry.summary}</p>
          <p className="sl-meta">
            <span className="sl-type-tag">{entry.label}</span>
            {entry.actor ? <Person guildId={guildId} user={entry.actor} role="by" /> : null}
            {entry.target && entry.target.userId !== entry.actor?.userId ? <Person guildId={guildId} user={entry.target} role="about" /> : null}
            {entry.channel ? (
              <Link className="sl-channel-tag" href={`/guilds/${guildId}/mod/server-logs?channel=${entry.channel.id}`} title="Only this channel">
                #{entry.channel.name || "unknown"}
              </Link>
            ) : null}
          </p>
        </div>
        <span className="sl-when">
          <RelativeTime iso={entry.at} />
        </span>
        {expandable ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm sl-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? "Hide" : "Show"} details: ${entry.summary}`}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : "Details"}
            <ChevronDownIcon className="audit-chevron" />
          </button>
        ) : (
          <span className="sl-toggle-space" />
        )}
      </div>

      {expandable ? (
        <Collapse open={open} keep>
          <div id={panelId} className="sl-detail">
            {changes.length > 0 ? (
              <table className="sl-changes">
                <tbody>
                  {changes.map((change, index) => (
                    <tr key={index}>
                      <th scope="row">{change.label}</th>
                      <td>
                        {change.before !== null ? <span className="sl-before">{change.before}</span> : null}
                        {change.before !== null && change.after !== null ? <span className="sl-arrow" aria-label="became"> → </span> : null}
                        {change.after !== null ? <span className="sl-after">{change.after}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {notes.length > 0 ? (
              <ul className="sl-notes">
                {notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            ) : null}
            {hasVersions ? (
              <div className="sl-history">
                <Link
                  className="btn btn-secondary btn-sm"
                  href={`/guilds/${guildId}/mod/server-logs?view=messages&message=${entry.details.messageId}`}
                  title="Opens the saved message with the text of every edit"
                >
                  <HistoryIcon />
                  View message history
                </Link>
              </div>
            ) : null}
          </div>
        </Collapse>
      ) : null}
    </li>
  );
}
