"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { MessageBody } from "@tier0/core";
import type { GuildCommandState } from "../lib/control-api";
import { permissionChoices, shortLabel } from "../lib/command-permissions";
import { channelModeOf, channelSummary, type ChannelMode } from "../lib/commands";
import { Combobox, MultiChannelPicker, MultiRolePicker } from "./form";
import { AlertIcon, ChevronDownIcon, XIcon } from "./Icons";
import { ReplyEditor } from "./messages/ReplyEditor";

/** What an owner can change about one command. The rest of the command is fixed by its module. */
export interface CommandValues {
  enabled: boolean;
  allowRoles: string[];
  denyChannels: string[];
  /** When not empty, the only channels it works in. */
  allowChannels: string[];
  permissions: string | null;
  ephemeral: boolean | null;
  customReply: MessageBody | null;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

type Section = "who" | "channels" | "reply";

/** Who can use a command is one question with three answers, however it is stored. */
type Who = "default" | "permission" | "roles";

function whoOf(value: CommandValues): Who {
  if (value.allowRoles.length > 0) return "roles";
  return value.permissions !== null ? "permission" : "default";
}

interface Props {
  guildId: string;
  command: GuildCommandState;
  /** False when the command's feature is off, which keeps it out of Discord whatever is set here. */
  featureOn: boolean;
  featureName: string;
  value: CommandValues;
  /**
   * Set when this is one part of a command, such as /ticket close, to the
   * whole command's name. A part has no permission or reply of its own.
   */
  partOf?: string;
  status: SaveState;
  onPatch(change: Partial<CommandValues>): void;
  onClose(): void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** How many of the owner's settings differ from how the command ships. */
export function changedCount(value: CommandValues): number {
  return [
    value.permissions !== null,
    value.allowRoles.length > 0,
    value.denyChannels.length > 0 || value.allowChannels.length > 0,
    value.ephemeral !== null,
    value.customReply !== null,
  ].filter(Boolean).length;
}

/**
 * One command's settings, in a sheet over the list. The four settings sit in
 * sections that show their current value when closed, so what is set can be
 * read without opening anything, and only one section is open at a time.
 * Everything saves as it is changed except the reply text, which is typed and
 * so waits for Save.
 */
export function CommandSheet({ guildId, command, featureOn, featureName, value, partOf, status, onPatch, onClose }: Props) {
  const [open, setOpen] = useState<Section>("who");
  const [who, setWho] = useState<Who>(() => whoOf(value));
  const [where, setWhere] = useState<ChannelMode>(() => channelModeOf(value));
  const [editingReply, setEditingReply] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ids = {
    roles: useId(),
    rolesLabel: useId(),
    permission: useId(),
    permissionLabel: useId(),
    channels: useId(),
    channelsLabel: useId(),
    text: useId(),
    textHint: useId(),
    visibility: useId(),
  };

  // Another command, or a reset, puts the answer back to what is stored.
  useEffect(() => {
    setWho(whoOf(value));
    setWhere(channelModeOf(value));
  }, [command.name]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [command.name]);

  const displayName = command.kind === "slash" ? `/${command.name}` : command.name;
  const replyIsPrivate = value.ephemeral ?? command.privateByDefault;
  const changed = changedCount(value);
  const choices = partOf ? [] : permissionChoices(command.defaultPermissions);

  const whoSummary =
    value.allowRoles.length > 0
      ? `${value.allowRoles.length} ${value.allowRoles.length === 1 ? "role" : "roles"}`
      : value.permissions === null
        ? partOf
          ? `Same as ${partOf}`
          : defaultLabelShort(command.defaultPermissions)
        : value.permissions === "everyone"
          ? "Everyone"
          : shortLabel(value.permissions);
  const stricter = choices.filter((choice) => !choice.isDefault);
  const channelsSummary = channelSummary(value);
  const replySummary = [command.repliesVary ? "Varies" : replyIsPrivate ? "Private" : "Public", value.customReply !== null ? "custom reply" : null]
    .filter(Boolean)
    .join(" · ");

  // Escape closes, and Tab stays inside the sheet while the list behind it is dimmed.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (node) => node.offsetParent !== null,
    );
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function toggle(section: Section) {
    setOpen((current) => (current === section ? current : section));
  }

