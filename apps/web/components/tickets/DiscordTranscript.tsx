"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { TRANSCRIPT_CSS, transcriptTree, type TicketMessageDto, type TranscriptActivity, type TranscriptLabels } from "@tier0/shared-tickets";
import { renderTranscriptNode } from "../../lib/transcript-react";
import { isContextMenuKey } from "../../lib/menu-position";
import { isMenuUser, type MenuUser } from "../../lib/person-menu";
import { isPendingMessage } from "../../lib/ticket-optimistic";
import { canReplyTo } from "../../lib/ticket-reply-to";
import { MoreIcon, UndoIcon } from "../Icons";
import { anchorFromElement, anchorFromEvent, leaveNativeMenu, useModMenu, type OpenAnchor } from "../mod/menu-context";

/** What a right-click on these opens the person menu for; anywhere else on the message opens the message menu. */
const PERSON_PARTS = ".dt-avatar, .dt-name, .dt-reply-avatar, .dt-reply-name";
const REPLY_PARTS = ".dt-reply-avatar, .dt-reply-name";
/** Things whose own browser menu is worth more than ours: opening a link, saving a picture, playing a clip. */
const NATIVE_PARTS = "a[href], img, video, audio, input, textarea";

/**
 * A ticket's messages drawn the way Discord draws them, from the same tree and
 * stylesheet as the downloaded transcript. Times are UTC until the page runs,
 * then the reader's own, so the server's markup and the first render agree.
 *
 * Inside a server's dashboard the people and messages also carry the
 * moderation menu: right-click a name or avatar for the person, anywhere else
 * on a message for the message, or use the "..." on the message.
 */
export function DiscordTranscript({
  messages,
  channelName,
  channelId,
  topic,
  activity,
  names,
  labels,
  thread = false,
  showSender = false,
  headerSlot,
  onReply,
}: {
  messages: readonly TicketMessageDto[];
  channelName: string;
  /** The ticket's channel, for the link a message's menu copies and attaches. Without it messages get no menu. */
  channelId?: string;
  topic: string | null;
  /** Ticket events to show between the messages, or none. */
  activity?: readonly TranscriptActivity[];
  /** Names known besides the ones stored with each message. */
  names?: Record<string, string>;
  labels?: Partial<TranscriptLabels>;
  /** The ticket is a private thread, headed as one. */
  thread?: boolean;
  /** Name who really sent a reply under the team's name, beside its header. */
  showSender?: boolean;
  /** Controls placed at the right end of the channel header. */
  headerSlot?: ReactNode;
  /** Where a message can be answered. Adds a Reply button to each message and a Reply entry to its menu. */
  onReply?: (message: TicketMessageDto) => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // "Today" and "Yesterday" move at midnight; a minute is close enough.
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const menu = useModMenu();
  const byId = useMemo(() => new Map(messages.map((message) => [message.messageId, message])), [messages]);

  const tree = useMemo(
    () =>
      transcriptTree({
        messages,
        channelName,
        topic,
        activity,
        labels,
        thread,
        showSender,
        clock: now ? { now } : { now: null, timeZone: "UTC" },
        names: names ? { users: Object.fromEntries(Object.entries(names).map(([id, name]) => [id, { name }])) } : undefined,
      }),
    [messages, channelName, topic, activity, labels, now, names, thread, showSender],
  );

  /** The person behind a message. A reply sent from the dashboard went out under the team's name, so its author is no one to act on. */
  function personOf(message: TicketMessageDto): MenuUser | null {
    const { author } = message;
    if (!isMenuUser(author)) return null;
    return { userId: author.userId, name: author.name, inServer: true, ...(author.bot === true || message.source === "dashboard" ? { app: true } : {}) };
  }

  function openMessage(message: TicketMessageDto, anchor: OpenAnchor) {
    const user = personOf(message);
    // A reply still being sent has no message in Discord to act on yet.
    if (!menu || !channelId || isPendingMessage(message)) return false;
    menu.openMessage(
      user ?? { userId: message.author.userId, name: message.author.name, inServer: true, app: true },
      { channelId, messageId: message.messageId, content: message.content, ...(onReply && canReplyTo(message) ? { onReply: () => onReply(message) } : {}) },
      anchor,
    );
    return true;
  }

  /** Opens whichever menu fits the part of the message that was hit. False leaves the event to the browser. */
  function open(target: Element, anchor: OpenAnchor): boolean {
    const item = target.closest<HTMLElement>("li.dt-message");
    const message = item ? byId.get(item.id.replace(/^dt-/, "")) : undefined;
    if (!menu || !message) return false;

    const person = target.closest(PERSON_PARTS);
    if (person) {
      const subject = person.matches(REPLY_PARTS) ? byId.get(message.replyTo ?? "") : message;
      const user = subject ? personOf(subject) : null;
      if (!user) return false;
      menu.openPerson(user, anchor);
      return true;
    }
    if (target.closest(NATIVE_PARTS)) return false;
    return openMessage(message, anchor);
  }

  function onContextMenu(event: MouseEvent) {
    if (!menu || event.defaultPrevented || leaveNativeMenu(event) || !(event.target instanceof Element)) return;
    if (open(event.target, anchorFromEvent(event))) event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!menu || event.defaultPrevented || !isContextMenuKey(event.nativeEvent) || !(event.target instanceof Element)) return;
    if (open(event.target, anchorFromElement(event.target))) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  const messageButtons =
    (menu && channelId) || onReply
      ? (messageId: string) => {
          const message = byId.get(messageId);
          if (!message) return null;
          const reply = onReply && canReplyTo(message);
          return (
            <>
              {reply ? (
                <button
                  type="button"
                  className="dt-more dt-reply-button"
                  aria-label={`Reply to the message from ${message.author.name}`}
                  title="Reply"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReply(message);
                  }}
                >
                  <UndoIcon />
                </button>
              ) : null}
              {menu && channelId ? (
                <button
                  type="button"
                  className="dt-more"
                  aria-haspopup="menu"
                  aria-label={`Actions for the message from ${message.author.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openMessage(message, anchorFromElement(event.currentTarget));
                  }}
                >
                  <MoreIcon />
                </button>
              ) : null}
            </>
          );
        }
      : undefined;

  return (
    <>
      {/* A constant from @tier0/core, not member input. */}
      <style dangerouslySetInnerHTML={{ __html: TRANSCRIPT_CSS }} />
      {/* No box of its own, so the transcript's layout is the same with or without it. */}
      <div style={{ display: "contents" }} onContextMenu={menu ? onContextMenu : undefined} onKeyDown={menu ? onKeyDown : undefined}>
        {renderTranscriptNode(tree, undefined, { header: headerSlot, message: messageButtons })}
      </div>
    </>
  );
}
