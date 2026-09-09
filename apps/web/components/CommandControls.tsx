"use client";

import { useState } from "react";
import useSWR from "swr";
import type { GuildCommandState } from "../lib/control-api";

interface Named {
  id: string;
  name: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Per-command controls for one module.
 *
 * A command is visible to everyone in every channel until an operator says
 * otherwise, so an empty restriction list is shown as the permissive default
 * and not as something waiting to be filled in. Each change is saved on
 * its own: there is no draft state to lose, and a failed save says which
 * command it was.
 */
export function CommandControls({
  guildId,
  commands,
}: {
  guildId: string;
  commands: GuildCommandState[];
}) {
  if (commands.length === 0) return null;

  return (
    <section className="commands">
      <h3 className="commands-title">Commands</h3>
      <p className="commands-help">
        Hide a command from this server, or limit who can use it and where. Hidden commands are
        removed from Discord entirely, not refused after somebody runs them.
      </p>
      <ul className="command-list">
        {commands.map((command) => (
          <CommandRow key={command.name} guildId={guildId} command={command} />
        ))}
      </ul>
    </section>
  );
}

type RowState = "idle" | "saving" | "error";

function CommandRow({ guildId, command }: { guildId: string; command: GuildCommandState }) {
  const [enabled, setEnabled] = useState(command.enabled);
  const [allowRoles, setAllowRoles] = useState(command.allowRoles);
  const [denyChannels, setDenyChannels] = useState(command.denyChannels);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RowState>("idle");

  async function persist(patch: Partial<GuildCommandState>) {
    setState("saving");
    try {
      const res = await fetch(
        `/api/guilds/${guildId}/commands/${encodeURIComponent(command.name)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      setState(res.ok ? "idle" : "error");
    } catch {
      setState("error");
    }
  }

  const restricted = allowRoles.length > 0 || denyChannels.length > 0;

  return (
    <li className="command-row" data-off={enabled ? undefined : "true"}>
      <div className="command-head">
        <div className="command-identity">
          <code className="command-name">/{command.name}</code>
          <p className="command-description">{command.description}</p>
        </div>

        <div className="command-actions">
          {restricted ? <span className="command-badge">Restricted</span> : null}
          <button
            type="button"
            className="btn btn-quiet"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Done" : "Restrict"}
          </button>
          <label className="switch">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                void persist({ enabled: e.target.checked });
              }}
            />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-label">{enabled ? "On" : "Off"}</span>
          </label>
        </div>
      </div>

      {state === "error" ? (
        <p className="error" role="alert">
          That change did not save. Check the bot is running and try again.
        </p>
      ) : null}

      {open ? (
        <div className="command-restrictions">
          <IdList
            label="Only these roles may use it"
            empty="Anyone can use it."
            endpoint={`/api/guilds/${guildId}/roles`}
            value={allowRoles}
            onChange={(next) => {
              setAllowRoles(next);
              void persist({ allowRoles: next });
            }}
          />
          <IdList
            label="Never in these channels"
            empty="It works in every channel."
            endpoint={`/api/guilds/${guildId}/channels`}
            value={denyChannels}
            onChange={(next) => {
              setDenyChannels(next);
              void persist({ denyChannels: next });
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

function IdList({
  label,
  empty,
  endpoint,
  value,
  onChange,
}: {
  label: string;
  empty: string;
  endpoint: string;
  value: string[];
  onChange(next: string[]): void;
}) {
  const { data } = useSWR<Named[]>(endpoint, fetcher);
  const nameFor = (id: string) => data?.find((entry) => entry.id === id)?.name ?? id;
  const remaining = (data ?? []).filter((entry) => !value.includes(entry.id));

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {value.length === 0 ? (
        <p className="help">{empty}</p>
      ) : (
        <ul className="chips">
          {value.map((id) => (
            <li key={id} className="chip">
              {nameFor(id)}
              <button
                type="button"
                aria-label={`Remove ${nameFor(id)}`}
                onClick={() => onChange(value.filter((entry) => entry !== id))}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        value=""
        disabled={!data}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value) onChange([...value, e.target.value]);
        }}
      >
        <option value="">{data ? "Add…" : "Loading…"}</option>
        {remaining.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
    </div>
  );
}
