"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FieldDescriptor } from "@tier0/core";
import { SettingsForm, Switch } from "./form";
import type { ExtraSection } from "./form/SectionedSettings";
import { CommandRow } from "./CommandRow";
import { AlertIcon, InfoIcon, SetupIcon } from "./Icons";
import { useToast } from "./Toaster";
import { missingSentence, moduleStatus } from "../lib/module-status";
import { hasGuidedSetup } from "../lib/guided";
import { type ModuleView } from "../lib/module-view";
import { settingsSections } from "../lib/settings-sections";
import { readFailure, UNREACHABLE } from "../lib/bot-errors";
import { errorsStillValid } from "../lib/field-error";
import { useUnsavedGuard } from "../lib/unsaved-guard";

interface Props {
  guildId: string;
  serverName: string;
  /** The category heading this module is filed under, shown as the eyebrow. */
  eyebrow: string;
  module: ModuleView;
  /**
   * Hosted inside another page that already carries the heading, as the
   * moderation settings are. The title block goes; the switch, status,
   * callouts, form, commands and save bar stay exactly as they are.
   */
  embedded?: boolean;
  /** Drawn between the status callouts and the form, for what a hosting area knows that the schema does not. */
  lead?: ReactNode;
  /**
   * Drawn at the top of the named parts of a split settings page. Given the
   * draft, so what it shows follows the edits, and whether the draft is
   * saved, since the bot only knows what is.
   */
  sectionIntro?(draft: {
    settings: Record<string, unknown>;
    dirty: boolean;
    enabled: boolean;
    /** Replaces the draft, as an edit in the form would, for a part that edits settings in its own way. */
    update(next: Record<string, unknown>): void;
  }): Record<string, ReactNode>;
  /** Extra parts of a split settings page, after the schema's own. */
  extraSections?: ExtraSection[];
  /** Drawn under the list of commands, inside the same card. */
  commandsFooter?: ReactNode;
}

type SaveState = "idle" | "saving" | "error";

