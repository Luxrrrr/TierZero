"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TicketDetailDto, TicketMessageDto } from "@tier0/shared-tickets";
import { ArrowDownIcon } from "../Icons";
import { knownNames, ticketNumber, ticketTopic, transcriptActivity } from "../../lib/ticket-format";
import { Switch } from "../form/Switch";
import { DiscordTranscript } from "./DiscordTranscript";

const OPEN_LABELS = { empty: "No messages yet." };
const CLOSED_LABELS = { empty: "No messages were saved for this ticket. Tickets closed before transcripts were stored have no conversation here." };

interface Props {
  ticket: TicketDetailDto;
  messages: TicketMessageDto[];
  catchingUp: boolean;
  failed: string | null;
  announcement: string;
  /** Messages the last poll brought, so the view can follow them down or offer to. */
  arrived: TicketMessageDto[];
  viewerId: string;
  /** Name who really sent a reply that went out under the team's name. A transcript shows what Discord showed instead. */
  showSender: boolean;
  /** The composer, or the reason there is none. */
  footer: ReactNode;
  /** The pane scrolls on its own, as in the two-pane inbox, rather than with the page. */
  contained: boolean;
  /** Answer one message. Left out where the conversation is only read. */
  onReply?: (message: TicketMessageDto) => void;
}

/**
 * A ticket's conversation, drawn as it looked in Discord. What happened to
 * the ticket (claims, priority, people added) is not part of Discord's
 * channel, so it stays out unless the reader asks for it, and then reads
 * plainly as the dashboard's own lines rather than as messages.
 */
export function Conversation({ ticket, messages, catchingUp, failed, announcement, arrived, viewerId, showSender, footer, contained, onReply }: Props) {
  const activityLabelId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [unseen, setUnseen] = useState(0);
  const [showActivity, setShowActivity] = useState(false);
  const firstScroll = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the reader is at the latest message. While they are, content that
  // grows under them, such as a picture finishing loading, keeps them there.
  const stuck = useRef(true);
  // Where the reader was when ticket activity was switched on or off, so the
  // rows it adds or removes do not move the conversation out from under them.
  const anchor = useRef<{ atEnd: boolean; id: string | null; top: number } | null>(null);

  const activity = useMemo(() => (showActivity ? transcriptActivity(ticket.events) : undefined), [showActivity, ticket.events]);
  // Mentions of people the ticket already knows read as their names, also in messages stored before names were.
  const names = useMemo(() => Object.fromEntries(knownNames(messages, ticket)), [messages, ticket]);
  const topic = ticketTopic(ticket);

  // Whether the pane scrolls on its own, which depends on the room the page
  // has right now rather than on which route drew it.
  const containedNow = () => {
    const el = scrollRef.current;
    return contained && el !== null && getComputedStyle(el).overflowY !== "visible";
  };

  const nearEnd = () => {
    const el = scrollRef.current;
    if (!el) return true;
    if (containedNow()) return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    const doc = document.documentElement;
    return doc.scrollHeight - window.scrollY - window.innerHeight < 220;
  };

  const toEnd = (smooth: boolean) => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = scrollRef.current;
    if (containedNow() && el) el.scrollTo({ top: el.scrollHeight, behavior: smooth && !calm ? "smooth" : "auto" });
    else endRef.current?.scrollIntoView({ block: "end", behavior: smooth && !calm ? "smooth" : "auto" });
    setUnseen(0);
  };

  // The latest message is where a contained pane starts. A page that scrolls
  // as a whole starts at its top instead, so the ticket's header and actions
  // are what is seen first on a phone.
  useEffect(() => {
    if (!firstScroll.current || catchingUp) return;
    firstScroll.current = false;
    if (containedNow()) toEnd(false);
  }, [catchingUp, contained]);

  useEffect(() => {
    if (arrived.length === 0) return;
    const fromViewer = arrived.every((message) => message.author.userId === viewerId);
    if (fromViewer || nearEnd()) toEnd(true);
    else setUnseen((count) => count + arrived.filter((message) => message.author.userId !== viewerId).length);
  }, [arrived]);

  // Only messages that arrive after the first render fade up; the ones that
  // were there on load are already in place.
  useLayoutEffect(() => {
    for (const message of arrived) {
      const item = document.getElementById(`dt-${message.messageId}`);
      if (!item) continue;
      item.classList.add("tk-msg-new");
      item.addEventListener("animationend", () => item.classList.remove("tk-msg-new"), { once: true });
    }
  }, [arrived]);

  const toggleActivity = (next: boolean) => {
    const el = scrollRef.current;
    if (el) {
      const contained = containedNow();
      const viewTop = contained ? el.getBoundingClientRect().top : 0;
      const first = [...el.querySelectorAll<HTMLElement>("li[id^='dt-']")].find((item) => item.getBoundingClientRect().bottom > viewTop);
      anchor.current = { atEnd: nearEnd(), id: first?.id ?? null, top: first ? first.getBoundingClientRect().top - viewTop : 0 };
    }
    setShowActivity(next);
  };

  useLayoutEffect(() => {
    const saved = anchor.current;
    anchor.current = null;
    const el = scrollRef.current;
    if (!saved || !el) return;
    if (saved.atEnd) {
      stuck.current = true;
      toEnd(false);
      return;
    }
    const item = saved.id ? document.getElementById(saved.id) : null;
    if (!item) return;
    const contained = containedNow();
    const viewTop = contained ? el.getBoundingClientRect().top : 0;
    const shift = item.getBoundingClientRect().top - viewTop - saved.top;
    if (contained) el.scrollTop += shift;
    else window.scrollBy(0, shift);
  }, [showActivity]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stuck.current = nearEnd();
      if (stuck.current) setUnseen(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const list = listRef.current;
    const observer = list
      ? new ResizeObserver(() => {
          if (stuck.current && containedNow()) el.scrollTop = el.scrollHeight;
        })
      : null;
    if (list) observer?.observe(list);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [contained]);

  return (
    <section className="tk-convo" aria-label="Conversation">
      <div className="tk-convo-scroll tk-discord" ref={scrollRef}>
        <div ref={listRef}>
          <DiscordTranscript
            messages={messages}
            channelName={ticket.channelName || `ticket-${ticketNumber(ticket)}`}
            channelId={ticket.channelId}
            topic={topic}
            activity={activity}
            names={names}
            labels={ticket.status === "open" ? OPEN_LABELS : CLOSED_LABELS}
            thread={ticket.mode === "thread"}
            showSender={showSender}
            onReply={onReply}
            headerSlot={
              <div className="tk-convo-tools" key="tools">
                {catchingUp ? (
                  <span className="tk-convo-tools-note" role="status">
                    <span className="spinner" aria-hidden="true" /> Loading the rest of the conversation
                  </span>
                ) : null}
                <span className="tk-activity-switch">
                  <Switch checked={showActivity} onChange={toggleActivity} aria-labelledby={activityLabelId} />
                  <span id={activityLabelId}>Show ticket activity</span>
                </span>
              </div>
            }
          />
        </div>
        <div ref={endRef} className="tk-convo-end" />
      </div>

      {unseen > 0 ? (
        <button type="button" className="tk-jump" onClick={() => toEnd(true)}>
          <ArrowDownIcon />
          {unseen === 1 ? "1 new message" : `${unseen} new messages`}
        </button>
      ) : null}

      {failed ? (
        <p className="tk-convo-failed" role="status">
          New messages could not be checked: {failed} Trying again shortly.
        </p>
      ) : null}

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {footer}
    </section>
  );
}
