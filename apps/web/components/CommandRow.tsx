"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type { GuildCommandState, GuildSubcommandState } from "../lib/control-api";
import { Combobox, MultiChannelPicker, MultiRolePicker, Switch } from "./form";
import { AlertIcon, ChevronDownIcon } from "./Icons";
import { permissionChoices, shortLabel } from "../lib/command-permissions";

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
 * where it was instead of leaving the screen disagreeing with Discord. The
 * reply text is the exception, because it is typed rather than picked.
 */
export function CommandRow({ guildId, command }: Props) {
  const [enabled, setEnabled] = useState(command.enabled);
  const [allowRoles, setAllowRoles] = useState(command.allowRoles);
  const [denyChannels, setDenyChannels] = useState(command.denyChannels);
  const [allowChannels, setAllowChannels] = useState(command.allowChannels ?? []);
  const [permissions, setPermissions] = useState(command.permissions);
  const [ephemeral, setEphemeral] = useState(command.ephemeral);
  const customReply = command.customReply;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RowState>("idle");

  const panelId = useId();
  const permissionId = useId();
  const permissionLabelId = useId();
  const visibilityLabelId = useId();
  const rolesId = useId();
  const rolesLabelId = useId();
  const channelsId = useId();
  const channelsLabelId = useId();
  const onlyId = useId();
  const onlyLabelId = useId();

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

  const displayName = command.kind === "slash" ? `/${command.name}` : command.name;

  // Private or public as the person sees it: the owner's choice, else how the command ships.
  const replyIsPrivate = ephemeral ?? command.privateByDefault;

  const accessChanged = permissions !== null || allowRoles.length > 0 || denyChannels.length > 0 || allowChannels.length > 0;
  const replyChanged = ephemeral !== null || customReply !== null;
  const changed = accessChanged || replyChanged;

  const accessSummary = [
    permissions === null
      ? command.defaultPermissions === null
        ? "Everyone"
        : shortLabel(command.defaultPermissions)
      : permissions === "everyone"
        ? "Everyone"
        : shortLabel(permissions),
    allowRoles.length > 0 ? `${allowRoles.length} ${allowRoles.length === 1 ? "role" : "roles"}` : null,
    allowChannels.length > 0 ? `only in ${allowChannels.length}` : null,
    denyChannels.length > 0 ? `off in ${denyChannels.length}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const replySummary = [command.repliesVary ? "Varies" : replyIsPrivate ? "Private" : "Public", customReply !== null ? "custom reply" : null]
    .filter(Boolean)
    .join(" · ");

  function resetPermissions() {
    const previous = permissions;
    setPermissions(null);
    void persist({ permissions: null }, () => setPermissions(previous));
  }

  function resetRoles() {
    const previous = allowRoles;
    setAllowRoles([]);
    void persist({ allowRoles: [] }, () => setAllowRoles(previous));
  }

  function resetChannels() {
    const previous = denyChannels;
    setDenyChannels([]);
    void persist({ denyChannels: [] }, () => setDenyChannels(previous));
  }

  function resetOnly() {
    const previous = allowChannels;
    setAllowChannels([]);
    void persist({ allowChannels: [] }, () => setAllowChannels(previous));
  }

  function resetVisibility() {
    const previous = ephemeral;
    setEphemeral(null);
    void persist({ ephemeral: null }, () => setEphemeral(previous));
  }

  function resetAll() {
    const before = { permissions, allowRoles, denyChannels, allowChannels, ephemeral };
    setPermissions(null);
    setAllowRoles([]);
    setDenyChannels([]);
    setAllowChannels([]);
    setEphemeral(null);
    void persist(
      { permissions: null, allowRoles: [], denyChannels: [], allowChannels: [], ephemeral: null },
      () => {
        setPermissions(before.permissions);
        setAllowRoles(before.allowRoles);
        setDenyChannels(before.denyChannels);
        setAllowChannels(before.allowChannels);
        setEphemeral(before.ephemeral);
      },
    );
  }

  function pickVisibility(wantPrivate: boolean) {
    if (wantPrivate === replyIsPrivate) return;
    const previous = ephemeral;
    // Landing back on how the command ships stores nothing.
    const next = wantPrivate === command.privateByDefault ? null : wantPrivate;
    setEphemeral(next);
    void persist({ ephemeral: next }, () => setEphemeral(previous));
  }

  return (
    <li className="command-row" data-off={enabled ? undefined : "true"} data-open={open ? "true" : undefined}>
      <div className="command-head">
        <div className="command-identity">
          <div className="command-title">
            <code className="command-name">{displayName}</code>
            {command.kind === "slash" ? null : (
              <span className="badge">
                {command.kind === "user" ? "Right-click a member" : "Right-click a message"}
              </span>
            )}
            {!enabled ? <span className="badge badge-off">Hidden</span> : null}
          </div>
          <p className="command-description">{command.description}</p>
        </div>

        <p className="command-cell" data-changed={accessChanged ? "true" : undefined}>
          <span className="command-cell-label">Access</span>
          {accessSummary}
        </p>
        <p className="command-cell" data-changed={replyChanged ? "true" : undefined}>
          <span className="command-cell-label">Reply</span>
          {replySummary}
        </p>

        <div className="command-actions">
          <span className={state === "error" ? "command-status is-error" : "command-status"} role="status">
            {state === "saving" ? "Saving…" : null}
            {state === "saved" ? "Saved" : null}
            {state === "error" ? "Not saved" : null}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm command-edit"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
          >
            Customize
            <ChevronDownIcon className="command-edit-chevron" />
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

      {(command.subcommands ?? []).length > 0 ? (
        <CommandParts guildId={guildId} label={displayName} parts={command.subcommands ?? []} />
      ) : null}

      {open ? (
        <div className="command-panel" id={panelId}>
          <div className="command-panel-bar">
            <span>{changed ? "Some settings differ from the default." : "Everything is at its default."}</span>
            {changed ? (
              <button type="button" className="link-button" onClick={resetAll}>
                Reset all to default
              </button>
            ) : null}
          </div>

          <div className="command-columns">
            <section className="command-section" aria-labelledby={`${panelId}-access`}>
              <h3 className="command-section-title" id={`${panelId}-access`}>
                Access
              </h3>

              <Labelled
                labelId={permissionLabelId}
                label="Who sees it in Discord"
                onReset={permissions !== null ? resetPermissions : undefined}
              >
                <Combobox
                  id={permissionId}
                  value={permissions ?? ""}
                  searchable={false}
                  aria-labelledby={permissionLabelId}
                  options={permissionChoices(command.defaultPermissions)}
                  onChange={(next) => {
                    const previous = permissions;
                    const value = next === undefined || next === "" ? null : next;
                    setPermissions(value);
                    void persist({ permissions: value }, () => setPermissions(previous));
                  }}
                />
                <p className="field-hint">
                  Members without it don&apos;t see the command at all. Server admins can
                  override this under Server Settings, Integrations.
                </p>
              </Labelled>

              <Labelled
                labelId={rolesLabelId}
                label="Only these roles can use it"
                onReset={allowRoles.length > 0 ? resetRoles : undefined}
              >
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
                    ? "Anyone who can see it can use it."
                    : "Everyone else gets a message saying they can't. Discord can't hide a command by role, so it stays visible to them."}
                </p>
              </Labelled>

              <Labelled
                labelId={onlyLabelId}
                label="Only in these channels"
                onReset={allowChannels.length > 0 ? resetOnly : undefined}
              >
                <MultiChannelPicker
                  id={onlyId}
                  guildId={guildId}
                  types={["text", "voice", "forum", "category"]}
                  values={allowChannels}
                  emptyLabel="Any channel"
                  addLabel="Add a channel"
                  aria-labelledby={onlyLabelId}
                  onChange={(next) => {
                    const previous = allowChannels;
                    setAllowChannels(next);
                    void persist({ allowChannels: next }, () => setAllowChannels(previous));
                  }}
                />
                <p className="field-hint">A category covers every channel in it, and a channel covers its threads.</p>
              </Labelled>

              <Labelled
                labelId={channelsLabelId}
                label="Not in these channels"
                onReset={denyChannels.length > 0 ? resetChannels : undefined}
              >
                <MultiChannelPicker
                  id={channelsId}
                  guildId={guildId}
                  types={["text", "voice", "forum", "category"]}
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
              </Labelled>
            </section>

            <section className="command-section" aria-labelledby={`${panelId}-reply`}>
              <h3 className="command-section-title" id={`${panelId}-reply`}>
                Reply
              </h3>

              {command.repliesVary ? (
                <p className="field-hint">Refusals are shown only to the person who ran it, and confirmations to the channel. The command decides for each reply, so there is nothing to choose here.</p>
              ) : (
              <Labelled
                labelId={visibilityLabelId}
                label="Who sees the reply"
                onReset={ephemeral !== null ? resetVisibility : undefined}
              >
                <div className="choice-group" role="radiogroup" aria-labelledby={visibilityLabelId}>
                  {[
                    { wantPrivate: true, label: "Private", hint: "Only the person who ran it" },
                    { wantPrivate: false, label: "Public", hint: "Everyone in the channel" },
                  ].map((choice) => (
                    <button
                      key={choice.label}
                      type="button"
                      role="radio"
                      aria-checked={replyIsPrivate === choice.wantPrivate}
                      className="choice"
                      onClick={() => pickVisibility(choice.wantPrivate)}
                    >
                      <span className="choice-label">
                        {choice.label}
                        {command.privateByDefault === choice.wantPrivate ? (
                          <span className="choice-tag">Default</span>
                        ) : null}
                      </span>
                      <span className="choice-hint">{choice.hint}</span>
                    </button>
                  ))}
                </div>
              </Labelled>
              )}

              {command.response ? (
                <p className="field-hint">
                  {customReply === null ? "This command replies the way it always has." : "This command has a reply of its own."} Rewrite it on the{" "}
                  <a href={`/guilds/${guildId}/commands`}>Commands page</a>, with the full message editor.
                </p>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The parts of a command such as /ticket, each with its own switch and limits.
 * Discord lists every part to anyone who can see the command, so the bot is
 * what turns a part away, with a message.
 */
function CommandParts({ guildId, label, parts }: { guildId: string; label: string; parts: GuildSubcommandState[] }) {
  const [shown, setShown] = useState(false);
  const listId = useId();
  const changed = parts.filter((part) => !part.enabled || part.allowRoles.length > 0 || part.denyChannels.length > 0 || part.allowChannels.length > 0).length;
  return (
    <div className="command-parts">
      <button type="button" className="link-button command-parts-toggle" aria-expanded={shown} aria-controls={listId} onClick={() => setShown(!shown)}>
        <ChevronDownIcon className="command-edit-chevron" />
        {shown ? "Hide its parts" : `Its ${parts.length} ${parts.length === 1 ? "part" : "parts"}`}
        {changed > 0 ? `, ${changed} changed` : ""}
      </button>
      {shown ? (
        <div id={listId}>
          <p className="field-hint">
            Discord shows every part of {label} to anyone who can see {label}. A part that is off or limited is
            answered with a message instead of running.
          </p>
          <ul className="command-part-list">
            {parts.map((part) => (
              <CommandPart key={part.key} guildId={guildId} part={part} parent={label} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CommandPart({ guildId, part, parent }: { guildId: string; part: GuildSubcommandState; parent: string }) {
  const [enabled, setEnabled] = useState(part.enabled);
  const [allowRoles, setAllowRoles] = useState(part.allowRoles);
  const [allowChannels, setAllowChannels] = useState(part.allowChannels);
  const [denyChannels, setDenyChannels] = useState(part.denyChannels);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RowState>("idle");
  const panelId = useId();
  const rolesLabelId = useId();
  const onlyLabelId = useId();
  const notLabelId = useId();
  const rolesId = useId();
  const onlyId = useId();
  const notId = useId();
  const label = `/${part.key}`;

  useEffect(() => {
    if (state !== "saved") return;
    const timer = window.setTimeout(() => setState("idle"), SAVED_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function persist(patch: Partial<GuildSubcommandState>, rollback: () => void) {
    setState("saving");
    try {
      const res = await fetch(`/api/guilds/${guildId}/commands/${encodeURIComponent(part.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      setState("saved");
    } catch {
      rollback();
      setState("error");
    }
  }

  const limits = [
    allowRoles.length > 0 ? `${allowRoles.length} ${allowRoles.length === 1 ? "role" : "roles"}` : null,
    allowChannels.length > 0 ? `only in ${allowChannels.length}` : null,
    denyChannels.length > 0 ? `off in ${denyChannels.length}` : null,
  ].filter(Boolean);

  return (
    <li className="command-part" data-off={enabled ? undefined : "true"}>
      <div className="command-part-head">
        <div className="command-identity">
          <code className="command-name">{label}</code>
          <p className="command-description">{part.description}</p>
        </div>
        <p className="command-cell" data-changed={limits.length > 0 ? "true" : undefined}>
          <span className="command-cell-label">Access</span>
          {limits.length > 0 ? limits.join(" · ") : `As ${parent}`}
        </p>
        <div className="command-actions">
          <span className={state === "error" ? "command-status is-error" : "command-status"} role="status">
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : null}
          </span>
          <button type="button" className="btn btn-ghost btn-sm command-edit" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
            Limit
            <ChevronDownIcon className="command-edit-chevron" />
          </button>
          <Switch
            checked={enabled}
            pending={state === "saving"}
            aria-label={label}
            onChange={(next) => {
              const previous = enabled;
              setEnabled(next);
              void persist({ enabled: next }, () => setEnabled(previous));
            }}
          />
        </div>
      </div>
      {open ? (
        <div className="command-panel command-part-panel" id={panelId}>
          <Labelled labelId={rolesLabelId} label="Only these roles can use it">
            <MultiRolePicker
              id={rolesId}
              guildId={guildId}
              values={allowRoles}
              emptyLabel={`Whoever can use ${parent}`}
              addLabel="Add a role"
              aria-labelledby={rolesLabelId}
              onChange={(next) => {
                const previous = allowRoles;
                setAllowRoles(next);
                void persist({ allowRoles: next }, () => setAllowRoles(previous));
              }}
            />
          </Labelled>
          <Labelled labelId={onlyLabelId} label="Only in these channels">
            <MultiChannelPicker
              id={onlyId}
              guildId={guildId}
              types={["text", "voice", "forum", "category"]}
              values={allowChannels}
              emptyLabel="Any channel"
              addLabel="Add a channel"
              aria-labelledby={onlyLabelId}
              onChange={(next) => {
                const previous = allowChannels;
                setAllowChannels(next);
                void persist({ allowChannels: next }, () => setAllowChannels(previous));
              }}
            />
          </Labelled>
          <Labelled labelId={notLabelId} label="Not in these channels">
            <MultiChannelPicker
              id={notId}
              guildId={guildId}
              types={["text", "voice", "forum", "category"]}
              values={denyChannels}
              emptyLabel="Works everywhere"
              addLabel="Add a channel"
              aria-labelledby={notLabelId}
              onChange={(next) => {
                const previous = denyChannels;
                setDenyChannels(next);
                void persist({ denyChannels: next }, () => setDenyChannels(previous));
              }}
            />
          </Labelled>
        </div>
      ) : null}
    </li>
  );
}

/** A field label with a Reset link that only appears once the value has moved off the default. */
function Labelled({
  labelId,
  label,
  onReset,
  children,
}: {
  labelId: string;
  label: string;
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="field-label-row">
        <span className="field-label" id={labelId}>
          {label}
        </span>
        {onReset ? (
          <button type="button" className="link-button" onClick={onReset}>
            Reset
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
