import type { EvidenceMessage } from "@tier0/core";
import { When } from "./ModUi";

/**
 * Messages a moderator attached to an action, shown as they read when the
 * action was taken. They are copies, so they stay readable after the member
 * edits or deletes the original, and the link to Discord only works while the
 * original still exists.
 */
export function EvidenceList({ evidence, full = false }: { evidence: EvidenceMessage[]; full?: boolean }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="ev-list" aria-label={`${evidence.length} attached ${evidence.length === 1 ? "message" : "messages"}`}>
      {evidence.map((message) => (
        <li className="ev-card" key={message.id}>
          <div className="ev-head">
            <span className="ev-channel">#{message.channelName || "unknown"}</span>
            <When iso={message.createdAt} />
            {message.deleted ? <span className="ev-tag">Deleted</span> : null}
            <a className="ev-open" href={message.url} target="_blank" rel="noreferrer">
              Open in Discord
            </a>
          </div>
          {message.content !== "" ? (
            <p className="ev-content" data-clamp={full ? undefined : "true"}>
              {message.content}
            </p>
          ) : (
            <p className="ev-content ev-dim">No text.</p>
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
        </li>
      ))}
    </ul>
  );
}