  function head(section: Section, title: string, summary: string, isChanged: boolean) {
    const expanded = open === section;
    return (
      <button
        type="button"
        className="sheet-acc-head"
        aria-expanded={expanded}
        aria-controls={`${ids.visibility}-${section}`}
        onClick={() => toggle(section)}
      >
        <span className="sheet-acc-title">{title}</span>
        <span className="sheet-acc-value" data-changed={isChanged ? "true" : undefined}>
          {summary}
          <ChevronDownIcon className="sheet-acc-chevron" />
        </span>
      </button>
    );
  }

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Settings for ${displayName}`}
        onKeyDown={onKeyDown}
      >
        <header className="sheet-head">
          <div className="sheet-title">
            <span className="cmd-tile" data-kind={command.kind === "slash" ? "slash" : "menu"} aria-hidden="true">
              {command.kind === "slash" ? "/" : "↗"}
            </span>
            <div>
              <h2 className="sheet-name">{displayName}</h2>
              <p className="sheet-desc">{command.description}</p>
            </div>
          </div>
          <button type="button" ref={closeRef} className="sheet-close" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </header>

        <div className="sheet-status">
          <span className="sheet-status-text">
            <span className={changed > 0 ? "cmd-pill is-changed" : "cmd-pill"}>
              <i aria-hidden="true" />
              {changed > 0 ? "Customized" : "Default"}
            </span>
            <span>
              {changed === 0
                ? "Nothing changed from how it ships"
                : `${changed} ${changed === 1 ? "setting" : "settings"} changed`}
            </span>
          </span>
          {changed > 0 ? (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setWho("default");
                setWhere("everywhere");
                // A part has only these three; the bot refuses the others for it.
                onPatch(
                  partOf
                    ? { allowRoles: [], denyChannels: [], allowChannels: [] }
                    : { permissions: null, allowRoles: [], denyChannels: [], allowChannels: [], ephemeral: null, customReply: null },
                );
              }}
            >
              Reset all
            </button>
          ) : null}
        </div>

        {partOf ? (
          <p className="sheet-feature-off" role="note">
            Discord can&apos;t hide part of a command: everyone who can see {partOf} sees every part of it. When this
            part is off, or limited to roles or channels, the bot answers with a message instead of running it.
            {value.enabled ? null : " It is off now."}
          </p>
        ) : null}

        {featureOn ? null : (
          <p className="sheet-feature-off" role="note">
            {featureName} is off, so this command is not in Discord. What you set here is kept and applies once
            it is on.
          </p>
        )}

        <div className="sheet-body">
          <section className="sheet-acc">
            {head("who", "Who can use it", whoSummary, value.permissions !== null || value.allowRoles.length > 0)}
            {open === "who" ? (
              <div className="sheet-acc-body" id={`${ids.visibility}-who`}>
                <div role="radiogroup" aria-label="Who can use it">
                  {[
                    {
                      id: "default" as const,
                      title: partOf
                        ? `Same as ${partOf}`
                        : defaultLabelShort(command.defaultPermissions) === "Everyone"
                          ? "Everyone"
                          : `Members with ${defaultLabelShort(command.defaultPermissions)}`,
                      hint: partOf ? "Whoever can use the whole command" : "How the command ships",
                      isDefault: true,
                    },
                    ...(stricter.length > 0
                      ? [
                          {
                            id: "permission" as const,
                            title: "Members with a permission",
                            hint: "Everyone else doesn't see the command in Discord",
                            isDefault: false,
                          },
                        ]
                      : []),
                    {
                      id: "roles" as const,
                      title: "Only certain roles",
                      hint: partOf
                        ? `Everyone who can use ${partOf} sees this part, but only these roles can run it`
                        : command.defaultPermissions === null
                          ? "Everyone sees it, but only these roles can run it"
                          : `Still hidden from members without ${defaultLabelShort(command.defaultPermissions)}`,
                      isDefault: false,
                    },
                  ].map((option) => (
                    <div key={option.id} className="sheet-option-wrap" data-selected={who === option.id ? "true" : undefined}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={who === option.id}
                        className="sheet-option"
                        onClick={() => {
                          if (who === option.id) return;
                          setWho(option.id);
                          if (option.id === "default") onPatch({ permissions: null, allowRoles: [] });
                          else if (option.id === "permission") onPatch({ permissions: stricter[0]?.value ?? null, allowRoles: [] });
                          else onPatch({ permissions: null });
                        }}
                      >
                        <span className="sheet-radio" aria-hidden="true" />
                        <span className="sheet-option-text">
                          {option.title}
                          <small>{option.hint}</small>
                        </span>
                        {option.isDefault ? <span className="choice-tag">Default</span> : null}
                      </button>

                      {who === option.id && option.id === "permission" ? (
                        <div className="sheet-option-body">
                          <span className="field-label" id={ids.permissionLabel}>
                            Which permission
                          </span>
                          <Combobox
                            id={ids.permission}
                            value={value.permissions ?? stricter[0]?.value ?? ""}
                            searchable={false}
                            aria-labelledby={ids.permissionLabel}
                            options={stricter.map((choice) => ({ value: choice.value, label: choice.short ?? choice.label }))}
                            onChange={(next) => onPatch({ permissions: next ?? null })}
                          />
                          <p className="field-hint">
                            Server admins can still change this under Server Settings, Integrations.
                          </p>
                        </div>
                      ) : null}

                      {who === option.id && option.id === "roles" ? (
                        <div className="sheet-option-body">
                          <span className="field-label" id={ids.rolesLabel}>
                            Which roles
                          </span>
                          <MultiRolePicker
                            id={ids.roles}
                            guildId={guildId}
                            values={value.allowRoles}
                            emptyLabel="Pick at least one role"
                            addLabel="Add a role"
                            aria-labelledby={ids.rolesLabel}
                            onChange={(next) => onPatch({ allowRoles: next })}
                          />
                          <p className="field-hint">
                            Anyone else who tries it gets a message saying they can&apos;t. Discord can&apos;t
                            hide a command by role, so they still see it in their list.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="sheet-acc">
            {head("channels", "Where it works", channelsSummary, value.denyChannels.length > 0 || value.allowChannels.length > 0)}
            {open === "channels" ? (
              <div className="sheet-acc-body" id={`${ids.visibility}-channels`}>
                <div role="radiogroup" aria-label="Where it works">
                  {[
                    { id: "everywhere" as const, title: "Everywhere", hint: "How the command ships" },
                    { id: "only" as const, title: "Only in these channels", hint: "Anywhere else, it says it is turned off there" },
                    { id: "except" as const, title: "Everywhere except these channels", hint: "Those channels get a message saying it is turned off" },
                  ].map((option) => (
                    <div key={option.id} className="sheet-option-wrap" data-selected={where === option.id ? "true" : undefined}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={where === option.id}
                        className="sheet-option"
                        onClick={() => {
                          if (where === option.id) return;
                          setWhere(option.id);
                          // One list at a time keeps what the summary says true.
                          if (option.id === "everywhere") onPatch({ denyChannels: [], allowChannels: [] });
                          else if (option.id === "only") onPatch({ denyChannels: [] });
                          else onPatch({ allowChannels: [] });
                        }}
                      >
                        <span className="sheet-radio" aria-hidden="true" />
                        <span className="sheet-option-text">
                          {option.title}
                          <small>{option.hint}</small>
                        </span>
                        {option.id === "everywhere" ? <span className="choice-tag">Default</span> : null}
                      </button>

                      {where === option.id && option.id !== "everywhere" ? (
                        <div className="sheet-option-body">
                          <span className="field-label" id={ids.channelsLabel}>
                            {option.id === "only" ? "Works in" : "Turned off in"}
                          </span>
                          <MultiChannelPicker
                            id={ids.channels}
                            guildId={guildId}
                            types={["text", "voice", "forum", "category"]}
                            values={option.id === "only" ? value.allowChannels : value.denyChannels}
                            emptyLabel={option.id === "only" ? "Pick at least one channel" : "Pick the channels"}
                            addLabel="Add a channel"
                            aria-labelledby={ids.channelsLabel}
                            onChange={(next) => onPatch(option.id === "only" ? { allowChannels: next } : { denyChannels: next })}
                          />
                          <p className="field-hint">
                            A category covers every channel in it, and a channel covers its threads.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {partOf ? null : (
          <section className="sheet-acc">
            {head("reply", "Reply", replySummary, value.ephemeral !== null || value.customReply !== null)}
            {open === "reply" ? (
              <div className="sheet-acc-body" id={`${ids.visibility}-reply`}>
                {command.repliesVary ? (
                  <p className="field-hint">Refusals are shown only to the person who ran it, and confirmations to the channel. The command decides for each reply, so there is nothing to choose here.</p>
                ) : (
                  <>
                <span className="field-label">Who sees the reply</span>
                <div className="choice-group" role="radiogroup" aria-label="Who sees the reply">
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
                      onClick={() => {
                        if (choice.wantPrivate === replyIsPrivate) return;
                        // Landing back on how the command ships stores nothing.
                        onPatch({ ephemeral: choice.wantPrivate === command.privateByDefault ? null : choice.wantPrivate });
                      }}
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
                  </>
                )}

                {command.response ? (
                  <div className="sheet-text">
                    <div className="field-label-row">
                      <span className="field-label">What it says</span>
                      {value.customReply !== null ? (
                        <button type="button" className="link-button" onClick={() => onPatch({ customReply: null })}>
                          Reset
                        </button>
                      ) : null}
                    </div>
                    <div className="reply-state">
                      <p>
                        {value.customReply === null
                          ? "The command's own reply."
                          : "Your own reply, built with the message editor."}
                      </p>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingReply(true)}>
                        {value.customReply === null ? "Write your own reply" : "Edit the reply"}
                      </button>
                    </div>
                    <p className="field-hint">
                      Text, embeds, buttons and reactions, with variables, times, mentions and emoji.
                      {command.response.note ? ` ${command.response.note}` : null}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
          )}
        </div>

        <footer className="sheet-foot">
          <span>Changes save as you make them.</span>
          <span className={status === "error" ? "sheet-save is-error" : "sheet-save"} role="status">
            {status === "saving" ? "Saving…" : null}
            {status === "saved" ? (
              <>
                <i aria-hidden="true" />
                Saved
              </>
            ) : null}
            {status === "error" ? (
              <>
                <AlertIcon /> Not saved. Check the bot is running, then try again.
              </>
            ) : null}
          </span>
        </footer>
      </aside>
      {editingReply && command.response ? (
        <ReplyEditor
          guildId={guildId}
          commandName={displayName}
          template={command.response}
          current={value.customReply}
          isPrivate={replyIsPrivate}
          onSave={(message) => {
            onPatch({ customReply: message });
            setEditingReply(false);
          }}
          onReset={() => {
            onPatch({ customReply: null });
            setEditingReply(false);
          }}
          onClose={() => setEditingReply(false)}
        />
      ) : null}
    </div>
  );
}

/** The permission a command ships with, as one short word or two. */
function defaultLabelShort(defaultPermissions: string | null): string {
  return defaultPermissions === null ? "Everyone" : shortLabel(defaultPermissions);
}

