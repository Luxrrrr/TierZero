"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { RowStatus } from "@tier0/core";
import { useToast } from "../Toaster";

/**
 * The parts of a list row that talk to the bot: the status line it can report
 * and the one-off actions it can run. Both act on the saved settings, never the
 * draft on screen, which is why the form locks them while there are edits.
 */

export type StatusState =
  | { phase: "off" }
  | { phase: "loading" }
  | { phase: "ready"; statuses: (RowStatus | null)[] }
  | { phase: "failed" };

interface StatusArgs {
  guildId: string;
  moduleId: string;
  /** The list's indexed path, as validation errors are keyed. */
  listPath: string;
  enabled: boolean;
  /** Changes whenever a save lands, so the lines are asked for again. */
  revision: number;
}

/** Fetched on mount, after a save and on request; never on a timer. */
export function useRowStatuses({ guildId, moduleId, listPath, enabled, revision }: StatusArgs) {
  const [state, setState] = useState<StatusState>({ phase: "off" });
  const [requested, setRequested] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ phase: "off" });
      return;
    }

    let current = true;
    // A line already on screen stays put while its replacement is fetched.
    setState((previous) => (previous.phase === "ready" ? previous : { phase: "loading" }));

    const url =
      `/api/guilds/${guildId}/modules/${moduleId}` +
      `/rows/${encodeURIComponent(listPath)}/status`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { statuses?: unknown };
        if (!Array.isArray(body.statuses)) throw new Error("malformed");
        if (current) setState({ phase: "ready", statuses: body.statuses as (RowStatus | null)[] });
      })
      .catch(() => {
        if (current) setState({ phase: "failed" });
      });

    return () => {
      current = false;
    };
  }, [guildId, moduleId, listPath, enabled, revision, requested]);

  const refresh = useCallback(() => setRequested((count) => count + 1), []);
  return { state, refresh };
}

export type RunResult =
  | { kind: "done" }
  | { kind: "invalid"; errors: Record<string, string> }
  | { kind: "failed" };

interface RunnerArgs {
  guildId: string;
  moduleId: string;
  onFinished(): void;
}

const UNREACHABLE = "The dashboard could not be reached. Check your connection, then try again.";

export function useRowActionRunner({ guildId, moduleId, onFinished }: RunnerArgs) {
  const { push } = useToast();
  const [running, setRunning] = useState<string | null>(null);

  const run = useCallback(
    async (
      rowPath: string,
      action: { id: string; label: string },
      input: unknown,
    ): Promise<RunResult> => {
      setRunning(`${rowPath}#${action.id}`);
      try {
        const res = await fetch(
          `/api/guilds/${guildId}/modules/${moduleId}` +
            `/rows/${encodeURIComponent(rowPath)}/actions/${encodeURIComponent(action.id)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ input }),
          },
        );

        if (res.status === 422) {
          const body = (await res.json().catch(() => ({}))) as {
            errors?: { path: string; message: string }[];
          };
          if (body.errors?.length) {
            const errors: Record<string, string> = {};
            for (const entry of body.errors) errors[entry.path] = entry.message;
            return { kind: "invalid", errors };
          }
        }

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          push({
            kind: "error",
            title: `${action.label} did not run`,
            detail: body.error ?? "The bot did not accept the request. Check it is running, then try again.",
          });
          return { kind: "failed" };
        }

        const outcome = (await res.json()) as { ok: boolean; message: string };
        push({ kind: outcome.ok ? "success" : "error", title: outcome.message });
        onFinished();
        return { kind: "done" };
      } catch {
        push({ kind: "error", title: `${action.label} did not run`, detail: UNREACHABLE });
        return { kind: "failed" };
      } finally {
        setRunning(null);
      }
    },
    [guildId, moduleId, onFinished, push],
  );

  return { run, running };
}

const TONE_DOT = { ok: "on", problem: "problem", idle: undefined } as const;

export function RowStatusLine({ status }: { status: RowStatus | "loading" }) {
  if (status === "loading") {
    return <span className="skeleton row-status-skeleton" aria-hidden="true" />;
  }
  return (
    <span className="row-status" data-tone={status.tone}>
      <span className="dot" data-status={TONE_DOT[status.tone]} aria-hidden="true" />
      <span className="row-status-text" title={status.text}>
        {status.text}
      </span>
    </span>
  );
}

interface PanelProps {
  action: { id: string; label: string; help?: string };
  initial: Record<string, unknown>;
  running: boolean;
  /** Draws the action's inputs with the form's own renderer. */
  renderFields(args: {
    value: Record<string, unknown>;
    onChange(next: Record<string, unknown>): void;
    errors: Record<string, string>;
    disabled: boolean;
  }): ReactNode;
  run(input: Record<string, unknown>): Promise<RunResult>;
  onClose(): void;
}

/** Sits under the row's header, in the flow of the page, so nothing can clip it. */
export function RowActionPanel({
  action,
  initial,
  running,
  renderFields,
  run,
  onClose,
}: PanelProps) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    root.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A picker that is open handles Escape itself and marks it as handled.
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    onClose();
  };

  async function submit() {
    setErrors({});
    const result = await run(value);
    if (result.kind === "invalid") setErrors(result.errors);
    else if (result.kind === "done") onClose();
  }

  return (
    <div
      className="list-item-panel"
      ref={root}
      role="group"
      aria-label={action.label}
      onKeyDown={onKeyDown}
    >
      {action.help ? <p className="list-item-panel-help">{action.help}</p> : null}
      {renderFields({ value, onChange: setValue, errors, disabled: running })}
      <div className="list-item-panel-actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={running} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={running}
          onClick={() => void submit()}
        >
          {running ? <span className="spinner" aria-hidden="true" /> : null}
          Run
        </button>
      </div>
    </div>
  );
}