export function ModulePage({
  guildId,
  serverName,
  eyebrow,
  module,
  embedded = false,
  lead,
  sectionIntro,
  extraSections = [],
  commandsFooter,
}: Props) {
  const router = useRouter();
  const { push } = useToast();

  const [enabled, setEnabled] = useState(module.enabled);
  const [togglePending, setTogglePending] = useState(false);
  // What the switch should end up as, and what the bot last confirmed. Rapid
  // presses only move the first; one request at a time carries it to the bot.
  const wantedEnabled = useRef(module.enabled);
  const confirmedEnabled = useRef(module.enabled);
  const toggling = useRef(false);

  const [settings, setSettings] = useState<Record<string, unknown>>(module.settings);
  const [saved, setSaved] = useState<Record<string, unknown>>(module.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // The draft the bot refused, which its field errors are about.
  const [refused, setRefused] = useState<Record<string, unknown> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [revision, setRevision] = useState(0);
  const [shortcutHint, setShortcutHint] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (toggling.current) return;
    setEnabled(module.enabled);
    wantedEnabled.current = module.enabled;
    confirmedEnabled.current = module.enabled;
  }, [module.enabled]);

  useEffect(() => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    setShortcutHint(mac ? "⌘" : "Ctrl");
  }, []);

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const errorCount = Object.keys(errors).length;
  const status = moduleStatus(enabled, module.missing);
  const hasSettings = Object.keys((module.schema as { fields?: object }).fields ?? {}).length > 0;
  // Row actions and statuses are the bot's answer about what it has saved, so
  // they say nothing useful about edits it has not seen yet.
  const actionsLocked = dirty
    ? "Save your changes first"
    : enabled
      ? null
      : "Turn this feature on first";
  const guided = hasGuidedSetup(module.schema as unknown as FieldDescriptor);
  // A split page lists the commands as one more part of it, where they are
  // found the same way as everything else, rather than under every part.
  const split = settingsSections(module.schema as unknown as FieldDescriptor) !== null;

  const save = useCallback(async (): Promise<boolean> => {
    setState("saving");
    setErrors({});
    setRefused(null);
    setFailure(null);
    const sent = settings;
    try {
      const res = await fetch(`/api/guilds/${guildId}/modules/${module.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: sent }),
      });

      if (!res.ok) {
        const refusal = await readFailure(res);
        if (refusal.fieldErrors?.length) {
          const next: Record<string, string> = {};
          for (const entry of refusal.fieldErrors) next[entry.path] = entry.message;
          setErrors(next);
          setRefused(sent);
        } else {
          setFailure(refusal.message);
        }
        setState("error");
        return false;
      }

      setSaved(sent);
      setRevision((count) => count + 1);
      setState("idle");
      push({ kind: "success", title: "Saved. The bot is already using the new settings." });
      router.refresh();
      return true;
    } catch {
      setFailure(UNREACHABLE);
      setState("error");
      return false;
    }
  }, [guildId, module.id, push, router, settings]);

  const discard = useCallback(() => {
    setSettings(saved);
    setErrors({});
    setRefused(null);
    setFailure(null);
    setState("idle");
  }, [saved]);

  const guard = useUnsavedGuard({ dirty, onSave: save, onDiscard: discard });

  // Claimed even when there is nothing to save: the browser's own Save Page
  // dialog is never what someone on a settings page meant.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!dirty || state === "saving") return;
      void save();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, save, state]);

  // A rejected save is only useful if the reader is taken to the field that
  // caused it; several groups of settings can be off the bottom of the screen.
  useEffect(() => {
    if (errorCount === 0) return;
    // A row and the field inside it are both marked; the field is the one to
    // go to, and a row's own header buttons are not what failed.
    const marked = [...(formRef.current?.querySelectorAll<HTMLElement>('[data-invalid="true"]') ?? [])];
    const field = marked.find((el) => !el.querySelector('[data-invalid="true"]'));
    if (!field) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    field.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    const controls = field.querySelectorAll<HTMLElement>(
      'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
    );
    const target = [...controls].find((el) => !el.closest(".list-item-head")) ?? controls[0];
    target?.focus({ preventScroll: true });
  }, [errors, errorCount]);

  /**
   * The switch answers at once; the bot hears only where it ends up. Each
   * request carries the latest wanted state, and a press made while one is in
   * flight is sent after it, so answers arriving out of order cannot leave the
   * switch and the bot disagreeing, and the page reloads once at the end.
   */
  async function toggle(next: boolean) {
    wantedEnabled.current = next;
    setEnabled(next);
    if (toggling.current) return;
    toggling.current = true;
    setTogglePending(true);
    let changed = false;
    try {
      while (wantedEnabled.current !== confirmedEnabled.current) {
        const target = wantedEnabled.current;
        let res: Response;
        try {
          res = await fetch(`/api/guilds/${guildId}/modules/${module.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: target }),
          });
        } catch {
          refuseToggle(target, UNREACHABLE);
          break;
        }
        if (!res.ok) {
          refuseToggle(target, (await readFailure(res)).message);
          break;
        }
        confirmedEnabled.current = target;
        changed = true;
      }
    } finally {
      toggling.current = false;
      setTogglePending(false);
    }
    if (changed) router.refresh();
  }

  function refuseToggle(target: boolean, detail: string) {
    wantedEnabled.current = confirmedEnabled.current;
    setEnabled(confirmedEnabled.current);
    push({ kind: "error", title: `${module.name} is still ${target ? "off" : "on"}`, detail });
  }

  const barState = state === "saving" ? "saving" : state === "error" ? "error" : "dirty";

  function changeDraft(next: Record<string, unknown>) {
    setSettings(next);
    // A field error is the bot's verdict on the value it was sent, so
    // it goes once that value is edited; the others stay until a save
    // the bot accepts. A failure that named no field is about the
    // attempt, not the draft, so the next edit starts clean.
    const remaining = refused ? errorsStillValid(errors, refused, next) : {};
    if (Object.keys(remaining).length !== errorCount) setErrors(remaining);
    if (state === "error" && Object.keys(remaining).length === 0) {
      setFailure(null);
      setRefused(null);
      setState("idle");
    }
  }

  const commandsCard = (
    <section className="card module-commands">
      <div className="card-header">
        <div className="card-header-text">
          <h2 className="card-title">Commands</h2>
          <p className="card-help">
            These come with this feature. Turn one off to remove it from
            Discord on this server, or limit who can use it and where.
          </p>
        </div>
      </div>
      <ul className="command-list">
        {module.commands.map((command) => (
          <CommandRow key={command.name} guildId={guildId} command={command} />
        ))}
      </ul>
      {commandsFooter}
    </section>
  );

  const controls = (
    <div className="page-actions">
      {guided ? (
        <Link className="btn btn-secondary btn-sm" href={`/guilds/${guildId}/${module.id}/setup`}>
          <SetupIcon />
          Quick setup
        </Link>
      ) : null}
      {module.alwaysOn ? (
        // Part of the bot itself: there is nothing to turn on or off.
        <span className="badge badge-on">Always on</span>
      ) : (
        <>
          {/* The switch already says On or Off; the badge is only for what it cannot say. */}
          {status === "attention" ? <span className="badge badge-attention">Needs setup</span> : null}
          <span className="switch-labelled">
            <span className="switch-text">{enabled ? "On" : "Off"}</span>
            <Switch
              checked={enabled}
              onChange={toggle}
              pending={togglePending}
              size="lg"
              aria-label={module.name}
            />
          </span>
        </>
      )}
    </div>
  );

  return (
    <>
      {embedded ? (
        <div className="module-bar">
          <h2 className="visually-hidden">{module.name}</h2>
          <p className="module-bar-summary">{module.summary}</p>
          {controls}
        </div>
      ) : (
        <div className="page-header">
          <div className="page-header-text">
            <p className="page-eyebrow">{eyebrow}</p>
            <h1 className="page-title">{module.name}</h1>
            <p className="page-summary">{module.summary}</p>
          </div>
          {controls}
        </div>
      )}

      {status === "attention" || !enabled ? (
        <div className="page-callouts">
          {status === "attention" ? (
            <div className="callout callout-attention">
              <AlertIcon />
              <div>
                Turned on, but it will not do anything until you set{" "}
                {missingSentence(module.missing)}.
                {guided ? (
                  <>
                    {" "}
                    <Link href={`/guilds/${guildId}/${module.id}/setup`}>
                      Open the quick setup
                    </Link>
                    .
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {!enabled ? (
            <div className="callout callout-muted">
              <InfoIcon />
              <div>
                This feature is off. You can still change its settings; they take
                effect when you turn it on.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {lead}

      {guard.host}

      {hasSettings ? (
        <div ref={formRef}>
          <SettingsForm
            schema={module.schema as unknown as FieldDescriptor}
            value={settings}
            guildId={guildId}
            serverName={serverName}
            errors={errors}
            disabled={state === "saving"}
            moduleId={module.id}
            rows={module.rows}
            actionsLocked={actionsLocked}
            dirty={dirty}
            savedRevision={revision}
            sectionIntro={sectionIntro?.({ settings, dirty, enabled, update: changeDraft })}
            extraSections={
              split && module.commands.length > 0
                ? [...extraSections, { id: "commands", label: "Commands", content: commandsCard }]
                : extraSections
            }
            onChange={changeDraft}
          />
        </div>
      ) : null}

      {module.commands.length > 0 && !split ? (
        <>
          {hasSettings ? <div className="divider" /> : null}
          {commandsCard}
        </>
      ) : null}

      {dirty ? (
        <div className="savebar" data-state={barState} role="region" aria-label="Unsaved changes">
          <div className="savebar-text">
            {state === "error" ? <AlertIcon /> : null}
            {state === "saving" ? "Saving…" : null}
            {state === "error" && errorCount > 0
              ? `Fix ${errorCount} field${errorCount === 1 ? "" : "s"} to save`
              : null}
            {state === "error" && errorCount === 0 ? failure : null}
            {state === "idle" ? "Unsaved changes" : null}
            {state === "idle" && shortcutHint ? (
              <span className="savebar-hint">
                <span className="kbd">{shortcutHint}</span>
                <span className="kbd">S</span>
                to save
              </span>
            ) : null}
          </div>
          <div className="savebar-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={state === "saving"}
              onClick={discard}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={state === "saving"}
              onClick={() => void save()}
            >
              {state === "saving" ? <span className="spinner" aria-hidden="true" /> : null}
              {state === "saving" ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
