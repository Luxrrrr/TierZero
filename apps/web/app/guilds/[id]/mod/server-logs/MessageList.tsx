"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EvidenceMessage, LoggedMessageDto } from "@tier0/core";
import { EVIDENCE_LIMITS } from "@tier0/core";
import { noTextLabel } from "../../../../../lib/deleted-by";
import { saveAttach } from "../../../../../lib/attach-handoff";
import { DeletedTag, Versions } from "../../../../../components/mod/Evidence";
import { UserChip, When } from "../../../../../components/mod/ModUi";

const asEvidence = (message: LoggedMessageDto): EvidenceMessage => ({
  id: message.id,
  channelId: message.channelId,
  channelName: message.channelName,
  content: message.content,
  attachments: message.attachments,
  createdAt: message.createdAt,
  url: message.url,
  deleted: message.deletedAt !== null,
  deletedAt: message.deletedAt,
  ...(message.deletedBy ? { deletedBy: message.deletedBy, deletedByName: message.deletedByName } : {}),
  ...(message.versions.length > 1 ? { versions: message.versions } : {}),
});

/**
 * The messages on one page of the log, with a checkbox on each. Picking
 * messages from one member offers to take action on them with those messages
 * already attached.
 */
export function MessageList({ guildId, items }: { guildId: string; items: LoggedMessageDto[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);

  const chosen = items.filter((message) => picked.includes(message.id));
  const authors = new Set(chosen.map((message) => message.author.userId));
  const author = authors.size === 1 ? chosen[0]!.author : null;
  const tooMany = chosen.length > EVIDENCE_LIMITS.messages;

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  function takeAction() {
    if (!author || tooMany) return;
    saveAttach(guildId, author.userId, chosen.map(asEvidence));
    router.push(`/guilds/${guildId}/mod/members/${author.userId}`);
  }

  return (
    <>
      {chosen.length > 0 ? (
        <div className="ml-selection" role="region" aria-label="Selected messages">
          <span className="ml-selection-count">{chosen.length} selected</span>
          <span className="ml-selection-hint">
            {tooMany
              ? `A case can hold ${EVIDENCE_LIMITS.messages} messages. Unselect some.`
              : author === null
                ? "Pick messages from one member to take action on them."
                : null}
          </span>
          <span className="ml-selection-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])}>
              Clear
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={author === null || tooMany} onClick={takeAction}>
              {author ? `Take action on ${author.name ?? "this member"}` : "Take action"}
            </button>
          </span>
        </div>
      ) : null}

      <ul className="mod-card ml-list" aria-label="Logged messages">
        {items.map((message) => {
          const isPicked = picked.includes(message.id);
          const deleted = message.deletedAt !== null;
          return (
            <li className="ml-row" key={message.id} data-picked={isPicked ? "true" : undefined} data-deleted={deleted ? "true" : undefined}>
              <input
                className="ml-check"
                type="checkbox"
                checked={isPicked}
                onChange={() => toggle(message.id)}
                aria-label={`Select the message from ${message.author.name ?? "this member"}`}
              />
              <div className="ml-body">
                <div className="ml-head">
                  <UserChip user={message.author} href={`/guilds/${guildId}/mod/members/${message.author.userId}`} />
                  <span className="ev-channel">#{message.channelName || "unknown"}</span>
                  <When iso={message.createdAt} />
                  {deleted ? <DeletedTag deletedAt={message.deletedAt} deletedBy={message.deletedBy} deletedByName={message.deletedByName} /> : null}
                  {deleted ? null : (
                    <a className="ev-open" href={message.url} target="_blank" rel="noreferrer">
                      Open in Discord
                    </a>
                  )}
                </div>
                {message.content !== "" ? (
                  <p className="ml-content">{message.content}</p>
                ) : (
                  <p className="ml-content ev-dim">{noTextLabel(message.attachments.length, message.extras)}</p>
                )}
                {message.attachments.length > 0 ? (
                  <ul className="ev-files">
                    {message.attachments.map((file) => (
                      <li key={file.url}>
                        <a href={file.url} target="_blank" rel="noreferrer">
                          {file.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Versions versions={message.versions} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
