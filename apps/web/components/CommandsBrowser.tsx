"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GuildCommandState, GuildSubcommandState } from "../lib/control-api";
import { shortLabel } from "../lib/command-permissions";
import { STATUS_LABEL, commandStatus } from "../lib/commands";
import { UNREACHABLE, readFailure } from "../lib/bot-errors";
import { CommandSheet, changedCount, type CommandValues, type SaveState } from "./CommandSheet";
import { Switch } from "./form";
import { useToast } from "./Toaster";
import { ChevronDownIcon, ChevronRightIcon, CommandsIcon, EyeIcon, SearchIcon, ShieldIcon } from "./Icons";

export interface CommandGroup {
  id: string;
  name: string;
  summary: string;
  /** False when the feature is switched off, so none of these commands are in Discord. */
  featureOn: boolean;
  commands: GuildCommandState[];
}

interface Props {
  guildId: string;
  groups: CommandGroup[];
}

type Filter = "all" | "customized" | "off";

const SAVED_LINGER_MS = 2000;
const ALL = "all";

/** A part has only a switch and role and channel limits; the rest stays at the command's own. */
function partValuesOf(part: GuildSubcommandState): CommandValues {
  return {
    enabled: part.enabled,
    allowRoles: part.allowRoles,
    denyChannels: part.denyChannels,
    allowChannels: part.allowChannels,
    permissions: null,
    ephemeral: null,
    customReply: null,
  };
}

/** A part as the sheet sees it: the whole command, renamed, with nothing to reply. */
function partAsCommand(command: GuildCommandState, part: GuildSubcommandState): GuildCommandState {
  return { ...command, name: part.key, description: part.description, response: null, repliesVary: false, subcommands: [] };
}

const partsOf = (command: GuildCommandState) => command.subcommands ?? [];

function valuesOf(command: GuildCommandState): CommandValues {
  return {
    enabled: command.enabled,
    allowRoles: command.allowRoles,
    denyChannels: command.denyChannels,
    allowChannels: command.allowChannels ?? [],
    permissions: command.permissions,
    ephemeral: command.ephemeral,
    customReply: command.customReply,
  };
}

/**
 * Every command on a server, one feature per tab, as a table. A command opens
 * in a sheet over the list.
 *
 * The values for every command live here rather than in the sheet. The table
 * shows which commands are customized or off, and the sheet is swapped as
 * commands are opened, so a sheet that owned its own state would forget an edit
 * the moment another command was picked.
 */
