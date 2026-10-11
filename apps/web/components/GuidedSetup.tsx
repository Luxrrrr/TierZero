"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FieldDescriptor } from "@tier0/core";
import { SettingsForm } from "./form";
import { AlertIcon, CheckIcon, ChevronRightIcon, InfoIcon } from "./Icons";
import { missingEssentials } from "../lib/module-status";
import { moduleHref, type ModuleArea } from "../lib/module-href";

export interface GuidedStep {
  moduleId: string;
  /** Where this module's full settings live, when that is not its own page. */
  area?: ModuleArea | null;
  name: string;
  summary: string;
  /** The schema reduced to what this step asks about. */
  schema: FieldDescriptor;
  /** The module's whole settings object, not just the part on screen. */
  settings: Record<string, unknown>;
  enabled: boolean;
}

interface Props {
  guildId: string;
  serverName: string;
  title: string;
  blurb: string;
  steps: GuidedStep[];
}

type Outcome = "on" | "skipped";

interface FieldError {
  path: string;
  message: string;
}

/**
 * The quick setup. One feature per step, showing only the settings its schema
 * tagged as worth asking about, and turning the feature on at the end of each.
 *
 * Each step saves as it is finished rather than everything landing at the end.
 * Leaving halfway then keeps what was already answered, and the bot is using
 * each feature the moment its step is done, which is the same promise the
 * settings pages make.
 */
