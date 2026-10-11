"use client";

import { useEffect, useId, useState } from "react";
import type { GuildCommandState } from "../lib/control-api";
import { MultiChannelPicker, MultiRolePicker, Switch } from "./form";
import { AlertIcon } from "./Icons";

interface Props {
  guildId: string;
  command: GuildCommandState;
}

type RowState = "idle" | "saving" | "saved" | "error";

const SAVED_LINGER_MS = 2000;

/**
 * One command, on the commands page and on its own module's page.
 *
 * A command is usable by everyone in every channel until an operator says
 * otherwise, so an empty restriction list is shown as that permissive default
 * rather than as something waiting to be filled in. Every change is written on
 * its own: there is no draft to lose, and a failed write puts the control back
 * where it was instead of leaving the screen disagreeing with Discord.
 */
export function CommandRow({ guildId, command }: Props) {
  const [enabled, setEnabled] = useState(command.enabled);
  const [allowRoles, setAllowRoles] = useState(command.allowRoles);
  const [denyChannels, setDenyChannels] = useState(command.denyChannels);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RowState>("idle");

  const panelId = useId();
  const rolesId = useId();
  const rolesLabelId = useId();
  const channelsId = useId();
  const channelsLabelId = useId();

  useEffect(() => setEnabled(command.enabled), [command.enabled]);

  useEffect(() => {
    if (state !== "saved") return;
    const timer = window.setTimeout(() => setState("idle"), SAVED_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function persist(patch: Partial<GuildCommandState>, rollback: () => void) {
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
      if (!res.ok) {
        rollback();
        setState("error");
        return;
      }
      setState("saved");
    } catch {
      rollback();
      setState("error");
    }
  }

  const restricted = allowRoles.length > 0 || denyChannels.length > 0;
  const displayName = command.kind === "slash" ? `/${command.name}` : command.name;

  return (
    <li className="command-row" data-off={enabled ? undefined : "true"}>
      <div className="command-head">
        <div className="command-identity">
          <code className="command-name">{displayName}</code>
          {command.kind === "slash" ? null : (
            <span className="badge">{command.kind === "user" ? "Right-click a member" : "Right-click a message"}</span>
          )}
          <p className="command-description">{command.description}</p>
        </div>

        <div className="command-actions">
          {!enabled ? <span className="badge badge-off">Hidden</span> : null}
          {restricted ? <span className="badge">Restricted</span> : null}
          <span className={state === "error" ? "command-status is-error" : "command-status"} role="status">
            {state === "saving" ? "Saving…" : null}
            {state === "saved" ? "Saved" : null}
            {state === "error" ? "Not saved" : null}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
          >
            Restrict
          </button>
          <Switch
            checked={enabled}
            onChange={(next) => {
              const previous = enabled;
              setEnabled(next);
              void persist({ enabled: next }, () => setEnabled(previous));
            }}
            pending={state === "saving"}
            aria-label={displayName}
          />
        </div>
      </div>

      {state === "error" ? (
        <p className="field-error" role="alert">
          <AlertIcon />
          That change did not save. Check the bot is running, then try again.
        </p>
      ) : null}

      {open ? (
        <div className="command-restrictions" id={panelId}>
          <div className="field">
            <span className="field-label" id={rolesLabelId}>
              Only these roles can use it
            </span>
            <MultiRolePicker
              id={rolesId}
              guildId={guildId}
              values={allowRoles}
              emptyLabel="Anyone"
              addLabel="Add a role"
              aria-labelledby={rolesLabelId}
              onChange={(next) => {
                const previous = allowRoles;
                setAllowRoles(next);
                void persist({ allowRoles: next }, () => setAllowRoles(previous));
              }}
            />
            <p className="field-hint">
              {allowRoles.length === 0
                ? "Anyone can use it."
                : "Nobody outside these roles sees it in Discord."}
            </p>
          </div>

          <div className="field">
            <span className="field-label" id={channelsLabelId}>
              Not in these channels
            </span>
            <MultiChannelPicker
              id={channelsId}
              guildId={guildId}
              types={["text"]}
              values={denyChannels}
              emptyLabel="Works everywhere"
              addLabel="Add a channel"
              aria-labelledby={channelsLabelId}
              onChange={(next) => {
                const previous = denyChannels;
                setDenyChannels(next);
                void persist({ denyChannels: next }, () => setDenyChannels(previous));
              }}
            />
            <p className="field-hint">
              {denyChannels.length === 0
                ? "It works in every channel."
                : "It works in every other channel."}
            </p>
          </div>
        </div>
      ) : null}
    </li>
  );
}