export function CommandsBrowser({ guildId, groups }: Props) {
  const router = useRouter();
  const { push } = useToast();
  const [turningOn, setTurningOn] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<string>(ALL);
  const [values, setValues] = useState<Record<string, CommandValues>>(() =>
    Object.fromEntries(
      groups
        .flatMap((g) => g.commands)
        .flatMap((c) => [[c.name, valuesOf(c)] as const, ...partsOf(c).map((part) => [part.key, partValuesOf(part)] as const)]),
    ),
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openName, setOpenName] = useState<string | null>(null);
  const [save, setSave] = useState<{ name: string; state: SaveState }>({ name: "", state: "idle" });
  const searchRef = useRef<HTMLInputElement>(null);
  // Where focus goes back to when the sheet closes, so keyboard use is not left at the top of the page.
  const returnFocus = useRef<HTMLElement | null>(null);

  const all = useMemo(() => groups.flatMap((group) => group.commands), [groups]);
  // Parts are listed under their key, so a sheet or a failed save can find them like any command.
  const byName = useMemo(
    () =>
      new Map(
        all.flatMap((command) => [
          [command.name, command] as const,
          ...partsOf(command).map((part) => [part.key, partAsCommand(command, part)] as const),
        ]),
      ),
    [all],
  );
  const parentOf = useMemo(
    () => new Map(all.flatMap((command) => partsOf(command).map((part) => [part.key, command] as const))),
    [all],
  );
  const groupOf = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.commands.flatMap((command) => [
            [command.name, group] as const,
            ...partsOf(command).map((part) => [part.key, group] as const),
          ]),
        ),
      ),
    [groups],
  );

  /** How many parts of a command are off or limited. */
  function partsChanged(command: GuildCommandState): number {
    return partsOf(command).filter((part) => {
      const value = values[part.key];
      return value !== undefined && (!value.enabled || changedCount(value) > 0);
    }).length;
  }

  /** Whether a part is what the current filter and search are looking for. */
  function partMatches(part: GuildSubcommandState, needle: string): boolean {
    const value = values[part.key];
    if (!value) return false;
    if (filter === "customized" && value.enabled && changedCount(value) === 0) return false;
    // Every part is in Discord while its command is, so "Not in Discord" never picks one out.
    if (filter === "off") return false;
    return needle === "" || part.key.toLowerCase().includes(needle) || part.description.toLowerCase().includes(needle);
  }

  const counts = useMemo(() => {
    let customized = 0;
    let off = 0;
    for (const group of groups) {
      for (const command of group.commands) {
        const value = values[command.name];
        if (!value) continue;
        if (changedCount(value) > 0 || partsChanged(command) > 0) customized += 1;
        if (!value.enabled || !group.featureOn) off += 1;
      }
    }
    return { all: all.length, customized, off };
  }, [all, groups, values]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups
      .filter((group) => tab === ALL || group.id === tab)
      .map((group) => ({
        ...group,
        commands: group.commands.filter((command) => {
          const value = values[command.name];
          if (!value) return false;
          const searching = filter !== "all" || needle !== "";
          if (searching && partsOf(command).some((part) => partMatches(part, needle))) return true;
          if (filter === "customized" && changedCount(value) === 0) return false;
          if (filter === "off" && value.enabled && group.featureOn) return false;
          if (!needle) return true;
          return (
            command.name.toLowerCase().includes(needle) ||
            command.description.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((group) => group.commands.length > 0);
  }, [groups, tab, query, filter, values]);

  const shown = filtered.reduce((count, group) => count + group.commands.length, 0);

  useEffect(() => {
    if (save.state !== "saved") return;
    const timer = window.setTimeout(() => setSave((s) => ({ ...s, state: "idle" })), SAVED_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [save]);

  // "/" jumps to the search, the way it does in most apps with a list this long.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const patch = useCallback(
    async (name: string, change: Partial<CommandValues>) => {
      const before = values[name];
      if (!before) return;
      setValues((current) => ({ ...current, [name]: { ...before, ...change } }));
      setSave({ name, state: "saving" });
      try {
        const res = await fetch(`/api/guilds/${guildId}/commands/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(change),
        });
        if (!res.ok) throw new Error((await readFailure(res)).message);
        setSave({ name, state: "saved" });
      } catch (error) {
        // Only the keys this change touched go back, so an edit made meanwhile survives.
        setValues((current) => {
          const now = current[name];
          if (!now) return current;
          const restored = { ...now };
          for (const key of Object.keys(change) as (keyof CommandValues)[]) {
            (restored as Record<string, unknown>)[key] = before[key];
          }
          return { ...current, [name]: restored };
        });
        setSave({ name, state: "error" });
        // The sheet shows its own line, but a switch in the table has nowhere else to say it.
        const label = byName.get(name)?.kind === "slash" ? `/${name}` : name;
        push({
          kind: "error",
          title: `${label} was not changed`,
          detail: error instanceof Error && !(error instanceof TypeError) ? error.message : UNREACHABLE,
        });
      }
    },
    [guildId, values, byName, push],
  );

  async function turnOn(group: CommandGroup) {
    setTurningOn(group.id);
    try {
      const res = await fetch(`/api/guilds/${guildId}/modules/${encodeURIComponent(group.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (!res.ok) {
        push({ kind: "error", title: `${group.name} is still off`, detail: (await readFailure(res)).message });
        return;
      }
      router.refresh();
    } catch {
      push({ kind: "error", title: `${group.name} is still off`, detail: UNREACHABLE });
    } finally {
      setTurningOn(null);
    }
  }

  function openCommand(name: string, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setOpenName(name);
  }

  function closeSheet() {
    setOpenName(null);
    returnFocus.current?.focus();
  }

  const opened = openName ? byName.get(openName) : undefined;
  const openedValue = openName ? values[openName] : undefined;

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "Everything", count: counts.all },
    { id: "customized", label: "Customized", count: counts.customized },
    { id: "off", label: "Not in Discord", count: counts.off },
  ];

  return (
    <>
      <div className="cmd-tabs" role="tablist" aria-label="Feature">
        {[{ id: ALL, name: "All", count: all.length }, ...groups.map((g) => ({ id: g.id, name: g.name, count: g.commands.length }))].map(
          (item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="cmd-tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.name}
              <span className="cmd-tab-count">{item.count}</span>
            </button>
          ),
        )}
      </div>

      <div className="cmd-toolbar">
        <div className="cmd-chips" role="group" aria-label="Show">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="cmd-chip"
              aria-pressed={filter === chip.id}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
              <span className="cmd-chip-count">{chip.count}</span>
            </button>
          ))}
        </div>
        <div className="search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            className="input"
            value={query}
            placeholder="Search commands"
            aria-label="Search commands"
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="cmd-kbd" aria-hidden="true">
            /
          </kbd>
        </div>
      </div>

      {shown === 0 ? (
        <div className="empty">
          <CommandsIcon className="empty-icon" />
          <p className="empty-title">No command matches that</p>
          <p className="empty-text">
            Search matches a command&apos;s name and its description. Try a shorter word, or clear
            the search and the filter to see everything.
          </p>
          <div className="empty-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setQuery("");
                setFilter("all");
                setTab(ALL);
              }}
            >
              Show everything
            </button>
          </div>
        </div>
      ) : (
        <div className="cmd-table card">
          <div className="cmd-cols" aria-hidden="true">
            <span>Command</span>
            <span>Who can use it</span>
            <span>Reply</span>
            <span>Status</span>
            <span>On</span>
            <span />
          </div>
          {filtered.map((group) => (
            <section key={group.id} aria-label={group.name}>
              {tab === ALL ? (
                <div className="cmd-group-label">
                  <span>{group.name}</span>
                  <span>{group.commands.length}</span>
                </div>
              ) : null}
              {group.featureOn ? null : (
                <div className="cmd-feature-off" role="note">
                  <span>
                    {group.name} is off, so none of these commands are in Discord. Their settings are kept
                    for when it is on.
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={turningOn === group.id}
                    onClick={() => void turnOn(group)}
                  >
                    {turningOn === group.id ? "Turning on…" : `Turn on ${group.name}`}
                  </button>
                </div>
              )}
              <ul>
                {group.commands.map((command) => {
                  const value = values[command.name];
                  if (!value) return null;
                  const label = command.kind === "slash" ? `/${command.name}` : command.name;
                  const status = commandStatus(group.featureOn, value.enabled, changedCount(value));
                  const replyPrivate = value.ephemeral ?? command.privateByDefault;
                  const sees =
                    value.allowRoles.length > 0
                      ? `${value.allowRoles.length} ${value.allowRoles.length === 1 ? "role" : "roles"}`
                      : value.permissions === null
                      ? command.defaultPermissions === null
                        ? "Everyone"
                        : shortLabel(command.defaultPermissions)
                      : value.permissions === "everyone"
                        ? "Everyone"
                        : shortLabel(value.permissions);
                  const parts = partsOf(command);
                  const needle = query.trim().toLowerCase();
                  const searching = filter !== "all" || needle !== "";
                  const shownParts = expanded.has(command.name) ? parts : searching ? parts.filter((part) => partMatches(part, needle)) : [];
                  const changedParts = partsChanged(command);
                  const partsId = `cmd-parts-${command.name}`;
                  return (
                    <Fragment key={command.name}>
                    <li
                      className="cmd-row"
                      data-off={value.enabled && group.featureOn ? undefined : "true"}
                      data-open={command.name === openName ? "true" : undefined}
                    >
                      <div className="cmd-cell-main">
                        <span
                          className="cmd-tile"
                          data-kind={command.kind === "slash" ? "slash" : "menu"}
                          aria-hidden="true"
                        >
                          {command.kind === "slash" ? "/" : "↗"}
                        </span>
                        <div className="cmd-main-text">
                          <button
                            type="button"
                            className="cmd-open"
                            aria-label={`Settings for ${label}`}
                            onClick={(event) => openCommand(command.name, event.currentTarget)}
                          >
                            <code>{label}</code>
                          </button>
                          <span className="cmd-desc">
                            {command.kind === "slash"
                              ? command.description
                              : command.kind === "user"
                                ? `Right-click a member. ${command.description}`
                                : `Right-click a message. ${command.description}`}
                          </span>
                          {parts.length > 0 ? (
                            <button
                              type="button"
                              className="cmd-parts-toggle"
                              aria-expanded={shownParts.length === parts.length}
                              aria-controls={partsId}
                              onClick={() =>
                                setExpanded((current) => {
                                  const next = new Set(current);
                                  if (next.has(command.name)) next.delete(command.name);
                                  else next.add(command.name);
                                  return next;
                                })
                              }
                            >
                              <ChevronDownIcon className="cmd-parts-chevron" />
                              {parts.length} {parts.length === 1 ? "part" : "parts"}
                              {changedParts > 0 ? `, ${changedParts} changed` : ""}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <span className="cmd-cell" data-changed={value.permissions !== null || value.allowRoles.length > 0 ? "true" : undefined}>
                        <ShieldIcon />
                        {sees}
                      </span>
                      <span
                        className="cmd-cell"
                        data-changed={value.ephemeral !== null || value.customReply !== null ? "true" : undefined}
                      >
                        <EyeIcon />
                        {command.repliesVary ? "Varies" : replyPrivate ? "Private" : "Public"}
                      </span>
                      <span className="cmd-status">
                        <span
                          className={
                            status === "off" || status === "featureOff"
                              ? "cmd-pill is-off"
                              : status === "customized"
                                ? "cmd-pill is-changed"
                                : "cmd-pill"
                          }
                        >
                          <i aria-hidden="true" />
                          {STATUS_LABEL[status]}
                        </span>
                      </span>
                      <span className="cmd-switch">
                        <Switch
                          checked={value.enabled}
                          onChange={(next) => void patch(command.name, { enabled: next })}
                          aria-label={group.featureOn ? `${label} is on` : `${label} is on once ${group.name} is on`}
                        />
                      </span>
                      <ChevronRightIcon className="cmd-chevron" />
                    </li>
                    {shownParts.length > 0 ? (
                      <li className="cmd-parts" id={partsId}>
                        <p className="cmd-parts-note">
                          Discord shows every part of {label} to anyone who can see {label}. A part that is off or limited
                          is answered with a message instead of running.
                        </p>
                        <ul aria-label={`Parts of ${label}`}>
                          {shownParts.map((part) => {
                            const partValue = values[part.key];
                            if (!partValue) return null;
                            const partLabel = `/${part.key}`;
                            const partStatus = commandStatus(group.featureOn, partValue.enabled, changedCount(partValue));
                            return (
                              <li
                                key={part.key}
                                className="cmd-row cmd-part-row"
                                data-off={partValue.enabled && value.enabled && group.featureOn ? undefined : "true"}
                                data-open={part.key === openName ? "true" : undefined}
                              >
                                <div className="cmd-cell-main">
                                  <span className="cmd-tile" data-kind="part" aria-hidden="true">
                                    ↳
                                  </span>
                                  <div className="cmd-main-text">
                                    <button
                                      type="button"
                                      className="cmd-open"
                                      aria-label={`Settings for ${partLabel}`}
                                      onClick={(event) => openCommand(part.key, event.currentTarget)}
                                    >
                                      <code>{partLabel}</code>
                                    </button>
                                    <span className="cmd-desc">{part.description}</span>
                                  </div>
                                </div>
                                <span className="cmd-cell" data-changed={partValue.allowRoles.length > 0 ? "true" : undefined}>
                                  <ShieldIcon />
                                  {partValue.allowRoles.length > 0
                                    ? `${partValue.allowRoles.length} ${partValue.allowRoles.length === 1 ? "role" : "roles"}`
                                    : `As ${label}`}
                                </span>
                                <span className="cmd-cell" aria-hidden="true" />
                                <span className="cmd-status">
                                  <span
                                    className={
                                      partStatus === "off" || partStatus === "featureOff"
                                        ? "cmd-pill is-off"
                                        : partStatus === "customized"
                                          ? "cmd-pill is-changed"
                                          : "cmd-pill"
                                    }
                                  >
                                    <i aria-hidden="true" />
                                    {STATUS_LABEL[partStatus]}
                                  </span>
                                </span>
                                <span className="cmd-switch">
                                  <Switch
                                    checked={partValue.enabled}
                                    onChange={(next) => void patch(part.key, { enabled: next })}
                                    aria-label={`${partLabel} is on`}
                                  />
                                </span>
                                <ChevronRightIcon className="cmd-chevron" />
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ) : null}
                    </Fragment>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {opened && openedValue ? (
        <CommandSheet
          guildId={guildId}
          command={opened}
          featureOn={groupOf.get(opened.name)?.featureOn ?? true}
          featureName={groupOf.get(opened.name)?.name ?? ""}
          value={openedValue}
          partOf={parentOf.has(opened.name) ? `/${parentOf.get(opened.name)?.name}` : undefined}
          status={save.name === opened.name ? save.state : "idle"}
          onPatch={(change) => void patch(opened.name, change)}
          onClose={closeSheet}
        />
      ) : null}
    </>
  );
}
