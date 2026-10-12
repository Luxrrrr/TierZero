import type { EvidenceMessage, MessageVersion } from "@tier0/core";
import { When } from "./ModUi";

/** The red label on a message that was deleted, with when if the bot saw it happen. */
export function DeletedTag({ deletedAt }: { deletedAt?: string | null }) {
  return (
    <span className="ev-tag" data-kind="deleted" title="The member, or someone else, deleted this message in Discord">
      Message deleted
      {deletedAt ? (
        <>
          {" "}
          <When iso={deletedAt} />
        </>
      ) : null}
    </span>
  );
}

/** What to call a version: the first is the original, the last is how it reads now. */
export function versionLabel(index: number, count: number): string {
  return index === 0 ? "Original" : index === count - 1 ? "Latest" : `Edit ${index}`;
}

/** A dropdown of every version of an edited message, oldest first. Nothing renders for a message that was never edited. */
export function Versions({ versions, flagged }: { versions?: MessageVersion[]; flagged?: number }) {
  if (!versions || versions.length < 2) return null;
  const last = versions.length - 1;
  return (
    <details className="ev-versions">
      <summary>
        <span className="ev-tag" data-kind="edited" title="The member changed the text of this message after posting it">
          Message edited
        </span>
        <span>Show all {versions.length} versions</span>
      </summary>
      <ol className="ev-version-list">
        {versions.map((version, index) => (
          <li key={index} data-current={index === last ? "true" : undefined} data-flagged={index === flagged ? "true" : undefined}>
            <span className="ev-version-head">
              <span className="ev-version-label">{versionLabel(index, versions.length)}</span>
              {index === flagged ? <span className="ev-tag" data-kind="flagged">Warned for this</span> : null}
              <When iso={version.at} />
            </span>
            <p className="ev-content" data-dim={version.content === "" ? "true" : undefined}>
              {version.content !== "" ? version.content : "No text."}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

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
      {evidence.map((message) => {
        const count = message.versions?.length ?? 0;
        // For an edited message the moderator may have picked an older version as the one that broke the rules.
        const flagged = count > 1 && message.flagged !== undefined && message.flagged < count - 1 ? message.flagged : undefined;
        const shown = flagged !== undefined ? (message.versions![flagged]?.content ?? message.content) : message.content;
        return (
        <li className="ev-card" key={message.id}>
          <div className="ev-head">
            <span className="ev-channel">#{message.channelName || "unknown"}</span>
            <When iso={message.createdAt} />
            {message.deleted ? <DeletedTag deletedAt={message.deletedAt} /> : null}
            <a className="ev-open" href={message.url} target="_blank" rel="noreferrer">
              Open in Discord
            </a>
          </div>
          {flagged !== undefined ? (
            <p className="ev-flagged">
              <span className="ev-tag" data-kind="flagged">
                Warned for the {versionLabel(flagged, count).toLowerCase()}
              </span>
            </p>
          ) : null}
          {shown !== "" ? (
            <p className="ev-content" data-clamp={full ? undefined : "true"}>
              {shown}
            </p>
          ) : (
            <p className="ev-content ev-dim">No text.</p>
          )}
          <Versions versions={message.versions} flagged={flagged} />
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
        );
      })}
    </ul>
  );
}
