"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FieldDescriptor } from "@tier0/core";
import { SettingsForm, Switch } from "./form";
import { CommandRow } from "./CommandRow";
import { AlertIcon, InfoIcon, SetupIcon } from "./Icons";
import { useToast } from "./Toaster";
import { moduleStatus } from "../lib/module-status";
import { hasGuidedSetup } from "../lib/guided";
import { statusWord, type ModuleView } from "../lib/module-view";

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
}

type SaveState = "idle" | "saving" | "error";

interface FieldError {
  path: string;
  message: string;
}

const BADGE_CLASS = {
  on: "badge badge-on",
  off: "badge badge-off",
  attention: "badge badge-attention",
} as const;

export function ModulePage({ guildId, serverName, eyebrow, module, embedded = false }: Props) {
  const router = useRouter();
  const { push } = useToast();

  const [enabled, setEnabled] = useState(module.enabled);
  const [togglePending, setTogglePending] = useState(false);

  const [settings, setSettings] = useState<Record<string, unknown>>(module.settings);
  const [saved, setSaved] = useState<Record<string, unknown>>(module.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [revision, setRevision] = useState(0);
  const [shortcutHint, setShortcutHint] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => setEnabled(module.enabled), [module.enabled]);

  useEffect(() => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    setShortcutHint(mac ? "⌘" : "Ctrl");
  }, []);

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const errorCount = Object.keys(errors).length;
  const status = moduleStatus(enabled, module.missing);
  // Row actions and statuses are the bot's answer about what it has saved, so
  // they say nothing useful about edits it has not seen yet.
  const actionsLocked = dirty
    ? "Save your changes first"
    : enabled
      ? null
      : "Turn this feature on first";
  const guided = hasGuidedSetup(module.schema as unknown as FieldDescriptor);

  const save = useCallback(async () => {
    setState("saving");
    setErrors({});
    setFailure(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/modules/${module.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
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
        setState("error");
        return;
      }

      setSaved(settings);
      setRevision((count) => count + 1);
      setState("idle");
      push({ kind: "success", title: "Saved. The bot is already using the new settings." });
      router.refresh();
    } catch {
      setFailure("The dashboard could not be reached. Check your connection, then try again.");
      setState("error");
    }
  }, [guildId, module.id, push, router, settings]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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

  async function toggle(next: boolean) {
    setEnabled(next);
    setTogglePending(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/modules/${module.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setEnabled(!next);
        push({
          kind: "error",
          title: `${module.name} is still ${next ? "off" : "on"}`,
          detail: body.error ?? "The bot did not accept the change. Check it is running, then try again.",
        });
        return;
      }
      router.refresh();
    } catch {
      setEnabled(!next);
      push({
        kind: "error",
        title: `${module.name} is still ${next ? "off" : "on"}`,
        detail: "The dashboard could not be reached. Check your connection, then try again.",
      });
    } finally {
      setTogglePending(false);
    }
  }

  const barState = state === "saving" ? "saving" : state === "error" ? "error" : "dirty";

  const controls = (
    <div className="page-actions">
      {guided ? (
        <Link className="btn btn-secondary btn-sm" href={`/guilds/${guildId}/${module.id}/setup`}>
          <SetupIcon />
          Walk me through it
        </Link>
      ) : null}
      {module.alwaysOn ? (
        // Part of the bot itself: there is nothing to turn on or off.
        <span className="badge badge-on">Always on</span>
      ) : (
        <>
          <span className={BADGE_CLASS[status]}>{statusWord(status)}</span>
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
                Turned on, but it will not do anything until you set:{" "}
                {module.missing.map((entry) => entry.label).join(", ")}.
                {guided ? (
                  <>
                    {" "}
                    <Link href={`/guilds/${guildId}/${module.id}/setup`}>
                      Have the wizard ask you
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
          onChange={(next) => {
            setSettings(next);
            // A failure that named no field is about the attempt, not the
            // draft, so the next edit starts clean. Field errors stay until
            // the bot accepts a save, since only it can say they are gone.
            if (state === "error" && errorCount === 0) {
              setFailure(null);
              setState("idle");
            }
          }}
        />
      </div>

      {module.commands.length > 0 ? (
        <>
          <div className="divider" />
          <section className="card">
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
          </section>
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
              onClick={() => {
                setSettings(saved);
                setErrors({});
                setFailure(null);
                setState("idle");
              }}
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
