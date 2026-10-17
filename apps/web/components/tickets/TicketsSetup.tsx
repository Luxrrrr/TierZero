"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TicketContextDto, TicketPanelPostResult } from "@tier0/core";
import { ChannelPicker, Field, MultiRolePicker } from "../form";
import { AlertIcon, CheckIcon, ExternalLinkIcon, InfoIcon } from "../Icons";
import { readFailure, UNREACHABLE } from "../../lib/bot-errors";
import { healthLines, panelPostCheck, shownIssues } from "../../lib/ticket-health";
import {
  applyAnswers,
  hasMoreThanSetupEdits,
  messageLink,
  readAnswers,
  unanswered,
  unansweredSentence,
  type OpeningMode,
  type SetupAnswers,
} from "../../lib/ticket-setup";
import { ticketsClient } from "../../lib/tickets-client";
import { useUnsavedGuard } from "../../lib/unsaved-guard";

interface Props {
  guildId: string;
  serverName: string;
  /** The module's whole settings, so everything the questions do not touch is sent back as it was. */
  settings: Record<string, unknown>;
  enabled: boolean;
}

/** Where the run stands. `partial`: the settings are saved but the panel is not up yet. */
type Phase = "asking" | "working" | "done" | "partial";

interface Outcome {
  posted: TicketPanelPostResult | null;
  /** Why the panel is not up, when it is not. */
  stopped: string | null;
  context: TicketContextDto | null;
}

/**
 * The Tickets quick setup: where the panel goes, who answers, where tickets
 * open, and then it saves, turns Tickets on and posts the panel. It ends on
 * what the bot found afterwards rather than on a promise, because a setup
 * that says "that is everything" while members still cannot open a ticket
 * has not finished the job.
 */