export function GuidedSetup({ guildId, serverName, title, blurb, steps }: Props) {
  const router = useRouter();

  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>(() =>
    Object.fromEntries(steps.map((step) => [step.moduleId, step.settings])),
  );
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const done = index >= steps.length;
  const step = done ? undefined : steps[index];

  // The step heading is the only thing that changes between steps, so moving
  // focus there is what tells a screen reader the page moved on at all.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [index]);

  // A rejected save is only useful if it puts the reader on the field at fault.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    const field = formRef.current?.querySelector<HTMLElement>('[data-invalid="true"]');
    field?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [errors]);

  const advance = useCallback((moduleId: string, outcome: Outcome) => {
    setOutcomes((current) => ({ ...current, [moduleId]: outcome }));
    setErrors({});
    setFailure(null);
    setIndex((current) => current + 1);
  }, []);

  async function saveAndContinue() {
    if (!step) return;
    setSaving(true);
    setErrors({});
    setFailure(null);

    try {
      const res = await fetch(`/api/guilds/${guildId}/modules/${step.moduleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // The module's whole settings object, not only what this step drew:
        // anything the wizard leaves out has to survive the write.
        body: JSON.stringify({ enabled: true, settings: drafts[step.moduleId] ?? step.settings }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          errors?: FieldError[];
        };
        if (body.errors?.length) {
          const next: Record<string, string> = {};
          for (const entry of body.errors) next[entry.path] = entry.message;
          setErrors(next);
        } else {
          setFailure(body.error ?? "The bot did not accept these settings. Try again.");
        }
        return;
      }

      router.refresh();
      advance(step.moduleId, "on");
    } catch {
      setFailure("The dashboard could not be reached. Check your connection, then try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-eyebrow">Quick setup</p>
          <h1 className="page-title">{title}</h1>
          <p className="page-summary">{blurb}</p>
        </div>
      </div>

      <ol className="wizard-steps" aria-label="Progress">
        {steps.map((entry, position) => {
          const state =
            position < index ? (outcomes[entry.moduleId] ?? "on") : position === index ? "current" : "todo";
          return (
            <li key={entry.moduleId} className="wizard-step" data-state={state}>
              <span className="wizard-step-marker" aria-hidden="true">
                {state === "on" ? <CheckIcon /> : position + 1}
              </span>
              <span className="wizard-step-name">{entry.name}</span>
              {state === "skipped" ? <span className="wizard-step-note">Skipped</span> : null}
              {position === index ? <span className="visually-hidden">, current step</span> : null}
            </li>
          );
        })}
        <li className="wizard-step" data-state={done ? "current" : "todo"}>
          <span className="wizard-step-marker" aria-hidden="true">
            {steps.length + 1}
          </span>
          <span className="wizard-step-name">Finish</span>
        </li>
      </ol>

      {step ? (
        <>
          <div className="wizard-head">
            <p className="wizard-count">
              Step {index + 1} of {steps.length}
            </p>
            <h2 className="wizard-title" tabIndex={-1} ref={headingRef}>
              {step.name}
            </h2>
            <p className="wizard-summary">{step.summary}</p>
          </div>

          {failure ? (
            <div className="wizard-callouts">
              <div className="callout callout-error">
                <AlertIcon />
                <div>{failure}</div>
              </div>
            </div>
          ) : null}

          <div ref={formRef}>
            <SettingsForm
              schema={step.schema}
              value={drafts[step.moduleId] ?? step.settings}
              guildId={guildId}
              serverName={serverName}
              errors={errors}
              disabled={saving}
              generalLabel="Basics"
              onChange={(next) =>
                setDrafts((current) => ({ ...current, [step.moduleId]: next }))
              }
            />
          </div>

          <div className="wizard-actions">
            <div className="wizard-actions-back">
              {index > 0 ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={saving}
                  onClick={() => setIndex(index - 1)}
                >
                  Back
                </button>
              ) : null}
            </div>
            <div className="wizard-actions-forward">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => advance(step.moduleId, "skipped")}
              >
                Skip for now
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void saveAndContinue()}
              >
                {saving ? <span className="spinner" aria-hidden="true" /> : null}
                {saving ? "Saving…" : index === steps.length - 1 ? "Save and finish" : "Save and continue"}
              </button>
            </div>
          </div>

          <p className="wizard-foot">
            Every setting here can be changed later, and there is more to each
            feature than the wizard asks about. Skipping a step leaves the
            feature exactly as it is.
          </p>
        </>
      ) : (
        <Finished
          guildId={guildId}
          steps={steps}
          drafts={drafts}
          outcomes={outcomes}
          headingRef={headingRef}
        />
      )}
    </>
  );
}

interface FinishedProps {
  guildId: string;
  steps: GuidedStep[];
  drafts: Record<string, Record<string, unknown>>;
  outcomes: Record<string, Outcome>;
  /** Shared with the step heading, so arriving here moves focus like any step. */
  headingRef: RefObject<HTMLHeadingElement>;
}

/**
 * What the run actually changed. A feature turned on while still missing an
 * essential setting is called out here rather than left to be discovered when
 * somebody wonders why nothing happens.
 */
function Finished({ guildId, steps, drafts, outcomes, headingRef }: FinishedProps) {
  const turnedOn = steps.filter((step) => outcomes[step.moduleId] === "on");
  const skipped = steps.filter((step) => outcomes[step.moduleId] === "skipped");

  const incomplete = turnedOn
    .map((step) => ({
      step,
      missing: missingEssentials(step.schema, drafts[step.moduleId] ?? step.settings),
    }))
    .filter((entry) => entry.missing.length > 0);

  return (
    <>
      <div className="wizard-head">
        <h2 className="wizard-title" tabIndex={-1} ref={headingRef}>
          {turnedOn.length > 0 ? "That is everything" : "Nothing was changed"}
        </h2>
        <p className="wizard-summary">
          {turnedOn.length > 0
            ? "The bot is already using these settings. No restart, nothing to deploy."
            : "Every step was skipped, so this server is exactly as you left it."}
        </p>
      </div>

      {incomplete.length > 0 ? (
        <div className="wizard-callouts">
          {incomplete.map(({ step, missing }) => (
            <div className="callout callout-attention" key={step.moduleId}>
              <AlertIcon />
              <div>
                {step.name} is on, but stays idle until you set:{" "}
                {missing.map((entry) => entry.label).join(", ")}.{" "}
                <Link href={moduleHref(guildId, { id: step.moduleId, area: step.area })}>Finish setting it up</Link>.
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {turnedOn.length > 0 ? (
        <section className="card">
          <div className="card-header">
            <div className="card-header-text">
              <h3 className="card-title">Turned on</h3>
              <p className="card-help">
                Each of these has more settings than the wizard asked about.
              </p>
            </div>
          </div>
          <ul className="wizard-outcome-list">
            {turnedOn.map((step) => (
              <li key={step.moduleId}>
                <Link className="wizard-outcome" href={moduleHref(guildId, { id: step.moduleId, area: step.area })}>
                  <span className="dot" data-status="on" aria-hidden="true" />
                  <span className="wizard-outcome-text">
                    <span className="wizard-outcome-name">{step.name}</span>
                    <span className="wizard-outcome-summary">{step.summary}</span>
                  </span>
                  <ChevronRightIcon className="chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {skipped.length > 0 ? (
        <div className="wizard-callouts">
          <div className="callout callout-muted">
            <InfoIcon />
            <div>
              Skipped: {skipped.map((step) => step.name).join(", ")}. You can run
              this again whenever you want, from Quick setup in the sidebar.
            </div>
          </div>
        </div>
      ) : null}

      <div className="wizard-actions">
        <div className="wizard-actions-back">
          <Link className="btn btn-ghost" href="/help">
            Read the help page
          </Link>
        </div>
        <div className="wizard-actions-forward">
          <Link className="btn btn-secondary" href={`/guilds/${guildId}/setup`}>
            Set up something else
          </Link>
          <Link className="btn btn-primary" href={`/guilds/${guildId}`}>
            Back to the server
          </Link>
        </div>
      </div>
    </>
  );
}