export function TicketsSetup({ guildId, serverName, settings, enabled }: Props) {
  const router = useRouter();
  const [stored, setStored] = useState(() => readAnswers(settings));
  const [answers, setAnswers] = useState<SetupAnswers>(stored);
  const [phase, setPhase] = useState<Phase>("asking");
  const [failure, setFailure] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ids = { channel: useId(), handlers: useId(), mode: useId(), category: useId(), log: useId() };

  const dirty = phase === "asking" && JSON.stringify(answers) !== JSON.stringify(stored);
  const guard = useUnsavedGuard({ dirty, onDiscard: () => setAnswers(stored) });

  const missing = unanswered(answers);
  const busy = phase === "working";
  const finished = phase === "done" || phase === "partial";

  useEffect(() => {
    if (finished) headingRef.current?.focus();
  }, [finished]);

  const change = (patch: Partial<SetupAnswers>) => {
    setAnswers((current) => ({ ...current, ...patch }));
    setFailure(null);
    setProblems([]);
  };

  async function run() {
    if (missing.length > 0 || busy) return;
    setPhase("working");
    setFailure(null);
    setProblems([]);

    let saved: Response;
    try {
      saved = await fetch(`/api/guilds/${guildId}/modules/tickets`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, settings: applyAnswers(settings, answers) }),
      });
    } catch {
      setFailure(UNREACHABLE);
      setPhase("asking");
      return;
    }
    if (!saved.ok) {
      const refusal = await readFailure(saved);
      setFailure(refusal.message);
      setProblems((refusal.fieldErrors ?? []).map((entry) => entry.message));
      setPhase("asking");
      return;
    }
    setStored(answers);
    router.refresh();

    // The panel's id is made by the bot on first save, so it is read back rather than guessed.
    const read = await ticketsClient.context(guildId);
    const context = read.ok ? read.value : null;
    const panel = context?.panels[0];
    if (!context || !panel) {
      setOutcome({ posted: null, context, stopped: "Your answers are saved, but the bot did not say which panel to post. Open the panel under Settings and post it from there." });
      setPhase("partial");
      return;
    }

    const check = panelPostCheck(panel.id, context.panels, context.health);
    if (check.refuse) {
      setOutcome({ posted: null, context, stopped: check.refuse });
      setPhase("partial");
      return;
    }
    await post(panel.id, context);
  }

  async function post(panelId: string, known: TicketContextDto | null) {
    setPhase("working");
    const result = await ticketsClient.postPanel(guildId, panelId);
    const after = await ticketsClient.context(guildId);
    const context = after.ok ? after.value : known;
    if (!result.ok) {
      setOutcome({ posted: null, context, stopped: `The panel was not posted. ${result.error}` });
      setPhase("partial");
      return;
    }
    setOutcome({ posted: result.value, context, stopped: null });
    setPhase("done");
  }

  const stillBroken = outcome?.context ? healthLines(guildId, shownIssues(outcome.context), outcome.context.panels).filter((line) => line.tone === "danger") : [];

  if (finished && outcome) {
    const up = outcome.posted !== null;
    const working = up && stillBroken.length === 0;
    return (
      <>
        <div className="page-header">
          <div className="page-header-text">
            <p className="page-eyebrow">Quick setup</p>
            <h1 className="page-title">Tickets</h1>
          </div>
        </div>
        <div className="wizard-head">
          <h2 className="wizard-title" tabIndex={-1} ref={headingRef}>
            {working ? "Members can open tickets" : up ? "The panel is up, with one thing left" : "Saved, but the panel is not up yet"}
          </h2>
          <p className="wizard-summary">
            {working
              ? "The panel is posted and new tickets will arrive in the inbox."
              : up
                ? "Fix this, then members can open tickets."
                : "Your answers are saved and Tickets is on."}
          </p>
        </div>

        {outcome.stopped ? (
          <div className="wizard-callouts">
            <div className="callout callout-error" role="alert">
              <AlertIcon />
              <div>{outcome.stopped}</div>
            </div>
          </div>
        ) : null}

        {stillBroken.length > 0 ? (
          <div className="wizard-callouts">
            {stillBroken.map((line) => (
              <div className="callout callout-attention" key={`${line.code}-${line.title}`}>
                <AlertIcon />
                <div>
                  <strong>{line.title}.</strong> {line.detail}{" "}
                  {line.fix ? <Link href={line.fix.href}>{line.fix.label}</Link> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {working ? (
          <section className="card">
            <ul className="tk-setup-done">
              <li>
                <CheckIcon />
                <span>Tickets is on.</span>
              </li>
              <li>
                <CheckIcon />
                <span>
                  The panel is {outcome.posted?.updated ? "updated" : "posted"} in Discord.{" "}
                  {outcome.posted ? (
                    <a href={messageLink(guildId, outcome.posted.channelId, outcome.posted.messageId)} target="_blank" rel="noopener noreferrer" className="tk-ext">
                      View it
                      <ExternalLinkIcon />
                      <span className="visually-hidden"> (opens Discord)</span>
                    </a>
                  ) : null}
                </span>
              </li>
              <li>
                <CheckIcon />
                <span>Press its button yourself to see what a member sees.</span>
              </li>
            </ul>
          </section>
        ) : null}

        <div className="wizard-actions">
          <div className="wizard-actions-back">
            {phase === "partial" && outcome.context?.panels[0] ? (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void post(outcome.context!.panels[0]!.id, outcome.context)}>
                Try posting again
              </button>
            ) : null}
          </div>
          <div className="wizard-actions-forward">
            <Link className="btn btn-secondary" href={`/guilds/${guildId}/tickets/settings`}>
              All ticket settings
            </Link>
            <Link className="btn btn-primary" href={`/guilds/${guildId}/tickets`}>
              Open the inbox
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-eyebrow">Quick setup</p>
          <h1 className="page-title">Tickets</h1>
          <p className="page-summary">
            Three questions, then the panel goes up in {serverName}. Everything else keeps the value it has and can be
            changed under Settings.
          </p>
        </div>
      </div>

      {failure ? (
        <div className="wizard-callouts">
          <div className="callout callout-error" role="alert">
            <AlertIcon />
            <div>
              {failure}
              {problems.length > 0 ? (
                <ul className="tk-setup-problems">
                  {problems.map((problem, index) => (
                    <li key={index}>{problem}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="tk-setup">
        <Field id={ids.channel} label="Where should the panel go?" help="Members press a button on it to open a ticket. Pick a channel they can read, such as #support.">
          {(chrome) => (
            <ChannelPicker
              id={chrome.id}
              guildId={guildId}
              types={["text"]}
              value={answers.channelId}
              onChange={(next) => change({ channelId: next })}
              disabled={busy}
              hideTickets
              aria-labelledby={chrome.labelId}
              aria-describedby={chrome.describedBy}
            />
          )}
        </Field>

        <Field id={ids.handlers} label="Which roles answer tickets?" help="They see every ticket the panel opens and can reply to it, here and in Discord." labelFor={false}>
          {(chrome) => (
            <MultiRolePicker
              id={chrome.id}
              guildId={guildId}
              values={answers.handlers}
              onChange={(next) => change({ handlers: next })}
              disabled={busy}
              addLabel="Add a role"
              emptyLabel="No role yet"
              aria-labelledby={chrome.labelId}
              aria-describedby={chrome.describedBy}
            />
          )}
        </Field>

        <fieldset className="tk-setup-mode" disabled={busy}>
          <legend className="field-label">How should tickets open?</legend>
          {(
            [
              { value: "channel", label: "A private channel for each ticket", why: "The usual choice. Needs a category to create them in." },
              { value: "thread", label: "A private thread in the panel's channel", why: "No category and no 50 channel limit." },
            ] as { value: OpeningMode; label: string; why: string }[]
          ).map((option) => (
            <label key={option.value} className="tk-choice" data-checked={answers.mode === option.value ? "true" : undefined}>
              <input type="radio" name={ids.mode} value={option.value} checked={answers.mode === option.value} onChange={() => change({ mode: option.value })} />
              <span className="tk-choice-text">
                {option.label}
                <span className="tk-choice-why">{option.why}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {answers.mode === "channel" ? (
          <Field id={ids.category} label="Which category are they created in?" help="A category is the heading channels sit under. Members and staff only see the ones they are added to.">
            {(chrome) => (
              <ChannelPicker
                id={chrome.id}
                guildId={guildId}
                types={["category"]}
                value={answers.category}
                onChange={(next) => change({ category: next })}
                disabled={busy}
                aria-labelledby={chrome.labelId}
                aria-describedby={chrome.describedBy}
              />
            )}
          </Field>
        ) : null}

        <Field
          id={ids.log}
          label="Where should closed tickets be logged?"
          help="The transcript of each closed ticket is posted here. Leave it empty to keep transcripts in the dashboard only."
          optional
        >
          {(chrome) => (
            <ChannelPicker
              id={chrome.id}
              guildId={guildId}
              types={["text"]}
              value={answers.logChannel}
              onChange={(next) => change({ logChannel: next })}
              disabled={busy}
              clearable
              hideTickets
              aria-labelledby={chrome.labelId}
              aria-describedby={chrome.describedBy}
            />
          )}
        </Field>
      </div>

      {hasMoreThanSetupEdits(settings) ? (
        <div className="wizard-callouts">
          <div className="callout callout-muted">
            <InfoIcon />
            <div>
              This server has more than one panel or ticket type. The questions are about the first of each. The rest are
              under <Link href={`/guilds/${guildId}/tickets/settings#section-panels`}>Settings, Panels</Link>.
            </div>
          </div>
        </div>
      ) : null}

      {guard.host}

      <div className="wizard-actions">
        <div className="wizard-actions-back">
          <Link className="btn btn-ghost" href={`/guilds/${guildId}/tickets/settings`}>
            Use the full settings
          </Link>
        </div>
        <div className="wizard-actions-forward">
          <button type="button" className="btn btn-primary" aria-disabled={missing.length > 0 || busy || undefined} onClick={() => void run()}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {busy ? "Saving and posting" : enabled ? "Save and post the panel" : "Turn on and post the panel"}
          </button>
        </div>
      </div>
      {missing.length > 0 ? (
        <p className="wizard-foot" role="status">
          Still to answer: {unansweredSentence(missing)}.
        </p>
      ) : (
        <p className="wizard-foot">
          This turns Tickets on, saves your answers and posts the panel in Discord. You can change every one of them later.
        </p>
      )}
    </>
  );
}
